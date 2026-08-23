import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { PERMISSIONS, can, getBasePermissions } from "../permissions";

/**
 * Working out who a message pings.
 *
 * The grammar is mirrored from src/lib/mentions.ts (the composer writes these
 * tokens, this resolves them) — `<@userId>`, `<@&roleId>`, `@everyone` and
 * `@here`. Keep the two in step.
 */
const MENTION_RE = /<@&([a-z0-9]+)>|<@([a-z0-9]+)>|@(everyone|here)\b/gi;

/** Legacy plain-text form. The composer inserts `<@id>` now, but messages
 * predating that — and anything typed by hand or sent from another client —
 * still say `@handle`, and those should keep working. */
const USERNAME_RE = /@([a-z0-9_.]{3,32})/gi;

interface ParsedMentions {
  userIds: string[];
  roleIds: string[];
  usernames: string[];
  everyone: boolean;
  here: boolean;
}

function parse(text: string): ParsedMentions {
  const userIds = new Set<string>();
  const roleIds = new Set<string>();
  let everyone = false;
  let here = false;

  for (const match of text.matchAll(MENTION_RE)) {
    const [, roleId, userId, all] = match;
    if (roleId) roleIds.add(roleId);
    else if (userId) userIds.add(userId);
    else if (all?.toLowerCase() === "here") here = true;
    else if (all) everyone = true;
  }

  // `@everyone` also matches USERNAME_RE, so strip the structured forms before
  // looking for bare handles rather than resolving "everyone" as a username.
  const remainder = text.replace(MENTION_RE, " ");
  const usernames = new Set(
    Array.from(remainder.matchAll(USERNAME_RE), (m) => m[1].toLowerCase())
  );

  return {
    userIds: [...userIds],
    roleIds: [...roleIds],
    usernames: [...usernames],
    everyone,
    here,
  };
}

/**
 * Everyone a channel message should notify.
 *
 * Role, `@everyone` and `@here` mentions need MENTION_EVERYONE; without it
 * they're dropped here rather than rejected at send time. That matches what
 * every other client does and is the kinder failure: the message still says
 * what the author typed, it just doesn't wake a hundred people up. The
 * composer hides those options from anyone who can't use them, so this is the
 * backstop rather than the user-facing rule.
 *
 * `@here` resolves against presence — anyone whose effective status isn't
 * offline. Someone who is idle or in Do Not Disturb is still "here"; whether
 * they actually get told is the notification policy's business, not this
 * function's.
 *
 * The author is always excluded: mentioning yourself, or being in a role you
 * ping, shouldn't notify you.
 */
export async function resolveChannelMentions(
  ctx: QueryCtx,
  communityId: Id<"communities">,
  text: string,
  authorId: Id<"users">
): Promise<Id<"users">[]> {
  const parsed = parse(text);
  if (
    parsed.userIds.length === 0 &&
    parsed.roleIds.length === 0 &&
    parsed.usernames.length === 0 &&
    !parsed.everyone &&
    !parsed.here
  ) {
    return [];
  }

  const members = await ctx.db
    .query("communityMembers")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .collect();
  const memberIds = new Set(members.map((m) => m.userId as string));

  const mentioned = new Set<string>();

  for (const userId of parsed.userIds) {
    if (memberIds.has(userId)) mentioned.add(userId);
  }

  for (const username of parsed.usernames) {
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
    if (user && memberIds.has(user._id)) mentioned.add(user._id);
  }

  const wantsMassPing = parsed.roleIds.length > 0 || parsed.everyone || parsed.here;
  if (wantsMassPing) {
    const community = await ctx.db.get(communityId);
    const allowed =
      !!community &&
      can(await getBasePermissions(ctx, community, authorId), PERMISSIONS.MENTION_EVERYONE);

    if (allowed) {
      for (const roleId of parsed.roleIds) {
        const role = await ctx.db.get(roleId as Id<"roles">);
        // A role from another community would otherwise ping its members here.
        if (!role || role.communityId !== communityId) continue;
        if (role.isEveryone) {
          members.forEach((m) => mentioned.add(m.userId));
          continue;
        }
        const assignments = await ctx.db
          .query("memberRoles")
          .withIndex("by_role", (q) => q.eq("roleId", role._id))
          .collect();
        assignments.forEach((assignment) => mentioned.add(assignment.userId));
      }

      if (parsed.everyone) members.forEach((m) => mentioned.add(m.userId));

      if (parsed.here) {
        const online = await Promise.all(
          members.map(async (member) => {
            const presence = await ctx.db
              .query("presence")
              .withIndex("by_user", (q) => q.eq("userId", member.userId))
              .unique();
            const effective = presence?.effective ?? "offline";
            return effective === "offline" ? null : member.userId;
          })
        );
        online.forEach((userId) => userId && mentioned.add(userId));
      }
    }
  }

  mentioned.delete(authorId);
  return [...mentioned] as Id<"users">[];
}

/**
 * Message text as it should read in a notification.
 *
 * A notification body is plain text — an OS toast, a push payload, a line in
 * the inbox — with no renderer to turn the wire format into anything. Stored
 * raw, `<@mx73p610…>` is exactly what the toast showed: a mention rendered as
 * its own internal id.
 *
 * So the tokens are resolved to what they read as: `<@id>` becomes
 * `@DisplayName`, `<@&roleId>` becomes `@RoleName`, and `<:name:id>` custom
 * emoji become `:name:`. `@everyone` / `@here` already read correctly and are
 * left alone.
 *
 * Resolved at write time rather than at display time because the body is
 * denormalised onto the notification row and read back by three different
 * consumers (the inbox, the Electron notifier, push) — doing it here means one
 * implementation instead of three, and the name is the one that was current
 * when the message was sent.
 *
 * A name is preferred over a nickname deliberately: `serverProfiles` overrides
 * would make the same message read differently per community, and the point of
 * this string is to be recognisable, not per-server-correct.
 */
/** `db.get` rejects an id that isn't well-formed for the table — and these
 * ids come out of message text, so "well-formed" is not a given. Anything
 * unreadable is simply nobody. */
async function getOrNull<T extends "users" | "roles">(
  ctx: QueryCtx,
  id: string
): Promise<Doc<T> | null> {
  try {
    return (await ctx.db.get(id as Id<T>)) as Doc<T> | null;
  } catch {
    return null;
  }
}

export async function renderMentionsAsText(ctx: QueryCtx, text: string): Promise<string> {
  // The exact tags `src/lib/custom-emoji.ts` and the composer produce.
  const TOKEN_RE = /<@&([a-z0-9]+)>|<@([a-z0-9]+)>|<:([a-zA-Z0-9_]+):([a-zA-Z0-9]+)>/gi;

  const matches = [...text.matchAll(TOKEN_RE)];
  if (matches.length === 0) return text;

  // Resolved up front, deduplicated, so a message that mentions the same
  // person five times is one lookup rather than five.
  const replacements = new Map<string, string>();
  for (const match of matches) {
    const [raw, roleId, userId, emojiName] = match;
    if (replacements.has(raw)) continue;

    if (emojiName) {
      replacements.set(raw, `:${emojiName}:`);
      continue;
    }
    if (userId) {
      const user = await getOrNull<"users">(ctx, userId);
      // An unresolvable id is dropped rather than left as a raw tag — a
      // deleted account should read as a gap, not as machine output.
      replacements.set(raw, user ? `@${user.name}` : "@someone");
      continue;
    }
    if (roleId) {
      const role = await getOrNull<"roles">(ctx, roleId);
      replacements.set(raw, role ? `@${role.name}` : "@role");
    }
  }

  return text.replace(TOKEN_RE, (raw) => replacements.get(raw) ?? raw);
}

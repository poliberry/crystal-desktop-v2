import type { Id } from "../../convex/_generated/dataModel";

/**
 * The mention grammar, shared by the composer, the renderer and (mirrored in
 * convex/lib/mentions.ts) the server.
 *
 * Mentions are stored as opaque references rather than display text —
 * `<@userId>` for a person, `<@&roleId>` for a role — so a message keeps
 * pointing at the right member after a nickname change and can't be forged by
 * typing someone's name. `@everyone` and `@here` are literal, because they
 * refer to the channel rather than to a row.
 *
 * `@here` differs from `@everyone` only in who it notifies: everyone who is
 * currently online, rather than every member.
 */

export type MentionTarget =
  | { kind: "user"; id: string }
  | { kind: "role"; id: string }
  | { kind: "everyone" }
  | { kind: "here" };

/** Matches every form in one pass, so a message can be walked in order. */
export const MENTION_RE = /<@&([a-z0-9]+)>|<@([a-z0-9]+)>|@(everyone|here)\b/gi;

/** Just the opaque reference forms. These are the ones that need resolving to
 * be readable at all — `@everyone` and `@here` already say what they mean, in
 * a composer as much as in a message. */
export const MENTION_REF_RE = /<@&([a-z0-9]+)>|<@([a-z0-9]+)>/gi;

/** The reference to store for a target — what the composer inserts. */
export function mentionToken(target: MentionTarget): string {
  switch (target.kind) {
    case "user":
      return `<@${target.id}>`;
    case "role":
      return `<@&${target.id}>`;
    case "everyone":
      return "@everyone";
    case "here":
      return "@here";
  }
}

/**
 * An `@` the user is part-way through typing, for the composer's dropdown.
 *
 * Anchored to a word boundary so an email address or a `<@id>` already in the
 * text doesn't reopen the picker, and it matches an `@` on its own — typing
 * the sigil should show the list before you've narrowed it.
 */
const IN_PROGRESS_MENTION_RE = /(?:^|\s)@([\w.-]{0,32})$/;

export function matchInProgressMention(
  value: string,
  caret: number
): { start: number; end: number; query: string } | null {
  const before = value.slice(0, caret);
  const match = IN_PROGRESS_MENTION_RE.exec(before);
  if (!match) return null;
  // `match[0]` may include the preceding space; the `@` is what we replace from.
  const query = match[1] ?? "";
  return { start: caret - query.length - 1, end: caret, query };
}

/** Every mention in a message, in the order they appear. */
export function parseMentions(text: string): MentionTarget[] {
  const found: MentionTarget[] = [];
  for (const match of text.matchAll(MENTION_RE)) {
    const [, roleId, userId, all] = match;
    if (roleId) found.push({ kind: "role", id: roleId });
    else if (userId) found.push({ kind: "user", id: userId });
    else if (all) found.push(all.toLowerCase() === "here" ? { kind: "here" } : { kind: "everyone" });
  }
  return found;
}

/** What the sender's client attaches to an encrypted message so the server can
 * notify people without reading it (see docs/E2EE.md, "mentions"). */
export interface ExtractedMentions {
  users: string[];
  roles: string[];
  everyone: boolean;
  here: boolean;
}

/** Preserve the string ids' runtime representation while branding them for Convex validators. */
export function toConvexMentions(mentions: ExtractedMentions): {
  users: Id<"users">[];
  roles: Id<"roles">[];
  everyone: boolean;
  here: boolean;
} {
  return {
    users: mentions.users as Id<"users">[],
    roles: mentions.roles as Id<"roles">[],
    everyone: mentions.everyone,
    here: mentions.here,
  };
}

/** What the composer already knows about who can be named. Bare `@handle`s are
 * resolved against it; anything not in it is ignored rather than guessed. */
export interface MentionContext {
  members?: readonly { id: string; username: string }[];
}

/** Bare handle, the same alphabet convex/lib/mentions.ts accepts. The lookbehind
 * keeps an email address (`a@b.co`) from reading as a mention of `b.co`. */
const BARE_USERNAME_RE = /(?<![\w<@&.])@([a-z0-9_.]{3,32})/gi;

/** More than this in one message is a mass ping dressed up as a list. */
const MAX_MENTIONED_USERS = 100;

/**
 * The mentions in a message, as the structure the server stores next to the
 * ciphertext. Grammar: `<@id>`, `<@&id>`, `@everyone`, `@here`, and a bare
 * `@username` that matches a known member.
 *
 * The server checks the ids are members and enforces MENTION_EVERYONE, but it
 * cannot check the text matches — this is the only place that ties the two.
 */
export function extractMentions(text: string, ctx: MentionContext = {}): ExtractedMentions {
  const users = new Set<string>();
  const roles = new Set<string>();
  let everyone = false;
  let here = false;

  for (const target of parseMentions(text)) {
    if (target.kind === "user") users.add(target.id);
    else if (target.kind === "role") roles.add(target.id);
    else if (target.kind === "everyone") everyone = true;
    else here = true;
  }

  if (ctx.members?.length) {
    const byUsername = new Map(ctx.members.map((m) => [m.username.toLowerCase(), m.id]));
    // The structured forms are blanked first: `@everyone` also looks like a
    // handle, and the id inside `<@id>` must not be read as one.
    const remainder = text.replace(MENTION_RE, " ");
    for (const match of remainder.matchAll(BARE_USERNAME_RE)) {
      let handle = match[1].toLowerCase();
      // "@bob." at the end of a sentence: the dot is punctuation, unless a
      // member really is called "bob.".
      while (handle.length >= 3) {
        const id = byUsername.get(handle);
        if (id) {
          users.add(id);
          break;
        }
        if (!handle.endsWith(".")) break;
        handle = handle.slice(0, -1);
      }
    }
  }

  return { users: [...users].slice(0, MAX_MENTIONED_USERS), roles: [...roles], everyone, here };
}

/** Whether a message pings the given user directly (not via a role or
 * `@everyone`) — enough to decide whether to highlight it for them. */
export function mentionsUserDirectly(text: string, userId: string): boolean {
  return text.includes(`<@${userId}>`);
}

/**
 * Markdown link scheme the renderer uses to turn a mention into a pill.
 *
 * Mentions have to survive the trip through the markdown renderer, and a link
 * is the only inline node that carries both a label and a payload. The same
 * trick the custom emoji substitution uses (see src/lib/custom-emoji.ts), for
 * the same reason.
 */
export const MENTION_LINK_SCHEME = "crystal-mention:";

export interface MentionNames {
  /** Display name for a user id, already resolved for the current community. */
  user: (id: string) => string | undefined;
  /** Name and colour for a role id. */
  role: (id: string) => { name: string; color?: string } | undefined;
  /** Fuller identity for a user id — what the mention popover needs to render
   * a complete card on the first frame. Absent outside a community. */
  member?: (
    id: string
  ) => { name: string; username: string; imageUrl?: string } | undefined;
}

/**
 * Rewrite stored mentions into markdown links the renderer can style.
 *
 * Unresolvable references become plain text rather than a pill: a reference to
 * someone who left the server, or a role that was deleted, is not something to
 * present as a live mention.
 */
export function substituteMentions(text: string, names: MentionNames): string {
  return text.replace(MENTION_RE, (match, roleId?: string, userId?: string, all?: string) => {
    if (roleId) {
      const role = names.role(roleId);
      return role ? `[@${role.name}](${MENTION_LINK_SCHEME}role:${roleId})` : match;
    }
    if (userId) {
      const name = names.user(userId);
      return name ? `[@${name}](${MENTION_LINK_SCHEME}user:${userId})` : match;
    }
    const keyword = all?.toLowerCase() === "here" ? "here" : "everyone";
    return `[@${keyword}](${MENTION_LINK_SCHEME}${keyword}:)`;
  });
}

/**
 * Mentions as plain `@name`, for one-line previews (reply quotes, sidebar lines, notification
 * text). The server used to do this when it built previews; it can't read the text any more.
 * Unresolvable references read as `@unknown` rather than leaking an id into the line.
 */
export function renderMentionsAsPlain(text: string, names: Pick<MentionNames, "user" | "role">): string {
  return text.replace(MENTION_RE, (match, roleId?: string, userId?: string) => {
    if (roleId) return `@${names.role(roleId)?.name ?? "role"}`;
    if (userId) return `@${names.user(userId) ?? "unknown"}`;
    return match;
  });
}

/** The target behind a mention link, or null for an ordinary link. */
export function parseMentionLink(href: string): MentionTarget | null {
  if (!href.startsWith(MENTION_LINK_SCHEME)) return null;
  const [kind, id] = href.slice(MENTION_LINK_SCHEME.length).split(":");
  if (kind === "user" || kind === "role") return id ? { kind, id } : null;
  if (kind === "everyone") return { kind: "everyone" };
  if (kind === "here") return { kind: "here" };
  return null;
}

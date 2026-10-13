import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { dmKeyFor } from "./conversations";
import {
  endsAtFor,
  hasOpen,
  ignoredUntil,
  isOpen,
  windowsAgainst,
  windowsByTarget,
} from "./lib/blocking";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

/**
 * Ignore and block.
 *
 * - **Ignore** hides someone from you for a while: their messages, in DMs and
 *   servers alike, and the notifications, mentions and call rings they would
 *   cause. They are not told. What they send while you ignore them stays hidden
 *   after it ends — an ignore is a stretch of time you chose not to hear them,
 *   not a switch that hands you the backlog when it flips.
 * - **Block** is the permanent version, and also severs things: it unfriends,
 *   cancels requests, stops them messaging or calling you, and hides your
 *   profile from them. It does not remove anyone from a group or server you
 *   share; there, their messages are hidden from you the way an ignore's are.
 *
 * Both are rows in `userSuppressions` — see its note in schema.ts, and
 * convex/lib/blocking.ts for the rules the rest of the backend enforces. The
 * enforcement is server-side because the mobile app shares this backend.
 */

const durationValidator = v.union(
  v.literal("1h"),
  v.literal("8h"),
  v.literal("24h"),
  v.literal("7d"),
  v.literal("forever"),
);

/** The target must be a real person other than the caller. The Crystal system
 * account is refused: it carries staff announcements that can't be opted out
 * of, and ignoring it would silently swallow them. */
async function requireTarget(
  ctx: MutationCtx,
  me: Doc<"users">,
  userId: Id<"users">,
): Promise<Doc<"users">> {
  if (userId === me._id) throw new Error("You can't do that to yourself.");
  const target = await ctx.db.get(userId);
  if (!target) throw new Error("User not found.");
  if (target.clerkId === "system:crystal") {
    throw new Error("You can't ignore or block the Crystal account.");
  }
  return target;
}

/** The conversation list and each conversation's header data are cached per
 * person (see conversations.listMine and .get), and their previews and unread
 * dots depend on who is hidden — so a change here has to drop them. */
async function dropConversationCaches(
  ctx: MutationCtx,
  ...userIds: Id<"users">[]
): Promise<void> {
  try {
    const { cacheInvalidateKeys } = await import("./cache");
    for (const userId of userIds) {
      const memberships = await ctx.db
        .query("conversationMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      await cacheInvalidateKeys(
        `user:${userId}:conversations`,
        ...memberships.map((m) => `conversation:${m.conversationId}:user:${userId}:data`),
      );
    }
  } catch {}
}

/** Close every open window of one kind at `now`, keeping the row: what was
 * hidden while it ran stays hidden. */
async function closeOpen(
  ctx: MutationCtx,
  windows: Doc<"userSuppressions">[],
  kind: "ignore" | "block",
  now: number,
): Promise<number> {
  let closed = 0;
  for (const w of windows) {
    if (w.kind !== kind || !isOpen(w, now)) continue;
    await ctx.db.patch(w._id, { endsAt: now });
    closed++;
  }
  return closed;
}

export const ignoreUser = mutation({
  args: { userId: v.id("users"), duration: durationValidator },
  handler: async (ctx, { userId, duration }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireTarget(ctx, me, userId);

    const now = Date.now();
    const windows = await windowsAgainst(ctx, me._id, userId);
    if (hasOpen(windows, now, "block")) {
      throw new Error("You've blocked this person. Unblock them first.");
    }

    const endsAt = endsAtFor(duration, now);
    const [current, ...extra] = windows.filter((w) => w.kind === "ignore" && isOpen(w, now));
    if (current) {
      // Ignoring again while already ignoring sets the new end — longer or
      // shorter — without starting over, so nothing already hidden changes.
      await ctx.db.patch(current._id, { endsAt });
      for (const w of extra) await ctx.db.patch(w._id, { endsAt: now });
    } else {
      await ctx.db.insert("userSuppressions", {
        userId: me._id,
        targetId: userId,
        kind: "ignore",
        startedAt: now,
        endsAt,
      });
    }
    await dropConversationCaches(ctx, me._id);
    return { endsAt: endsAt ?? null };
  },
});

export const unignoreUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const windows = await windowsAgainst(ctx, me._id, userId);
    await closeOpen(ctx, windows, "ignore", Date.now());
    await dropConversationCaches(ctx, me._id);
  },
});

export const blockUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireTarget(ctx, me, userId);

    const now = Date.now();
    const windows = await windowsAgainst(ctx, me._id, userId);
    if (hasOpen(windows, now, "block")) return;

    // A block supersedes an ignore: end it, so that unblocking later doesn't
    // leave the person quietly ignored.
    await closeOpen(ctx, windows, "ignore", now);
    await ctx.db.insert("userSuppressions", {
      userId: me._id,
      targetId: userId,
      kind: "block",
      startedAt: now,
    });

    // Unfriend, both directions. Friendships are stored once per side.
    for (const [owner, friend] of [
      [me._id, userId],
      [userId, me._id],
    ] as const) {
      const row = await ctx.db
        .query("friendships")
        .withIndex("by_owner_friend", (q) => q.eq("ownerId", owner).eq("friendId", friend))
        .unique();
      if (row) await ctx.db.delete(row._id);
    }

    // Pending friend requests either way round.
    for (const [requester, recipient] of [
      [me._id, userId],
      [userId, me._id],
    ] as const) {
      const request = await ctx.db
        .query("friendRequests")
        .withIndex("by_pair", (q) => q.eq("requesterId", requester).eq("recipientId", recipient))
        .unique();
      if (request) await ctx.db.delete(request._id);
    }

    // Anything still ringing between the two of them.
    for (const [caller, recipient] of [
      [me._id, userId],
      [userId, me._id],
    ] as const) {
      const rings = await ctx.db
        .query("callRings")
        .withIndex("by_recipient", (q) => q.eq("recipientId", recipient))
        .collect();
      for (const ring of rings) {
        if (ring.callerId !== caller) continue;
        if (ring.expiryJobId) await ctx.scheduler.cancel(ring.expiryJobId).catch(() => {});
        await ctx.db.delete(ring._id);
      }
    }

    // Tuck the 1:1 DM out of the blocker's list. It comes back by itself if
    // they unblock and someone writes, and nothing is deleted.
    const dm = await ctx.db
      .query("conversations")
      .withIndex("by_dm_key", (q) => q.eq("dmKey", dmKeyFor(me._id, userId)))
      .unique();
    if (dm) {
      const mine = await ctx.db
        .query("conversationMembers")
        .withIndex("by_conversation_user", (q) => q.eq("conversationId", dm._id).eq("userId", me._id))
        .unique();
      if (mine) await ctx.db.patch(mine._id, { closedAt: now });
    }

    await dropConversationCaches(ctx, me._id, userId);
  },
});

export const unblockUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const windows = await windowsAgainst(ctx, me._id, userId);
    // Friendship isn't restored: they have to be added again, as with any
    // other stranger.
    await closeOpen(ctx, windows, "block", Date.now());
    await dropConversationCaches(ctx, me._id, userId);
  },
});

/**
 * How the caller currently stands towards one person, for a profile card or
 * menu to show "Ignore" or "Stop ignoring". Only the caller's own side: whether
 * *they* have blocked the caller is never revealed.
 */
export const statusWith = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const none = { blocked: false, ignored: false, ignoredUntil: null as number | null };
    const me = await getCurrentUserOrNull(ctx);
    if (!me || me._id === userId) return none;
    const windows = await windowsAgainst(ctx, me._id, userId);
    const now = Date.now();
    const until = ignoredUntil(windows, now);
    return {
      blocked: hasOpen(windows, now, "block"),
      ignored: until !== undefined,
      ignoredUntil: until ?? null,
    };
  },
});

/** Everyone the caller currently blocks or ignores, so they can be undone from
 * one place. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const empty = {
      blocked: [] as Person[],
      ignored: [] as (Person & { until: number | null })[],
    };
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return empty;

    const now = Date.now();
    const byTarget = await windowsByTarget(ctx, me._id);
    const blocked: Person[] = [];
    const ignored: (Person & { until: number | null })[] = [];

    for (const [targetId, windows] of byTarget) {
      const isBlocked = hasOpen(windows, now, "block");
      const until = ignoredUntil(windows, now);
      if (!isBlocked && until === undefined) continue;
      const user = await ctx.db.get(targetId);
      if (!user) continue;
      const person: Person = {
        id: user._id,
        name: user.name,
        username: user.username,
        imageUrl: user.imageUrl,
      };
      if (isBlocked) blocked.push(person);
      else ignored.push({ ...person, until: until ?? null });
    }
    return { blocked, ignored };
  },
});

type Person = { id: Id<"users">; name: string; username: string; imageUrl?: string };

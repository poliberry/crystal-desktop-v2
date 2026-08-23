import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { activitiesOf } from "./lib/activities";
import {
  HISTORY_WINDOW_MS,
  closeOpenSessions,
  recordGameTransitions,
} from "./lib/gameHistory";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

const STALE_MS = 60_000;

/** Rich Presence payload pushed by the desktop client. Mirrors
 * `activityValidator` in convex/schema.ts minus `positionUpdatedAt`, which
 * is stamped here from the server clock. */
const activityInputValidator = v.object({
  type: v.union(
    v.literal("playing"),
    v.literal("listening"),
    v.literal("watching"),
    v.literal("streaming")
  ),
  name: v.string(),
  details: v.optional(v.string()),
  state: v.optional(v.string()),
  /** Album name, for music. */
  album: v.optional(v.string()),
  /** Track length in ms, when the player reports one. */
  durationMs: v.optional(v.number()),
  /** Playback position in ms, accurate as of `positionUpdatedAt`. */
  positionMs: v.optional(v.number()),
  imageUrl: v.optional(v.string()),
  startedAt: v.optional(v.number()),
  source: v.optional(v.string()),
});

/** Two activity lists are "the same" for dedupe purposes when everything the
 * client sent matches — the server-stamped `positionUpdatedAt` is derived,
 * so comparing it would make every write look like a change. */
function sameStoredActivities(a: unknown[], b: unknown[]): boolean {
  const strip = (value: unknown) => {
    if (!value || typeof value !== "object") return null;
    const { positionUpdatedAt: _ignored, ...rest } = value as Record<string, unknown>;
    // Key order is stable: both sides are built from the same validator.
    return JSON.stringify(Object.entries(rest).sort());
  };
  return a.length === b.length && a.every((item, i) => strip(item) === strip(b[i]));
}

const manualStatusValidator = v.union(
  v.literal("online"),
  v.literal("idle"),
  v.literal("dnd"),
  v.literal("invisible")
);

function computeEffective(manualStatus: "online" | "idle" | "dnd" | "invisible", isIdle: boolean) {
  if (manualStatus === "invisible") return "offline" as const;
  if (manualStatus === "dnd") return "dnd" as const;
  if (manualStatus === "idle") return "idle" as const;
  return isIdle ? ("idle" as const) : ("online" as const);
}

export const getMine = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    return ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .unique();
  },
});

export const getUserPresence = query({
  args: {
    userId: v.id("users")
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
  },
});


export const heartbeat = mutation({
  args: { isIdle: v.boolean() },
  handler: async (ctx, { isIdle }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return;

    const existing = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .unique();
    const manualStatus = existing?.manualStatus ?? "online";
    const effective = computeEffective(manualStatus, isIdle);

    if (existing) {
      await ctx.db.patch(existing._id, { isIdle, lastHeartbeat: Date.now(), effective });
    } else {
      await ctx.db.insert("presence", {
        userId: me._id,
        manualStatus,
        isIdle,
        lastHeartbeat: Date.now(),
        effective,
      });
    }
  },
});

export const setStatus = mutation({
  args: { manualStatus: manualStatusValidator },
  handler: async (ctx, { manualStatus }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .unique();
    const isIdle = existing?.isIdle ?? false;
    const effective = computeEffective(manualStatus, isIdle);

    if (existing) {
      await ctx.db.patch(existing._id, {
        manualStatus,
        effective,
        lastHeartbeat: Date.now(),
        ...(manualStatus === "invisible" ? { activities: [], activity: undefined } : {}),
      });
    } else {
      await ctx.db.insert("presence", {
        userId: me._id,
        manualStatus,
        isIdle,
        lastHeartbeat: Date.now(),
        effective,
      });
    }
  },
});

/**
 * Publish (or clear) the current Rich Presence activity. Called by
 * `useRichPresence` whenever the desktop layer reports a change — passing
 * `activity: undefined` clears it, which is what happens when the game
 * exits or music stops.
 *
 * Invisible users never broadcast an activity: the presence row is still
 * written so the rest of the app keeps working, but the field is dropped so
 * nobody can infer they're online from what they're playing.
 */
export const setActivities = mutation({
  args: { activities: v.array(activityInputValidator) },
  handler: async (ctx, { activities }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return;

    const existing = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .unique();
    const manualStatus = existing?.manualStatus ?? "online";
    const now = Date.now();
    const stamped = activities.map((activity) =>
      activity.positionMs !== undefined ? { ...activity, positionUpdatedAt: now } : activity
    );
    const next = manualStatus === "invisible" ? [] : stamped;

    if (existing) {
      const previous = activitiesOf(existing);
      if (sameStoredActivities(previous, next)) return;
      // Clear the legacy single-activity field on the way past, so a row is
      // never carrying two competing sources of truth.
      await ctx.db.patch(existing._id, { activities: next, activity: undefined });
      await recordGameTransitions(ctx, me._id, previous, next);
      return;
    }
    await ctx.db.insert("presence", {
      userId: me._id,
      manualStatus,
      isIdle: false,
      lastHeartbeat: now,
      effective: computeEffective(manualStatus, false),
      activities: next,
    });
    await recordGameTransitions(ctx, me._id, [], next);
  },
});

/**
 * Games this user has played recently, most recent first — the profile
 * dialog's "Recent activity" list.
 *
 * Anything they're playing *right now* is filtered out: it's already shown
 * above under "Current activity", and listing it twice reads as a bug.
 */
export const recentGames = query({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, { userId, limit }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];

    const presence = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const playingNow = new Set(
      activitiesOf(presence)
        .filter((a) => a.type === "playing")
        .map((a) => a.name.toLowerCase())
    );

    const cutoff = Date.now() - HISTORY_WINDOW_MS;
    const rows = await ctx.db
      .query("gameHistory")
      .withIndex("by_user_last_played", (q) =>
        q.eq("userId", userId).gt("lastPlayedAt", cutoff)
      )
      .order("desc")
      .take(Math.min(limit ?? 10, 30) + playingNow.size);

    return rows
      .filter((row) => !playingNow.has(row.gameKey))
      .slice(0, limit ?? 10)
      .map((row) => ({
        id: row._id,
        name: row.name,
        imageUrl: row.imageUrl,
        lastPlayedAt: row.lastPlayedAt,
        totalMs: row.totalMs,
      }));
  },
});

export const sweepStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_MS;
    const stale = await ctx.db
      .query("presence")
      .withIndex("by_last_heartbeat", (q) => q.lt("lastHeartbeat", cutoff))
      .collect();
    for (const row of stale) {
      // A client that stopped heartbeating can't tell us its game exited
      // either — drop the activities with the status so profile cards don't
      // keep showing a stale "Playing …" for an offline user.
      const running = activitiesOf(row);
      if (row.effective !== "offline" || running.length > 0) {
        await ctx.db.patch(row._id, {
          effective: "offline",
          activities: [],
          activity: undefined,
        });
      }
      if (running.length > 0) await closeOpenSessions(ctx, row.userId);
    }
  },
});

/** Faces per call row before it collapses to "+N". */
const CALL_AVATAR_LIMIT = 6;

/**
 * What's happening right now among the people you'd care about: who's sitting
 * in a call you could join, and what your friends are playing or listening to.
 *
 * Calls are scoped to places the caller can actually reach — voice channels in
 * their servers, and their own group/DM conversations — because "join" is the
 * point of showing them. Activities are scoped to friends: a server of a
 * thousand people playing games isn't a feed, it's noise.
 */
export const activeNow = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return { calls: [], activities: [] };

    const summarise = async (userId: Id<"users">) => {
      const user = await ctx.db.get(userId);
      return {
        userId,
        name: user?.name ?? "Unknown",
        imageUrl: user?.imageUrl,
      };
    };

    const calls: {
      key: string;
      /** Where it is — "#general" or a group's name. */
      name: string;
      /** The server it belongs to, for a voice channel. */
      context: string | null;
      channelId: Id<"channels"> | null;
      conversationId: Id<"conversations"> | null;
      communityId: Id<"communities"> | null;
      participants: { userId: Id<"users">; name: string; imageUrl?: string }[];
      participantCount: number;
    }[] = [];

    const communityMemberships = await ctx.db
      .query("communityMembers")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();

    for (const membership of communityMemberships) {
      const community = await ctx.db.get(membership.communityId);
      if (!community) continue;
      const channels = await ctx.db
        .query("channels")
        .withIndex("by_community", (q) => q.eq("communityId", membership.communityId))
        .collect();

      for (const channel of channels) {
        if (channel.type !== "voice") continue;
        const rows = await ctx.db
          .query("channelCallParticipants")
          .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
          .collect();
        if (rows.length === 0) continue;

        calls.push({
          key: `channel:${channel._id}`,
          name: `#${channel.name}`,
          context: community.name,
          channelId: channel._id,
          conversationId: null,
          communityId: community._id,
          participants: await Promise.all(
            rows.slice(0, CALL_AVATAR_LIMIT).map((row) => summarise(row.userId))
          ),
          participantCount: rows.length,
        });
      }
    }

    const conversationMemberships = await ctx.db
      .query("conversationMembers")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();

    for (const membership of conversationMemberships) {
      const rows = await ctx.db
        .query("callParticipants")
        .withIndex("by_conversation", (q) => q.eq("conversationId", membership.conversationId))
        .collect();
      if (rows.length === 0) continue;
      const conversation = await ctx.db.get(membership.conversationId);
      if (!conversation) continue;

      const participants = await Promise.all(
        rows.slice(0, CALL_AVATAR_LIMIT).map((row) => summarise(row.userId))
      );
      calls.push({
        key: `conversation:${conversation._id}`,
        // A DM has no name of its own, so whoever's in the call names it.
        name:
          conversation.name ??
          participants.filter((p) => p.userId !== me._id).map((p) => p.name).join(", ") ??
          "Call",
        context: null,
        channelId: null,
        conversationId: conversation._id,
        communityId: null,
        participants,
        participantCount: rows.length,
      });
    }

    const friendships = await ctx.db
      .query("friendships")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .collect();

    const activities = (
      await Promise.all(
        friendships.map(async (friendship) => {
          const presence = await ctx.db
            .query("presence")
            .withIndex("by_user", (q) => q.eq("userId", friendship.friendId))
            .unique();
          // Someone offline isn't doing anything, whatever their last
          // reported activity says.
          if (!presence || presence.effective === "offline") return null;
          const list = activitiesOf(presence);
          if (list.length === 0) return null;
          const friend = await ctx.db.get(friendship.friendId);
          if (!friend) return null;
          return {
            userId: friend._id,
            name: friend.name,
            imageUrl: friend.imageUrl,
            status: presence.effective,
            activities: list,
          };
        })
      )
    ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return { calls, activities };
  },
});

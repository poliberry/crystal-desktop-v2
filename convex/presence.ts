import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  type MutationCtx,
  query,
} from "./_generated/server";
import { activitiesOf } from "./lib/activities";
import {
  HISTORY_WINDOW_MS,
  closeOpenSessions,
  recordGameTransitions,
} from "./lib/gameHistory";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

/**
 * How long a device may go without heartbeating before it stops counting as
 * live. Clients beat every 20s, so this tolerates two missed beats.
 */
const STALE_MS = 60_000;

/**
 * Devices that never registered a session — a client running a build from
 * before `presenceSessions` existed — are still represented by the legacy
 * `presence.lastHeartbeat`. Treated as one implicit desktop session so an old
 * client doesn't read as offline mid-rollout.
 */
const LEGACY_DEVICE_ID = "legacy";

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

type LiveSession = { platform: "desktop" | "mobile" | "web"; isIdle: boolean };

/** This user's devices that have beaten recently enough to still count. */
async function liveSessions(
  ctx: MutationCtx,
  userId: Id<"users">,
  now: number
): Promise<LiveSession[]> {
  const cutoff = now - STALE_MS;
  const rows = await ctx.db
    .query("presenceSessions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return rows
    .filter((row) => row.lastHeartbeat > cutoff)
    .map((row) => ({ platform: row.platform, isIdle: row.isIdle }));
}

/**
 * Recompute one user's single `presence` row from their live devices.
 *
 * This is the only place `effective` is written, so there's exactly one rule
 * for it: a user is offline when none of their devices are beating, and
 * otherwise whatever their manual status says — never something a heartbeat
 * decided on its own. `manualStatus` is read here, never written, so going
 * offline and coming back restores the status the user chose instead of
 * resetting them to "online".
 *
 * Idle is the conjunction across devices: a phone locked in a pocket doesn't
 * make someone idle while they're using their desktop.
 *
 * Rich Presence is desktop-only (it comes from `electron/richPresence.ts`), so
 * activities are cleared exactly when the last desktop session goes — not when
 * the user goes offline, which would drop them while a phone is still
 * connected, and not never, which would leave a stale "Playing …" forever.
 */
async function reconcile(ctx: MutationCtx, userId: Id<"users">): Promise<void> {
  const now = Date.now();
  const row = await ctx.db
    .query("presence")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!row) return;

  const sessions = await liveSessions(ctx, userId, now);
  // An old client only writes `presence.lastHeartbeat`, so a fresh timestamp
  // with no session rows behind it is that client, still running.
  const legacyAlive = sessions.length === 0 && row.lastHeartbeat > now - STALE_MS;
  const online = legacyAlive || sessions.length > 0;
  const anyDesktop =
    legacyAlive || sessions.some((session) => session.platform === "desktop");

  const isIdle =
    sessions.length > 0 ? sessions.every((session) => session.isIdle) : row.isIdle;
  const effective = online
    ? computeEffective(row.manualStatus, isIdle)
    : ("offline" as const);

  const dropActivities = !anyDesktop && activitiesOf(row).length > 0;
  if (row.effective === effective && row.isIdle === isIdle && !dropActivities) return;

  await ctx.db.patch(row._id, {
    effective,
    isIdle,
    ...(dropActivities ? { activities: [], activity: undefined } : {}),
  });
  if (dropActivities) await closeOpenSessions(ctx, userId);
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


/**
 * Report that this device is still here.
 *
 * `deviceId` and `platform` are optional so a client from before per-device
 * sessions keeps working: it lands on the shared `LEGACY_DEVICE_ID` row and is
 * treated as a desktop.
 *
 * Note what this deliberately does *not* do: it never writes `manualStatus`,
 * and it never decides `effective` on its own. A heartbeat only says "this
 * device is awake"; what that means for the user's visible status is
 * `reconcile`'s call, made from every device at once. That is what stops a
 * phone from reverting a status the user set, and what makes reopening the app
 * restore the status they had rather than leaving them on the offline the
 * stale sweep wrote.
 */
export const heartbeat = mutation({
  args: {
    isIdle: v.boolean(),
    deviceId: v.optional(v.string()),
    platform: v.optional(
      v.union(v.literal("desktop"), v.literal("mobile"), v.literal("web"))
    ),
  },
  handler: async (ctx, { isIdle, deviceId, platform }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return;
    const now = Date.now();

    const session = await ctx.db
      .query("presenceSessions")
      .withIndex("by_user_device", (q) =>
        q.eq("userId", me._id).eq("deviceId", deviceId ?? LEGACY_DEVICE_ID)
      )
      .unique();
    if (session) {
      await ctx.db.patch(session._id, { isIdle, lastHeartbeat: now });
    } else {
      await ctx.db.insert("presenceSessions", {
        userId: me._id,
        deviceId: deviceId ?? LEGACY_DEVICE_ID,
        platform: platform ?? "desktop",
        isIdle,
        lastHeartbeat: now,
      });
    }

    const existing = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .unique();
    if (!existing) {
      await ctx.db.insert("presence", {
        userId: me._id,
        manualStatus: "online",
        isIdle,
        lastHeartbeat: now,
        effective: computeEffective("online", isIdle),
      });
      return;
    }
    await ctx.db.patch(existing._id, { lastHeartbeat: now });
    await reconcile(ctx, me._id);
  },
});

/**
 * Drop this device's session — sign-out, or a client shutting down cleanly.
 *
 * Without it a user stays online for up to `STALE_MS` after signing out. Other
 * devices are untouched: signing out on a phone doesn't take a desktop session
 * with it.
 */
export const endSession = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return;
    const session = await ctx.db
      .query("presenceSessions")
      .withIndex("by_user_device", (q) =>
        q.eq("userId", me._id).eq("deviceId", deviceId)
      )
      .unique();
    if (!session) return;
    await ctx.db.delete(session._id);
    await reconcile(ctx, me._id);
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

    if (existing) {
      await ctx.db.patch(existing._id, {
        manualStatus,
        ...(manualStatus === "invisible" ? { activities: [], activity: undefined } : {}),
      });
      // Picking a status isn't a sign of life: it can arrive from a client
      // whose last heartbeat already aged out, and it must not bump
      // `lastHeartbeat` — doing that is what used to let the status switcher
      // quietly mark a signed-out device online again. Recompute from the
      // devices actually beating instead.
      await reconcile(ctx, me._id);
      return;
    }
    await ctx.db.insert("presence", {
      userId: me._id,
      manualStatus,
      isIdle,
      lastHeartbeat: Date.now(),
      effective: computeEffective(manualStatus, isIdle),
    });
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

/**
 * Retire devices that stopped beating, then recompute the users they belonged
 * to.
 *
 * The recompute is the point. Deleting a stale session decides nothing by
 * itself — a user with a dead phone session and a live desktop one stays
 * exactly as they were, which is the behaviour this whole split exists for.
 * Only when the last session goes does `reconcile` write "offline".
 *
 * Presence rows are swept alongside for two cases sessions don't cover: a
 * legacy client whose implicit session lives on `presence.lastHeartbeat`, and
 * a row left reading "online" by an earlier build.
 */
export const sweepStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_MS;
    const touched = new Set<Id<"users">>();

    const staleSessions = await ctx.db
      .query("presenceSessions")
      .withIndex("by_last_heartbeat", (q) => q.lt("lastHeartbeat", cutoff))
      .collect();
    for (const session of staleSessions) {
      await ctx.db.delete(session._id);
      touched.add(session.userId);
    }

    const stalePresence = await ctx.db
      .query("presence")
      .withIndex("by_last_heartbeat", (q) => q.lt("lastHeartbeat", cutoff))
      .collect();
    for (const row of stalePresence) {
      if (row.effective !== "offline" || activitiesOf(row).length > 0) {
        touched.add(row.userId);
      }
    }

    for (const userId of touched) await reconcile(ctx, userId);
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

    const summarise = async (
      userId: Id<"users">,
      row?: { streaming?: boolean; streamThumbnailUrl?: string }
    ) => {
      const user = await ctx.db.get(userId);
      return {
        userId,
        name: user?.name ?? "Unknown",
        imageUrl: user?.imageUrl,
        streaming: row?.streaming ?? false,
        streamThumbnailUrl: row?.streamThumbnailUrl,
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
      participants: {
        userId: Id<"users">;
        name: string;
        imageUrl?: string;
        streaming: boolean;
        streamThumbnailUrl?: string;
      }[];
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
            rows.slice(0, CALL_AVATAR_LIMIT).map((row) => summarise(row.userId, row))
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
        rows.slice(0, CALL_AVATAR_LIMIT).map((row) => summarise(row.userId, row))
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

/**
 * Where a user is screen sharing right now, if anywhere the caller can see.
 *
 * Streaming is an activity like any other as far as a profile card is
 * concerned — it just isn't reported through the Rich Presence pipeline,
 * because it's something the app knows about itself. This is what lets the
 * card list it alongside "Playing …" and count it in the stack.
 *
 * Scoped to shared ground: a voice channel in a community both people are in,
 * or a conversation the caller is a member of. A stream somewhere the caller
 * has no business being isn't reported at all.
 */
export const streamOf = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;

    const myCommunities = new Set(
      (
        await ctx.db
          .query("communityMembers")
          .withIndex("by_user", (q) => q.eq("userId", me._id))
          .collect()
      ).map((m) => m.communityId as string)
    );

    const channelRows = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const row of channelRows) {
      if (!row.streaming) continue;
      const channel = await ctx.db.get(row.channelId);
      if (!channel || !myCommunities.has(channel.communityId as string)) continue;
      const community = await ctx.db.get(channel.communityId);
      return {
        kind: "channel" as const,
        channelId: channel._id,
        communityId: channel.communityId,
        where: `#${channel.name}`,
        context: community?.name ?? null,
        thumbnailUrl: row.streamThumbnailUrl,
      };
    }

    const conversationRows = await ctx.db
      .query("callParticipants")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const row of conversationRows) {
      if (!row.streaming) continue;
      const membership = await ctx.db
        .query("conversationMembers")
        .withIndex("by_conversation_user", (q) =>
          q.eq("conversationId", row.conversationId).eq("userId", me._id)
        )
        .unique();
      if (!membership) continue;
      const conversation = await ctx.db.get(row.conversationId);
      return {
        kind: "conversation" as const,
        conversationId: row.conversationId,
        where: conversation?.name ?? "your call",
        context: null,
        thumbnailUrl: row.streamThumbnailUrl,
      };
    }

    return null;
  },
});

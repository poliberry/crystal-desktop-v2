import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { r2DeleteByUrl, r2PublicUrlForKey } from "./lib/r2";
import { requireCommunity, requireMember } from "./communities";
import {
  PERMISSIONS,
  can,
  getChannelPermissions,
  requireAbove,
  requireCommunityPermission,
} from "./permissions";
import { visibleActivities } from "./lib/activities";
import { notifyUsers } from "./notifications";
import { MAX_PROFILE_ASSET_BYTES, requireWithinUploadLimit } from "./uploadLimits";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

async function requireChannel(ctx: { db: { get: (id: Id<"channels">) => Promise<Doc<"channels"> | null> } }, channelId: Id<"channels">) {
  const channel = await ctx.db.get(channelId);
  if (!channel) throw new Error("Channel not found.");
  return channel;
}

export const list = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const community = await ctx.db.get(communityId);
    if (!community) return [];
    const membership = await ctx.db
      .query("communityMembers")
      .withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", me._id))
      .unique();
    if (!membership) return [];
    // Redis cache per-user (permission-filtered) — short TTL, explicit invalidate on channel create/reorder
    try {
      const { cacheGetJson } = await import("./cache");
      const key = `community:${communityId}:user:${me._id}:channels`;
      const cached = await cacheGetJson<any>(key);
      if (cached) return cached;
    } catch {}
    // fetch below, will cache after

    const channels = await ctx.db
      .query("channels")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();

    const visible = await Promise.all(
      channels.map(async (c) => {
        const perms = await getChannelPermissions(ctx, community, c._id, me._id);
        if ((perms & PERMISSIONS.VIEW_CHANNELS) === 0 && (perms & PERMISSIONS.ADMINISTRATOR) === 0) {
          return null;
        }
        return {
          id: c._id,
          name: c.name,
          type: c.type,
          topic: c.topic,
          categoryId: c.categoryId ?? null,
          position: c.position,
          permissions: perms,
        };
      })
    );

    const result = visible
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => a.position - b.position);
    try {
      const { cacheSetJson } = await import("./cache");
      const key = `community:${communityId}:user:${me._id}:channels`;
      await cacheSetJson(key, result, 60);
    } catch {}
    return result;
  },
});

export const get = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    const channel = await ctx.db.get(channelId);
    if (!channel) return null;
    const community = await ctx.db.get(channel.communityId);
    if (!community) return null;
    await requireMember(ctx, channel.communityId, me._id);
    return {
      id: channel._id,
      communityId: channel.communityId,
      communityName: community.name,
      name: channel.name,
      type: channel.type,
      topic: channel.topic,
      // Decoration, carried by the same read the view already does rather
      // than by a second query — the header and the message list both need it
      // on the first frame, and a late arrival is a visible repaint.
      backgroundUrl: channel.backgroundUrl,
      backgroundOpacity: channel.backgroundOpacity,
      bannerUrl: channel.bannerUrl,
      bannerTitle: channel.bannerTitle,
      bannerDescription: channel.bannerDescription,
    };
  },
});

export const create = mutation({
  args: {
    communityId: v.id("communities"),
    name: v.string(),
    type: v.union(v.literal("text"), v.literal("voice")),
    categoryId: v.optional(v.id("channelCategories")),
  },
  handler: async (ctx, { communityId, name, type, categoryId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_CHANNELS);

    const trimmed = name.trim();
    if (!trimmed) throw new Error("Channel name can't be empty.");

    const existing = await ctx.db
      .query("channels")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
    const position = existing.reduce((max, c) => Math.max(max, c.position), -1) + 1;

    const channelId = await ctx.db.insert("channels", {
      communityId,
      name: trimmed,
      type,
      categoryId,
      position,
      createdAt: Date.now(),
    });
    try {
      const { cacheInvalidateKeys } = await import("./cache");
      await cacheInvalidateKeys(`community:${communityId}:user:${me._id}:channels`, `community:${communityId}:channels`);
    } catch {}
    return channelId;
  },
});

export const update = mutation({
  args: {
    channelId: v.id("channels"),
    name: v.optional(v.string()),
    topic: v.optional(v.string()),
  },
  handler: async (ctx, { channelId, name, topic }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await requireChannel(ctx, channelId);
    const community = await requireCommunity(ctx, channel.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_CHANNELS);

    const patch: { name?: string; topic?: string } = {};
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Channel name can't be empty.");
      patch.name = trimmed;
    }
    if (topic !== undefined) patch.topic = topic;
    if (Object.keys(patch).length > 0) await ctx.db.patch(channelId, patch);
    try {
      const { cacheInvalidateKeys } = await import("./cache");
      await cacheInvalidateKeys(`community:${channel.communityId}:user:${me._id}:channels`, `channel:${channelId}:meta`);
    } catch {}
  },
});

/** Reorders (and, if it changed, re-parents) every channel in one bucket —
 * a category, or the uncategorized group (`categoryId: null`) — in one call.
 * The dragged-into bucket's full new ordering is sent, including the moved
 * channel, so this handles both a same-bucket reorder and a cross-category
 * drag with the same mutation. */
export const reorder = mutation({
  args: {
    communityId: v.id("communities"),
    categoryId: v.union(v.id("channelCategories"), v.null()),
    orderedChannelIds: v.array(v.id("channels")),
  },
  handler: async (ctx, { communityId, categoryId, orderedChannelIds }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_CHANNELS);

    for (let i = 0; i < orderedChannelIds.length; i++) {
      const channel = await ctx.db.get(orderedChannelIds[i]);
      if (channel && channel.communityId === communityId) {
        await ctx.db.patch(orderedChannelIds[i], { position: i, categoryId: categoryId ?? undefined });
      }
    }
    try {
      const { cacheInvalidateKeys } = await import("./cache");
      await cacheInvalidateKeys(`community:${communityId}:user:${me._id}:channels`);
    } catch {}
  },
});

export const remove = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await requireChannel(ctx, channelId);
    const community = await requireCommunity(ctx, channel.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_CHANNELS);

    const [messages, overwrites, voiceParticipants] = await Promise.all([
      ctx.db
        .query("channelMessages")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
      ctx.db
        .query("channelPermissionOverwrites")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
      ctx.db
        .query("channelCallParticipants")
        .withIndex("by_channel", (q) => q.eq("channelId", channelId))
        .collect(),
    ]);
    for (const message of messages) {
      const attachments = await ctx.db
        .query("channelMessageAttachments")
        .withIndex("by_message", (q) => q.eq("messageId", message._id))
        .collect();
      for (const attachment of attachments) await ctx.db.delete(attachment._id);
      await ctx.db.delete(message._id);
    }
    for (const overwrite of overwrites) await ctx.db.delete(overwrite._id);
    for (const participant of voiceParticipants) await ctx.db.delete(participant._id);
    await ctx.db.delete(channelId);
    try {
      const { cacheInvalidateKeys } = await import("./cache");
      await cacheInvalidateKeys(`community:${community.communityId}:user:${me._id}:channels`, `channel:${channelId}:meta`, `channel:${channelId}:messages:30`, `channel:${channelId}:messages:50`);
    } catch {}
  },
});

export const listOverwrites = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const channel = await ctx.db.get(channelId);
    if (!channel) return [];
    await requireMember(ctx, channel.communityId, me._id);
    const overwrites = await ctx.db
      .query("channelPermissionOverwrites")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .collect();
    return overwrites.map((o) => ({
      id: o._id,
      roleId: o.roleId,
      userId: o.userId,
      allow: o.allow,
      deny: o.deny,
    }));
  },
});

export const setOverwrite = mutation({
  args: {
    channelId: v.id("channels"),
    roleId: v.optional(v.id("roles")),
    userId: v.optional(v.id("users")),
    allow: v.number(),
    deny: v.number(),
  },
  handler: async (ctx, { channelId, roleId, userId, allow, deny }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await requireChannel(ctx, channelId);
    const community = await requireCommunity(ctx, channel.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_CHANNELS);
    if (!roleId && !userId) throw new Error("An overwrite needs a role or a member.");

    const existing = await ctx.db
      .query("channelPermissionOverwrites")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .collect();
    const match = existing.find((o) =>
      roleId ? o.roleId === roleId : o.userId === userId
    );

    if (match) {
      await ctx.db.patch(match._id, { allow, deny });
    } else {
      await ctx.db.insert("channelPermissionOverwrites", { channelId, roleId, userId, allow, deny });
    }
  },
});

export const removeOverwrite = mutation({
  args: { overwriteId: v.id("channelPermissionOverwrites") },
  handler: async (ctx, { overwriteId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const overwrite = await ctx.db.get(overwriteId);
    if (!overwrite) return;
    const channel = await requireChannel(ctx, overwrite.channelId);
    const community = await requireCommunity(ctx, channel.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_CHANNELS);
    await ctx.db.delete(overwriteId);
  },
});

/**
 * Everyone currently connected to a voice channel.
 *
 * Identity here follows the same rule as the member list and the message
 * author line: whatever the user set as their profile *for this community*
 * wins, falling back to their global profile field by field — so a per-server
 * nickname with no per-server avatar still shows their normal picture.
 */
export const listVoiceParticipants = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const channel = await ctx.db.get(channelId);
    if (!channel) return [];
    const rows = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .collect();
    const participants = await Promise.all(
      rows.map(async (row) => {
        const user = await ctx.db.get(row.userId);
        if (!user) return null;
        const [serverProfile, presence] = await Promise.all([
          ctx.db
            .query("serverProfiles")
            .withIndex("by_user_community", (q) =>
              q.eq("userId", row.userId).eq("communityId", channel.communityId)
            )
            .unique(),
          ctx.db
            .query("presence")
            .withIndex("by_user", (q) => q.eq("userId", row.userId))
            .unique(),
        ]);
        return {
          id: user._id,
          name: serverProfile?.displayName ?? user.name,
          username: user.username,
          imageUrl: serverProfile?.imageUrl ?? user.imageUrl,
          muted: row.muted ?? false,
          deafened: row.deafened ?? false,
          streaming: row.streaming ?? false,
          serverMuted: row.serverMuted ?? false,
          serverDeafened: row.serverDeafened ?? false,
          /** Only meaningful while `streaming` — see the schema. */
          streamThumbnailUrl: row.streamThumbnailUrl,
          activities: visibleActivities(presence, user),
        };
      })
    );
    return participants.filter((p): p is NonNullable<typeof p> => p !== null);
  },
});

/**
 * Server-mute or server-deafen someone in a voice channel.
 *
 * Enforcement is client-side (the target's own client applies it to its
 * LiveKit tracks), so this is bookkeeping the target watches rather than a
 * hard cut — the same shape as the self-set flags beside it. Passing
 * `undefined` for a field leaves it alone, so muting doesn't clobber deafen.
 */
export const setMemberVoiceState = mutation({
  args: {
    channelId: v.id("channels"),
    userId: v.id("users"),
    serverMuted: v.optional(v.boolean()),
    serverDeafened: v.optional(v.boolean()),
  },
  handler: async (ctx, { channelId, userId, serverMuted, serverDeafened }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await ctx.db.get(channelId);
    if (!channel) throw new Error("Channel not found.");
    const community = await requireCommunity(ctx, channel.communityId);

    if (serverMuted !== undefined) {
      await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MUTE_MEMBERS);
    }
    if (serverDeafened !== undefined) {
      await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.DEAFEN_MEMBERS);
    }
    await requireAbove(ctx, community, me._id, userId);

    const row = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .unique();
    if (!row) throw new Error("That member isn't in this channel.");

    await ctx.db.patch(row._id, {
      ...(serverMuted !== undefined ? { serverMuted } : {}),
      ...(serverDeafened !== undefined ? { serverDeafened } : {}),
    });
  },
});

/**
 * Disconnect someone from a voice channel by removing their participant row.
 * Their client is subscribed to that row and leaves the call when it vanishes
 * (see CallProvider), which also covers them being kicked or banned.
 */
export const disconnectMember = mutation({
  args: { channelId: v.id("channels"), userId: v.id("users") },
  handler: async (ctx, { channelId, userId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await ctx.db.get(channelId);
    if (!channel) throw new Error("Channel not found.");
    const community = await requireCommunity(ctx, channel.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MOVE_MEMBERS);
    await requireAbove(ctx, community, me._id, userId);

    const row = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

/**
 * Mirror the caller's live mute / deafen / screen-share state onto their
 * voice-participant row. Called by the connected client whenever any of them
 * changes; a no-op for anyone not actually in the channel's call, so it can't
 * be used to fake state in a channel you aren't in.
 */
export const setVoiceState = mutation({
  args: {
    channelId: v.id("channels"),
    muted: v.boolean(),
    deafened: v.boolean(),
    streaming: v.boolean(),
  },
  handler: async (ctx, { channelId, muted, deafened, streaming }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return;
    const row = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", me._id))
      .unique();
    if (!row) return;
    if (row.muted === muted && row.deafened === deafened && row.streaming === streaming) return;
    const startedStreaming = streaming && !(row.streaming ?? false);
    await ctx.db.patch(row._id, { muted, deafened, streaming });
    if (startedStreaming) {
      await notifyVoiceChannelActivity(ctx, {
        channelId,
        actorId: me._id,
        type: "stream_started",
        verb: "started streaming",
      });
    }
  },
});

/**
 * "<name>" / "joined voice in #<channel> / <server>" (or "started streaming
 * in …") for a community voice channel — but only to members who are
 * **friends of the actor** and can
 * actually see the channel, and who aren't already in that call. A busy server
 * shouldn't light up every time a stranger channel-hops; a friend showing up
 * in voice is the thing worth a nudge. Each recipient's DND/Busy is checked by
 * `notifyUsers`.
 */
async function notifyVoiceChannelActivity(
  ctx: MutationCtx,
  params: {
    channelId: Id<"channels">;
    actorId: Id<"users">;
    type: "call_started" | "stream_started";
    /** The verb phrase the notification body opens with — "joined voice" /
     * "started streaming". The channel and server are appended here. */
    verb: string;
  }
): Promise<void> {
  const channel = await ctx.db.get(params.channelId);
  if (!channel) return;
  const community = await ctx.db.get(channel.communityId);
  if (!community) return;
  const [actor, friendships, members, inCall] = await Promise.all([
    ctx.db.get(params.actorId),
    ctx.db
      .query("friendships")
      .withIndex("by_owner", (q) => q.eq("ownerId", params.actorId))
      .collect(),
    ctx.db
      .query("communityMembers")
      .withIndex("by_community", (q) => q.eq("communityId", channel.communityId))
      .collect(),
    ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel", (q) => q.eq("channelId", params.channelId))
      .collect(),
  ]);
  if (!actor) return;

  const friendIds = new Set(friendships.map((f) => f.friendId));
  const alreadyInCall = new Set(inCall.map((p) => p.userId));

  const recipients: Id<"users">[] = [];
  for (const member of members) {
    if (member.userId === params.actorId) continue;
    if (!friendIds.has(member.userId)) continue;
    if (alreadyInCall.has(member.userId)) continue;
    const perms = await getChannelPermissions(
      ctx,
      community,
      params.channelId,
      member.userId
    );
    if (!can(perms, PERMISSIONS.VIEW_CHANNELS)) continue;
    recipients.push(member.userId);
  }
  if (recipients.length === 0) return;

  await notifyUsers(ctx, {
    userIds: recipients,
    actorId: params.actorId,
    type: params.type,
    communityId: channel.communityId,
    channelId: params.channelId,
    title: actor.name,
    body: `${params.verb} in #${channel.name} / ${community.name}`,
  });
}

// --- Voice channel join/leave plumbing (used by the "use node" action in
// channelCalls.ts, which can't touch ctx.db directly) ------------------------

/** Every channel voice-participant row, for the LiveKit reconciliation sweep
 * (convex/lib/callReconciliation.ts) — see calls.ts's listAllParticipants
 * for why this needs to exist independent of the explicit leave action. */
export const listAllVoiceParticipants = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("channelCallParticipants").collect(),
});

export const getVoiceJoinContext = internalQuery({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await requireChannel(ctx, channelId);
    if (channel.type !== "voice") throw new Error("Not a voice channel.");
    const community = await requireCommunity(ctx, channel.communityId);
    await requireMember(ctx, channel.communityId, me._id);
    const perms = await getChannelPermissions(ctx, community, channelId, me._id);
    if (!can(perms, PERMISSIONS.CONNECT)) throw new Error("You don't have permission to join this channel.");
    return { userId: me._id, name: me.name, communityId: channel.communityId };
  },
});

export const recordVoiceJoin = internalMutation({
  args: { channelId: v.id("channels"), userId: v.id("users") },
  handler: async (ctx, { channelId, userId }) => {
    const existing = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .unique();
    if (existing) return;
    await ctx.db.insert("channelCallParticipants", { channelId, userId, joinedAt: Date.now() });
    await notifyVoiceChannelActivity(ctx, {
      channelId,
      actorId: userId,
      type: "call_started",
      verb: "joined voice",
    });
  },
});

export const recordVoiceLeave = internalMutation({
  args: { channelId: v.id("channels"), userId: v.id("users") },
  handler: async (ctx, { channelId, userId }) => {
    const row = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .unique();
    if (row) await ctx.db.delete(row._id);

    const remaining = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .collect();
    return remaining.length;
  },
});

/**
 * Record that a member has read a channel up to now.
 *
 * Shared with `channelMessages.send`, which marks the author read as a matter
 * of course — you've read what you just wrote, and without this your own
 * message would light up your own unread indicator.
 */
export async function markChannelRead(
  ctx: MutationCtx,
  channelId: Id<"channels">,
  communityId: Id<"communities">,
  userId: Id<"users">
): Promise<void> {
  const existing = await ctx.db
    .query("channelReads")
    .withIndex("by_user_channel", (q) => q.eq("userId", userId).eq("channelId", channelId))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, { lastReadAt: Date.now() });
  } else {
    await ctx.db.insert("channelReads", {
      userId,
      channelId,
      communityId,
      lastReadAt: Date.now(),
    });
  }
}

/** Past this the bar can say "a lot" and mean it. */
const UNREAD_COUNT_CAP = 99;

/**
 * How much of a channel the caller hasn't seen.
 *
 * Their own messages don't count: this feeds the catch-up bar, which is about
 * what was missed. Capped, because past a hundred the exact figure isn't the
 * useful part and an uncapped scan of a busy channel is.
 */
export const unreadInfo = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return { count: 0, since: null as number | null };
    const channel = await ctx.db.get(channelId);
    if (!channel) return { count: 0, since: null as number | null };

    const read = await ctx.db
      .query("channelReads")
      .withIndex("by_user_channel", (q) => q.eq("userId", me._id).eq("channelId", channelId))
      .unique();
    const readAt = read?.lastReadAt ?? 0;

    const recent = await ctx.db
      .query("channelMessages")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .order("desc")
      .take(UNREAD_COUNT_CAP + 1);

    return {
      count: recent.filter(
        (message) => message._creationTime > readAt && message.authorId !== me._id
      ).length,
      /** Where they had got to, for "since you were last here". Null when
       * they've never opened the channel. */
      since: read?.lastReadAt ?? null,
    };
  },
});

/**
 * Mark a channel read.
 *
 * Called when the reader is demonstrably present — the window is focused on
 * the channel, or they've scrolled to the end of it — and from the catch-up
 * bar's button. Deliberately not on mount: a channel sitting in a background
 * window is not one you've read.
 *
 * Also clears any unread mention notifications for it: having looked at the
 * channel, being told about it in the inbox as well is noise.
 */
export const markRead = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await ctx.db.get(channelId);
    if (!channel) return;
    await requireMember(ctx, channel.communityId, me._id);
    await markChannelRead(ctx, channelId, channel.communityId, me._id);

    const mentions = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", me._id).eq("read", false))
      .collect();
    for (const notification of mentions) {
      if (notification.channelId === channelId) {
        await ctx.db.patch(notification._id, { read: true });
      }
    }
  },
});


/**
 * Publish a still from my own screen share so people outside the call can see
 * what's on before joining.
 *
 * Only the sharer can write this — a stream can't be sampled by anyone who
 * hasn't subscribed to it, which is exactly the cost this avoids. The previous
 * still is deleted as the new one lands, so a long stream doesn't accumulate a
 * frame every few seconds in storage forever.
 */
export const setStreamThumbnail = mutation({
  args: { channelId: v.id("channels"), storageId: v.id("_storage") },
  handler: async (ctx, { channelId, storageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const row = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", me._id))
      .unique();
    if (!row) {
      // Not in the call any more — the frame is already stale, so don't keep it.
      await ctx.storage.delete(storageId);
      return;
    }

    const url = await ctx.storage.getUrl(storageId);
    if (!url) return;
    const previous = row.streamThumbnailStorageId;
    await ctx.db.patch(row._id, {
      streamThumbnailUrl: url,
      streamThumbnailStorageId: storageId,
      streamThumbnailAt: Date.now(),
    });
    if (previous && previous !== storageId) await ctx.storage.delete(previous);
  },
});

/** Drop the still when a share ends, so nothing claims to be live that isn't. */
export const clearStreamThumbnail = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const row = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", me._id))
      .unique();
    if (!row?.streamThumbnailStorageId) return;
    const previous = row.streamThumbnailStorageId;
    await ctx.db.patch(row._id, {
      streamThumbnailUrl: undefined,
      streamThumbnailStorageId: undefined,
      streamThumbnailAt: undefined,
    });
    await ctx.storage.delete(previous);
  },
});

/** Upload target for a stream still. Separate from the message-attachment
 * uploader only because this is voice plumbing, not messaging. */
export const generateStreamThumbnailUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

// --- Channel decoration: background and banner ------------------------------
//
// Both are properties of the channel rather than of the viewer: whoever can
// manage the channel sets them, and everyone in it sees the same room. The
// per-person alternative would be a preference table keyed by user and channel,
// which is a different feature — "how I like this channel to look" — and not
// the one asked for.

export const generateChannelAssetUploadUrl = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await requireChannel(ctx, channelId);
    const community = await requireCommunity(ctx, channel.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_CHANNELS);
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Set (or clear) the picture behind this channel's messages.
 *
 * `opacity` travels with the image because the two are one decision: any
 * photograph put behind running text needs turning down, and a background
 * stored without one would be unreadable until somebody found the slider.
 */
export const setBackground = mutation({
  args: {
    channelId: v.id("channels"),
    storageId: v.optional(v.id("_storage")),
    cdnKey: v.optional(v.string()),
    cdnUrl: v.optional(v.string()),
    opacity: v.optional(v.number()),
    clear: v.optional(v.boolean()),
  },
  handler: async (ctx, { channelId, storageId, cdnKey, cdnUrl, opacity, clear }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await requireChannel(ctx, channelId);
    const community = await requireCommunity(ctx, channel.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_CHANNELS);

    if (clear) {
      const previous = channel.backgroundStorageId;
      const previousUrl = channel.backgroundUrl;
      await ctx.db.patch(channelId, {
        backgroundUrl: undefined,
        backgroundStorageId: undefined,
        backgroundOpacity: undefined,
      });
      if (previousUrl) await r2DeleteByUrl(previousUrl);
      if (previous) await ctx.storage.delete(previous).catch(() => {});
      return;
    }

    const patch: {
      backgroundUrl?: string;
      backgroundStorageId?: Id<"_storage">;
      backgroundOpacity?: number;
    } = {};

    if (cdnKey || cdnUrl) {
      const url = cdnUrl ?? r2PublicUrlForKey(cdnKey!);
      if (!url) throw new Error("Background upload failed.");
      patch.backgroundUrl = url;
      patch.backgroundStorageId = undefined;
    } else if (storageId) {
      await requireWithinUploadLimit(ctx, storageId, MAX_PROFILE_ASSET_BYTES, "Channel backgrounds");
      const url = await ctx.storage.getUrl(storageId);
      if (!url) throw new Error("Background upload failed.");
      patch.backgroundUrl = url;
      patch.backgroundStorageId = storageId;
    }
    // Clamped rather than rejected: the slider can only produce a sane number,
    // and a call from anywhere else shouldn't be able to make a channel
    // unreadable.
    if (opacity !== undefined) {
      patch.backgroundOpacity = Math.min(1, Math.max(0, opacity));
    }
    if (Object.keys(patch).length === 0) return;

    const previous = channel.backgroundStorageId;
    const previousUrl = channel.backgroundUrl;
    await ctx.db.patch(channelId, patch);
    // Delete old R2 file if we just replaced it with a new R2 upload
    if ((cdnKey || cdnUrl) && previousUrl) await r2DeleteByUrl(previousUrl);
    if (storageId && previous && previous !== storageId) {
      await ctx.storage.delete(previous).catch(() => {});
    }
    // If we switched from R2 to Convex or vice versa, clean the other store's old file too
    if (cdnKey && previous && !cdnUrl) await ctx.storage.delete(previous).catch(() => {});
  },
});

/**
 * The banner strip under the channel header.
 *
 * Title and description are sent as strings and cleared by sending empty ones,
 * which is how the rest of this file treats optional text. `clear` removes the
 * whole banner, picture included.
 */
export const setBanner = mutation({
  args: {
    channelId: v.id("channels"),
    storageId: v.optional(v.id("_storage")),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    clear: v.optional(v.boolean()),
  },
  handler: async (ctx, { channelId, storageId, title, description, clear }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await requireChannel(ctx, channelId);
    const community = await requireCommunity(ctx, channel.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_CHANNELS);

    if (clear) {
      const previous = channel.bannerStorageId;
      await ctx.db.patch(channelId, {
        bannerUrl: undefined,
        bannerStorageId: undefined,
        bannerTitle: undefined,
        bannerDescription: undefined,
      });
      if (previous) await ctx.storage.delete(previous).catch(() => {});
      return;
    }

    const patch: {
      bannerUrl?: string;
      bannerStorageId?: Id<"_storage">;
      bannerTitle?: string;
      bannerDescription?: string;
    } = {};

    if (storageId) {
      await requireWithinUploadLimit(
        ctx,
        storageId,
        MAX_PROFILE_ASSET_BYTES,
        "Channel banners"
      );
      const url = await ctx.storage.getUrl(storageId);
      if (!url) throw new Error("Banner upload failed.");
      patch.bannerUrl = url;
      patch.bannerStorageId = storageId;
    }
    if (title !== undefined) patch.bannerTitle = title.trim().slice(0, 80) || undefined;
    if (description !== undefined) {
      patch.bannerDescription = description.trim().slice(0, 240) || undefined;
    }
    if (Object.keys(patch).length === 0) return;

    const previous = channel.bannerStorageId;
    await ctx.db.patch(channelId, patch);
    if (storageId && previous && previous !== storageId) {
      await ctx.storage.delete(previous).catch(() => {});
    }
  },
});

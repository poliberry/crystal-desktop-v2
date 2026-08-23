import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireCommunity, requireMember } from "./communities";
import {
  PERMISSIONS,
  can,
  getChannelPermissions,
  requireAbove,
  requireCommunityPermission,
} from "./permissions";
import { activitiesOf } from "./lib/activities";
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

    return visible
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => a.position - b.position);
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

    return ctx.db.insert("channels", {
      communityId,
      name: trimmed,
      type,
      categoryId,
      position,
      createdAt: Date.now(),
    });
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
          activities: activitiesOf(presence),
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
    await ctx.db.patch(row._id, { muted, deafened, streaming });
  },
});

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

/**
 * Mark a channel read — called when its view is open, and from the sidebar's
 * "mark as read".
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
 * When the newest message in a channel landed.
 *
 * Deliberately tiny: the open channel view uses it to know when to re-mark
 * itself read, and subscribing to the message list for that would mean
 * reacting to every edit and reaction too.
 */
export const newestMessageAt = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    const channel = await ctx.db.get(channelId);
    if (!channel) return null;
    return channel.lastMessageAt ?? null;
  },
});

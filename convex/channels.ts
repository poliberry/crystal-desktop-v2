import { CHANNEL_SURFACES, surfaceAllowed, type ChannelSurface } from "./lib/communityKinds";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { dropR2Url, r2PublicUrlForKey } from "./lib/r2";
import { requireCommunity, requireMember } from "./communities";
import { bitsAnd, bitsOr, bitsWithout, isValidBits } from "./lib/permissionBits";
import {
  PERMISSIONS,
  can,
  getChannelPermissions,
  getChannelPermissionsBatch,
  requireChannelPermission,
  requireCommunityPermission,
} from "./permissions";
import { visibleActivities } from "./lib/activities";
import { evictBotFromVoice } from "./lib/botAccess";
import { fireChannelEvent, fireVoiceEvent } from "./lib/botEvents";
import { auditUserTarget, logCommunityAudit } from "./lib/communityAudit";
import { describePermissionChange, joinDetails } from "./lib/communityAuditActions";
import { notifyUsers } from "./notifications";
import { MAX_PROFILE_ASSET_BYTES, requireWithinUploadLimit } from "./uploadLimits";
import { releaseFile, releaseUrl } from "./lib/files";
import { requireCommunityOpen } from "./lib/moderation";
import { loadMemberVoiceAccess, scheduleVoiceSync } from "./lib/voiceAccess";
import { afterVoiceRowRemoved, removeVoiceRow } from "./lib/voiceState";
import { voiceGrantKey } from "./lib/voiceGrant";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";
import { historyFloorFor } from "./lib/history";
import { dropChannelMemberState, dropPollVotes } from "./lib/messageExtras";
import { anchorOnOpen } from "./lib/historyPure";
import { cleanSlowmodeSeconds, isSlowmodeExempt } from "./lib/slowmodePure";

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

    const permsByChannel = await getChannelPermissionsBatch(ctx, community, channels.map((c) => c._id), me._id);
    const visible = await Promise.all(
      channels.map(async (c) => {
        const perms = permsByChannel.get(c._id) ?? 0;
        if ((perms & PERMISSIONS.VIEW_CHANNELS) === 0 && (perms & PERMISSIONS.ADMINISTRATOR) === 0) {
          return null;
        }
        return {
          id: c._id,
          name: c.name,
          type: c.type,
          topic: c.topic,
          isLounge: c.isLounge ?? false,
          isStage: c.isStage ?? false,
          isAnnouncement: c.isAnnouncement ?? false,
          surface: c.surface,
          gameId: c.gameId,
          categoryId: c.categoryId ?? null,
          position: c.position,
          permissions: perms,
        };
      })
    );

    const result = visible
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => a.position - b.position);
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
    // Null for a non-member, like for a missing channel — the preloader keeps
    // this subscribed through the moment a community is left.
    const membership = await ctx.db
      .query("communityMembers")
      .withIndex("by_community_user", (q) => q.eq("communityId", channel.communityId).eq("userId", me._id))
      .unique();
    if (!membership) return null;
    const perms = await getChannelPermissions(ctx, community, channelId, me._id);
    // When this member may next send, for the composer's countdown. Read here (it changes with every
    // send, which re-runs this) rather than guessed by the client.
    const exempt = isSlowmodeExempt(perms);
    const lastSend =
      channel.slowmodeSeconds && !exempt
        ? await ctx.db
            .query("channelSlowmode")
            .withIndex("by_channel_user_scope", (q) => q.eq("channelId", channelId).eq("userId", me._id).eq("scope", "message"))
            .unique()
        : null;
    return {
      id: channel._id,
      communityId: channel.communityId,
      communityName: community.name,
      // Whether the composer should be there at all. The send itself is checked again on the server.
      canSend: can(perms, PERMISSIONS.SEND_MESSAGES),
      // What the soundboard offers. Hits travel as data packets, so every listener also checks them
      // with the server on arrival (soundboard.verifyClip); this is so the picker doesn't offer
      // what would be dropped.
      canUseSoundboard: can(perms, PERMISSIONS.USE_SOUNDBOARD),
      canUseExternalSounds: can(perms, PERMISSIONS.USE_EXTERNAL_SOUNDS),
      // Voice: what the call screen offers and why a control is off. The publish rights themselves
      // are signed into the LiveKit token (see getVoiceJoinContext); these only decide what shows.
      canSpeak: can(perms, PERMISSIONS.SPEAK),
      canVideo: can(perms, PERMISSIONS.VIDEO),
      canUseVad: can(perms, PERMISSIONS.USE_VAD),
      canRequestToSpeak: can(perms, PERMISSIONS.REQUEST_TO_SPEAK),
      canSetVoiceStatus: can(perms, PERMISSIONS.SET_VOICE_STATUS),
      canUseActivities: can(perms, PERMISSIONS.USE_EMBEDDED_ACTIVITIES),
      canMuteMembers: can(perms, PERMISSIONS.MUTE_MEMBERS),
      canDeafenMembers: can(perms, PERMISSIONS.DEAFEN_MEMBERS),
      canMoveMembers: can(perms, PERMISSIONS.MOVE_MEMBERS),
      canManageChannel: can(perms, PERMISSIONS.MANAGE_CHANNELS),
      isStage: channel.isStage ?? false,
      voiceStatus: channel.voiceStatus,
      // Emoji from other communities. Reactions are checked by the server; text is encrypted, so
      // the composer is what keeps them out of a message.
      canUseExternalEmojis: can(perms, PERMISSIONS.USE_EXTERNAL_EMOJIS),
      // What the composer offers. Each is a courtesy: the server checks again on send.
      canAttachFiles: can(perms, PERMISSIONS.ATTACH_FILES),
      canAddReactions: can(perms, PERMISSIONS.ADD_REACTIONS),
      canPin: can(perms, PERMISSIONS.PIN_MESSAGES) || can(perms, PERMISSIONS.MANAGE_MESSAGES),
      canUseCommands: can(perms, PERMISSIONS.USE_APPLICATION_COMMANDS),
      canSendTts: can(perms, PERMISSIONS.SEND_TTS),
      canSendVoiceMessages: can(perms, PERMISSIONS.SEND_VOICE_MESSAGES),
      canCreatePolls: can(perms, PERMISSIONS.CREATE_POLLS),
      canUseExternalStickers: can(perms, PERMISSIONS.USE_EXTERNAL_STICKERS),
      canReadHistory: can(perms, PERMISSIONS.READ_MESSAGE_HISTORY),
      // Slowmode: seconds between messages, and whether this member is exempt from it.
      slowmodeSeconds: channel.slowmodeSeconds ?? 0,
      slowmodeExempt: exempt,
      slowmodeUntil: lastSend && channel.slowmodeSeconds ? lastSend.lastSentAt + channel.slowmodeSeconds * 1000 : null,
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
      isLounge: channel.isLounge ?? false,
      isAnnouncement: channel.isAnnouncement ?? false,
      surface: channel.surface,
      gameId: channel.gameId,
      communityKind: community.kind,
      loungeScene: channel.loungeScene,
      loungeSceneCustom: channel.loungeSceneCustom,
      loungeTopic: channel.loungeTopic,
    };
  },
});

/**
 * Insert a channel at the end of its community's list. Shared by a person creating one and a bot
 * creating one, so both get the same position, the same cache clearing and the same event.
 */
export async function createChannelRow(
  ctx: MutationCtx,
  community: Doc<"communities">,
  actorId: Id<"users">,
  c: { name: string; type: "text" | "voice"; categoryId?: Id<"channelCategories">; lounge?: boolean; stage?: boolean; announcement?: boolean; channelSurface?: ChannelSurface; gameId?: string; topic?: string },
): Promise<Id<"channels">> {
  const communityId = community._id;
  const existing = await ctx.db
    .query("channels")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .collect();
  const position = existing.reduce((max, ch) => Math.max(max, ch.position), -1) + 1;

  const channelId = await ctx.db.insert("channels", {
    communityId,
    name: c.name,
    type: c.type,
    categoryId: c.categoryId,
    position,
    createdAt: Date.now(),
    ...(c.topic ? { topic: c.topic } : {}),
    ...(c.type === "voice" && c.lounge ? { isLounge: true, loungeScene: "living-room" } : {}),
    ...(c.type === "voice" && c.stage && !c.lounge ? { isStage: true } : {}),
    ...(c.type === "text" && c.announcement && !c.channelSurface ? { isAnnouncement: true } : {}),
    ...(c.channelSurface ? { surface: c.channelSurface } : {}),
    ...(c.gameId ? { gameId: c.gameId } : {}),
  });
  // Announcements start read-only for everyone: a role or a member is let in with an overwrite on the channel.
  if (c.type === "text" && c.announcement && !c.channelSurface) {
    const everyone = await ctx.db
      .query("roles")
      .withIndex("by_community_everyone", (q) => q.eq("communityId", communityId).eq("isEveryone", true))
      .unique();
    if (everyone) {
      await ctx.db.insert("channelPermissionOverwrites", { channelId, roleId: everyone._id, allow: 0, deny: PERMISSIONS.SEND_MESSAGES });
    }
  }
  const created = await ctx.db.get(channelId);
  if (created) await fireChannelEvent(ctx, "channel.created", created);
  await logCommunityAudit(ctx, { communityId, actorId, action: "channel.create", target: { type: "channel", id: channelId, name: c.name }, details: c.type === "voice" ? "Voice channel" : "Text channel" });
  try {
    const { cacheInvalidateKeys } = await import("./cache");
    await cacheInvalidateKeys(`community:${communityId}:user:${actorId}:channels`, `community:${communityId}:channels`);
  } catch {}
  return channelId;
}

/** Delete a channel and everything in it. Shared by a person and a bot. */
export async function deleteChannelCascade(ctx: MutationCtx, channel: Doc<"channels">, actorId: Id<"users">): Promise<void> {
  const channelId = channel._id;
  const [messages, overwrites, voiceParticipants] = await Promise.all([
    ctx.db.query("channelMessages").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect(),
    ctx.db.query("channelPermissionOverwrites").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect(),
    ctx.db.query("channelCallParticipants").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect(),
  ]);
  for (const message of messages) {
    const attachments = await ctx.db.query("channelMessageAttachments").withIndex("by_message", (q) => q.eq("messageId", message._id)).collect();
    for (const attachment of attachments) {
      await ctx.db.delete(attachment._id);
      await releaseFile(ctx, attachment);
    }
    for (const reaction of await ctx.db.query("channelMessageReactions").withIndex("by_message", (q) => q.eq("messageId", message._id)).collect()) await ctx.db.delete(reaction._id);
    await dropPollVotes(ctx, message._id);
    await ctx.db.delete(message._id);
  }
  await dropChannelMemberState(ctx, channelId);
  // A lounge's chat and its pictures.
  for (const row of await ctx.db.query("loungeMessages").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect()) {
    await ctx.db.delete(row._id);
    await releaseFile(ctx, row.image);
  }
  for (const overwrite of overwrites) await ctx.db.delete(overwrite._id);
  // Followers of this channel stop receiving it, and a channel that was a follow's destination stops being one.
  const [followed, delivering] = await Promise.all([
    ctx.db.query("channelFollows").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect(),
    ctx.db.query("channelFollows").withIndex("by_target_channel", (q) => q.eq("targetChannelId", channelId)).collect(),
  ]);
  for (const follow of [...followed, ...delivering]) await ctx.db.delete(follow._id);
  for (const participant of voiceParticipants) {
    await ctx.db.delete(participant._id);
    await releaseUrl(ctx, participant.streamThumbnailUrl, participant.streamThumbnailStorageId);
    // The room goes with the channel; nobody should stay connected to a channel that no longer exists.
    await ctx.scheduler.runAfter(0, internal.voiceSync.evict, { channelId, userId: participant.userId });
  }
  for (const activity of await ctx.db.query("voiceActivities").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect()) await ctx.db.delete(activity._id);
  // The channel's own pictures.
  await releaseUrl(ctx, channel.backgroundUrl, channel.backgroundStorageId);
  await releaseUrl(ctx, channel.bannerUrl, channel.bannerStorageId);
  // Told before it goes, while the bots can still be checked against it.
  await fireChannelEvent(ctx, "channel.deleted", channel);
  await ctx.db.delete(channelId);
  await logCommunityAudit(ctx, { communityId: channel.communityId, actorId, action: "channel.delete", target: { type: "channel", id: channelId, name: channel.name } });
  try {
    const { cacheInvalidateKeys } = await import("./cache");
    await cacheInvalidateKeys(`community:${channel.communityId}:user:${actorId}:channels`, `channel:${channelId}:meta`, `channel:${channelId}:messages:30`, `channel:${channelId}:messages:50`);
  } catch {}
}

export const create = mutation({
  args: {
    communityId: v.id("communities"),
    name: v.string(),
    type: v.union(v.literal("text"), v.literal("voice")),
    categoryId: v.optional(v.id("channelCategories")),
    /** A voice channel that is a lounge. Ignored for text channels. */
    lounge: v.optional(v.boolean()),
    /** A voice channel that is a stage: the audience listens and raises a hand to speak. Ignored for text channels and lounges. */
    stage: v.optional(v.boolean()),
    /** A text channel that is an announcements channel. Ignored for voice channels. */
    announcement: v.optional(v.boolean()),
    /** A text channel that shows something other than messages — only in a
     * community whose kind allows it. */
    surface: v.optional(v.string()),
    gameId: v.optional(v.string()),
  },
  handler: async (ctx, { communityId, name, type, categoryId, lounge, stage, announcement, surface, gameId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_CHANNELS);

    const trimmed = name.trim();
    if (!trimmed) throw new Error("Channel name can't be empty.");

    let channelSurface: ChannelSurface | undefined;
    if (surface !== undefined) {
      if (type !== "text") throw new Error("Only a text channel can be one of these.");
      if (!(CHANNEL_SURFACES as readonly string[]).includes(surface) || !surfaceAllowed(community.kind, surface as ChannelSurface)) {
        throw new Error("This community can't have that kind of channel.");
      }
      channelSurface = surface as ChannelSurface;
    }
    if (gameId !== undefined && !community.clanGames?.some((g) => g.id === gameId)) throw new Error("The clan doesn't play that.");

    const channelId = await createChannelRow(ctx, community, me._id, { name: trimmed, type, categoryId, lounge, stage, announcement, channelSurface, gameId });
    return channelId;
  },
});

/**
 * Turn an existing text channel into an announcements channel, or back.
 *
 * Turning it on makes @everyone read-only there (the same overwrite a new announcements channel
 * starts with; one that already denies sending is left as it is). Forwards *into* the channel are
 * dropped, because something an announcements channel receives can't also be what it sends on.
 * Turning it off removes its followers — there is nothing left to follow — but leaves who can
 * post alone: that is a choice under Permissions, and undoing it silently would be a surprise
 * either way. Returns how many forwards or followers went with the change.
 */
export const setAnnouncement = mutation({
  args: { channelId: v.id("channels"), enabled: v.boolean() },
  handler: async (ctx, { channelId, enabled }): Promise<{ removed: number }> => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await requireChannel(ctx, channelId);
    const community = await requireCommunity(ctx, channel.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_CHANNELS);
    if (channel.type !== "text" || channel.surface) {
      throw new Error("Only a plain text channel can be an announcements channel.");
    }
    if ((channel.isAnnouncement ?? false) === enabled) return { removed: 0 };

    let removed = 0;
    if (enabled) {
      for (const follow of await ctx.db.query("channelFollows").withIndex("by_target_channel", (q) => q.eq("targetChannelId", channelId)).collect()) {
        await ctx.db.delete(follow._id);
        removed++;
      }
      const everyone = await ctx.db
        .query("roles")
        .withIndex("by_community_everyone", (q) => q.eq("communityId", channel.communityId).eq("isEveryone", true))
        .unique();
      if (everyone) {
        const existing = (await ctx.db.query("channelPermissionOverwrites").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect())
          .find((o) => o.roleId === everyone._id);
        if (existing) {
          await ctx.db.patch(existing._id, {
            allow: bitsWithout(existing.allow, PERMISSIONS.SEND_MESSAGES),
            deny: bitsOr(existing.deny, PERMISSIONS.SEND_MESSAGES),
          });
        } else {
          await ctx.db.insert("channelPermissionOverwrites", { channelId, roleId: everyone._id, allow: 0, deny: PERMISSIONS.SEND_MESSAGES });
        }
      }
    } else {
      for (const follow of await ctx.db.query("channelFollows").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect()) {
        await ctx.db.delete(follow._id);
        removed++;
      }
    }

    await ctx.db.patch(channelId, { isAnnouncement: enabled ? true : undefined });
    await logCommunityAudit(ctx, { communityId: channel.communityId, actorId: me._id, action: "channel.update", target: { type: "channel", id: channelId, name: channel.name }, details: `Announcements channel: ${enabled ? "on" : "off"}` });
    const changed = await ctx.db.get(channelId);
    if (changed) await fireChannelEvent(ctx, "channel.updated", changed);
    try {
      const { cacheInvalidateKeys } = await import("./cache");
      await cacheInvalidateKeys(`community:${channel.communityId}:user:${me._id}:channels`, `community:${channel.communityId}:channels`, `channel:${channelId}:meta`);
    } catch {}
    return { removed };
  },
});

export const update = mutation({
  args: {
    channelId: v.id("channels"),
    name: v.optional(v.string()),
    topic: v.optional(v.string()),
    /** Seconds members must wait between messages; 0 turns slowmode off. */
    slowmodeSeconds: v.optional(v.number()),
  },
  handler: async (ctx, { channelId, name, topic, slowmodeSeconds }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await requireChannel(ctx, channelId);
    const community = await requireCommunity(ctx, channel.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_CHANNELS);

    const patch: { name?: string; topic?: string; slowmodeSeconds?: number } = {};
    if (slowmodeSeconds !== undefined) {
      if (channel.type !== "text") throw new Error("Only a text channel has slowmode.");
      // 0 is stored as absent, so "off" is one state.
      patch.slowmodeSeconds = cleanSlowmodeSeconds(slowmodeSeconds) || undefined;
    }
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Channel name can't be empty.");
      patch.name = trimmed;
    }
    if (topic !== undefined) patch.topic = topic;
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(channelId, patch);
      await logCommunityAudit(ctx, {
        communityId: channel.communityId,
        actorId: me._id,
        action: "channel.update",
        target: { type: "channel", id: channelId, name: patch.name ?? channel.name },
        details: joinDetails(patch.name !== undefined && patch.name !== channel.name && `Renamed from "${channel.name}"`, patch.topic !== undefined && patch.topic !== (channel.topic ?? "") && "Changed the topic"),
      });
      const changed = await ctx.db.get(channelId);
      if (changed) await fireChannelEvent(ctx, "channel.updated", changed);
    }
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

    await deleteChannelCascade(ctx, channel, me._id);
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
    if (!isValidBits(allow) || !isValidBits(deny)) throw new Error("Those permissions aren't valid.");
    // A permission is allowed, denied or left alone — never two at once. Deny would otherwise
    // be silently outranked by allow in the same row.
    if (bitsAnd(allow, deny) !== 0) throw new Error("A permission can't be both allowed and denied.");

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
    // Someone already in this voice channel keeps the rights their token was minted with unless told otherwise.
    if (channel.type === "voice") await scheduleVoiceSync(ctx, { communityId: channel.communityId, channelId });
    const subject = roleId ? await ctx.db.get(roleId) : userId ? await ctx.db.get(userId) : null;
    await logCommunityAudit(ctx, {
      communityId: channel.communityId,
      actorId: me._id,
      action: "channel.overwrite_set",
      target: { type: "channel", id: channelId, name: channel.name },
      details: joinDetails(
        `For ${roleId ? "role" : "member"} ${subject?.name ?? "unknown"}`,
        describePermissionChange(match?.allow ?? 0, allow) && `Allowed: ${describePermissionChange(match?.allow ?? 0, allow)}`,
        describePermissionChange(match?.deny ?? 0, deny) && `Denied: ${describePermissionChange(match?.deny ?? 0, deny)}`,
      ),
    });
    await bustChannelLists(channel.communityId, me._id);
  },
});

/** The channel list is cached per member for a minute, with each channel's
 * permissions in it. A change to who can see what should not wait that long for
 * the person who made it — the others' caches are left to expire. */
async function bustChannelLists(communityId: Id<"communities">, userId: Id<"users">) {
  try {
    const { cacheInvalidateKeys } = await import("./cache");
    await cacheInvalidateKeys(`community:${communityId}:user:${userId}:channels`);
  } catch {}
}

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
    if (channel.type === "voice") await scheduleVoiceSync(ctx, { communityId: channel.communityId, channelId: channel._id });
    const subject = overwrite.roleId ? await ctx.db.get(overwrite.roleId) : overwrite.userId ? await ctx.db.get(overwrite.userId) : null;
    await logCommunityAudit(ctx, { communityId: channel.communityId, actorId: me._id, action: "channel.overwrite_remove", target: { type: "channel", id: overwrite.channelId, name: channel.name }, details: `For ${overwrite.roleId ? "role" : "member"} ${subject?.name ?? "unknown"}` });
    await bustChannelLists(channel.communityId, me._id);
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
          /** On a stage: up with the speakers, and the hand raised to get there. */
          stageSpeaker: row.stageSpeaker ?? false,
          handRaisedAt: row.handRaisedAt,
          joinedAt: row.joinedAt,
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
 * Held by the room itself, not just by the target's app: a server mute takes the microphone out of
 * their LiveKit publish grant and a server deafen takes away their right to subscribe, both updated
 * in place by voiceSync, and the grant is rebuilt from this row if they rejoin. The target's app also
 * mirrors it onto their mute / deafen buttons. Passing `undefined` for a field leaves it alone, so
 * muting doesn't clobber deafen. Checked against the channel's own permissions, so an overwrite that
 * takes Mute Members away in a channel counts.
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
      await requireChannelPermission(ctx, community, channelId, me._id, PERMISSIONS.MUTE_MEMBERS);
    }
    if (serverDeafened !== undefined) {
      await requireChannelPermission(ctx, community, channelId, me._id, PERMISSIONS.DEAFEN_MEMBERS);
    }
    const row = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .unique();
    if (!row) throw new Error("That member isn't in this channel.");

    await ctx.db.patch(row._id, {
      ...(serverMuted !== undefined ? { serverMuted } : {}),
      ...(serverDeafened !== undefined ? { serverDeafened } : {}),
    });
    await scheduleVoiceSync(ctx, { communityId: channel.communityId, channelId, userId });
    const target = await auditUserTarget(ctx, userId);
    if (serverMuted !== undefined && serverMuted !== (row.serverMuted ?? false)) {
      await logCommunityAudit(ctx, { communityId: channel.communityId, actorId: me._id, action: serverMuted ? "voice.mute" : "voice.unmute", target, details: `In #${channel.name}` });
    }
    if (serverDeafened !== undefined && serverDeafened !== (row.serverDeafened ?? false)) {
      await logCommunityAudit(ctx, { communityId: channel.communityId, actorId: me._id, action: serverDeafened ? "voice.deafen" : "voice.undeafen", target, details: `In #${channel.name}` });
    }
  },
});

/**
 * Disconnect someone from a voice channel: their participant row goes and their LiveKit connection is
 * ended. Their app is also subscribed to the row and leaves the call when it vanishes (see CallProvider).
 */
export const disconnectMember = mutation({
  args: { channelId: v.id("channels"), userId: v.id("users") },
  handler: async (ctx, { channelId, userId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await ctx.db.get(channelId);
    if (!channel) throw new Error("Channel not found.");
    const community = await requireCommunity(ctx, channel.communityId);
    await requireChannelPermission(ctx, community, channelId, me._id, PERMISSIONS.MOVE_MEMBERS);
    const row = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .unique();
    if (row) {
      // Also ends their LiveKit connection: leaving when the row goes is their app's good behaviour, not a guarantee.
      await removeVoiceRow(ctx, row, { evict: true });
      await fireVoiceEvent(ctx, channelId, userId, "left");
      await logCommunityAudit(ctx, { communityId: channel.communityId, actorId: me._id, action: "voice.disconnect", target: await auditUserTarget(ctx, userId), details: `From #${channel.name}` });
      // A bot doesn't notice its row going away the way a person's app does; end the connection itself.
      await evictBotFromVoice(ctx, userId, [channelId]);
    }
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
  handler: async (ctx, { channelId, muted, deafened, streaming: reportedStreaming }) => {
    let streaming = reportedStreaming;
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return;
    const row = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", me._id))
      .unique();
    if (!row) return;
    // The roster's LIVE badge is the client's report; LiveKit won't carry a share without Video, so neither does this.
    if (streaming) {
      const channel = await ctx.db.get(channelId);
      const community = channel ? await ctx.db.get(channel.communityId) : null;
      if (!channel || !community || !can(await getChannelPermissions(ctx, community, channelId, me._id), PERMISSIONS.VIDEO)) streaming = false;
    }
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
    const me = await getCurrentUserOrThrow(ctx, "voice_calls");
    const channel = await requireChannel(ctx, channelId);
    if (channel.type !== "voice") throw new Error("Not a voice channel.");
    const community = await requireCommunity(ctx, channel.communityId);
    await requireMember(ctx, channel.communityId, me._id);
    await requireCommunityOpen(ctx, channel.communityId, "post");
    // Connect, and not timed out; then what the room lets them send (lib/voiceGrant.ts) — the token
    // is minted from this, so it is the server's word on who can talk, show video, or only listen.
    const access = await loadMemberVoiceAccess(ctx, community, channel, me._id);
    if (!access.allowed) throw new Error(access.denial ?? "You don't have permission to join this channel.");
    return {
      userId: me._id,
      name: me.name,
      communityId: channel.communityId,
      grant: access.grant,
      grantKey: voiceGrantKey(access.grant),
      stage: channel.isStage === true,
    };
  },
});

export const recordVoiceJoin = internalMutation({
  args: {
    channelId: v.id("channels"),
    userId: v.id("users"),
    /** The grant the token about to be minted carries (lib/voiceGrant.ts). */
    grantKey: v.optional(v.string()),
    stageSpeaker: v.optional(v.boolean()),
  },
  handler: async (ctx, { channelId, userId, grantKey, stageSpeaker }) => {
    const existing = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .unique();
    const grant = { ...(grantKey !== undefined ? { grantKey } : {}), ...(stageSpeaker !== undefined ? { stageSpeaker } : {}) };
    if (existing) {
      // See calls.recordJoin: re-stamp a row left by an earlier connection so its late leave can't remove it.
      await ctx.db.patch(existing._id, { joinedAt: Date.now(), ...grant });
      return;
    }
    await ctx.db.insert("channelCallParticipants", { channelId, userId, joinedAt: Date.now(), ...grant });
    await fireVoiceEvent(ctx, channelId, userId, "joined");
    await notifyVoiceChannelActivity(ctx, {
      channelId,
      actorId: userId,
      type: "call_started",
      verb: "joined voice",
    });
  },
});

export const recordVoiceLeave = internalMutation({
  args: {
    channelId: v.id("channels"),
    userId: v.id("users"),
    /** See calls.recordLeave: only remove a row made at or before this time (ms). */
    joinedBefore: v.optional(v.number()),
  },
  handler: async (ctx, { channelId, userId, joinedBefore }) => {
    const row = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
      .unique();
    if (row && (joinedBefore === undefined || row.joinedAt <= joinedBefore)) {
      await ctx.db.delete(row._id);
      await releaseUrl(ctx, row.streamThumbnailUrl, row.streamThumbnailStorageId);
      await fireVoiceEvent(ctx, channelId, userId, "left");
    }

    // The last one out takes the channel's status and activity with them; a host who leaves hands the video on.
    const remaining = await afterVoiceRowRemoved(ctx, channelId, userId);
    // An empty lounge forgets what was said in it and what it was about.
    if (remaining === 0) {
      const channel = await ctx.db.get(channelId);
      if (channel?.isLounge) await ctx.scheduler.runAfter(0, internal.lounge.reset, { channelId });
    }
    return remaining;
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
    // Messages from before a member's history starts don't count towards what they missed.
    const community = await ctx.db.get(channel.communityId);
    const floor = community
      ? await historyFloorFor(ctx, channelId, me._id, await getChannelPermissions(ctx, community, channelId, me._id))
      : ({ restricted: false } as const);

    const recent = await ctx.db
      .query("channelMessages")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .order("desc")
      .take(UNREAD_COUNT_CAP + 1);

    return {
      count: recent.filter(
        (message) => message._creationTime > readAt && message.authorId !== me._id && (!floor.restricted || message._creationTime > floor.after)
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
 * Record that the caller has opened a channel, which is where their history starts if they lack Read
 * Message History: they see nothing sent before now (see lib/history.ts). Members who hold the
 * permission need nothing, and any anchor left from before they were given it is dropped.
 * Called when a channel's view mounts.
 */
export const openChannel = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await ctx.db.get(channelId);
    if (!channel) return;
    await requireMember(ctx, channel.communityId, me._id);
    const community = await requireCommunity(ctx, channel.communityId);
    const perms = await getChannelPermissions(ctx, community, channelId, me._id);
    if (!can(perms, PERMISSIONS.VIEW_CHANNELS)) return;
    const row = await ctx.db
      .query("channelHistoryAnchors")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", me._id))
      .unique();
    if (can(perms, PERMISSIONS.READ_MESSAGE_HISTORY)) {
      if (row) await ctx.db.delete(row._id);
      return;
    }
    const now = Date.now();
    const anchorAt = anchorOnOpen(row?.anchorAt, now);
    if (!row) await ctx.db.insert("channelHistoryAnchors", { channelId, userId: me._id, anchorAt });
    else if (row.anchorAt !== anchorAt) await ctx.db.patch(row._id, { anchorAt });
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
  args: {
    channelId: v.id("channels"),
    storageId: v.optional(v.id("_storage")),
    /** Uploaded to the CDN instead of Convex storage. */
    cdnKey: v.optional(v.string()),
    cdnUrl: v.optional(v.string()),
  },
  handler: async (ctx, { channelId, storageId, cdnKey, cdnUrl }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const row = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", me._id))
      .unique();
    const newUrl = cdnKey || cdnUrl ? (cdnUrl ?? r2PublicUrlForKey(cdnKey!)) : undefined;
    if (!row) {
      // Not in the call any more — the frame is already stale, so don't keep it.
      if (storageId) await ctx.storage.delete(storageId).catch(() => {});
      if (newUrl) await dropR2Url(ctx, newUrl);
      return;
    }

    const url = newUrl ?? (storageId ? await ctx.storage.getUrl(storageId) : null);
    if (!url) return;
    const previous = row.streamThumbnailStorageId;
    const previousUrl = row.streamThumbnailUrl;
    await ctx.db.patch(row._id, {
      streamThumbnailUrl: url,
      streamThumbnailStorageId: newUrl ? undefined : storageId,
      streamThumbnailAt: Date.now(),
    });
    if (previous && previous !== storageId) await ctx.storage.delete(previous).catch(() => {});
    if (previousUrl && previousUrl !== url) await dropR2Url(ctx, previousUrl);
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
    // Either store: a thumbnail can be on R2 (no storage id) as well as in Convex storage.
    if (!row || (!row.streamThumbnailStorageId && !row.streamThumbnailUrl)) return;
    await ctx.db.patch(row._id, {
      streamThumbnailUrl: undefined,
      streamThumbnailStorageId: undefined,
      streamThumbnailAt: undefined,
    });
    await releaseUrl(ctx, row.streamThumbnailUrl, row.streamThumbnailStorageId);
  },
});

/** Upload target for a stream still. Separate from the message-attachment
 * uploader only because this is voice plumbing, not messaging. */
export const generateStreamThumbnailUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx, "upload_media");
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
    const me = await getCurrentUserOrThrow(ctx, "upload_media");
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
      if (previousUrl) await dropR2Url(ctx, previousUrl);
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
    // Whatever the new picture is (R2, Convex storage, or the same one with only the opacity changed),
    // release the old one if it was actually replaced, from whichever store it was in.
    const replaced = (patch.backgroundUrl !== undefined && patch.backgroundUrl !== previousUrl) || (patch.backgroundStorageId !== undefined && patch.backgroundStorageId !== previous);
    if (replaced) await releaseUrl(ctx, previousUrl, previous);
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
    /** The same picture, uploaded to the CDN instead — see `setBackground`. */
    cdnKey: v.optional(v.string()),
    cdnUrl: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    clear: v.optional(v.boolean()),
  },
  handler: async (ctx, { channelId, storageId, cdnKey, cdnUrl, title, description, clear }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await requireChannel(ctx, channelId);
    const community = await requireCommunity(ctx, channel.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_CHANNELS);

    if (clear) {
      const previous = channel.bannerStorageId;
      const previousUrl = channel.bannerUrl;
      await ctx.db.patch(channelId, {
        bannerUrl: undefined,
        bannerStorageId: undefined,
        bannerTitle: undefined,
        bannerDescription: undefined,
      });
      if (previousUrl) await dropR2Url(ctx, previousUrl);
      if (previous) await ctx.storage.delete(previous).catch(() => {});
      return;
    }

    const patch: {
      bannerUrl?: string;
      bannerStorageId?: Id<"_storage"> | undefined;
      bannerTitle?: string;
      bannerDescription?: string;
    } = {};

    const onCdn = !!(cdnKey || cdnUrl);
    if (onCdn) {
      const url = cdnUrl ?? r2PublicUrlForKey(cdnKey!);
      if (!url) throw new Error("Banner upload failed.");
      patch.bannerUrl = url;
      patch.bannerStorageId = undefined;
    } else if (storageId) {
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
    const previousUrl = channel.bannerUrl;
    await ctx.db.patch(channelId, patch);
    // The picture this replaced — only if there was a new one.
    if (onCdn || storageId) {
      if (previous && previous !== storageId) await ctx.storage.delete(previous).catch(() => {});
      if (previousUrl && previousUrl !== patch.bannerUrl) await dropR2Url(ctx, previousUrl);
    }
  },
});

import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireCommunity } from "./communities";
import { applyWatchAction, cleanTitle, parseWatchSource, type WatchAction } from "./lib/watchTogether";
import { PERMISSIONS, can, getChannelPermissions, requireChannelPermission } from "./permissions";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

/**
 * Activities in a voice channel — today, "Watch together": a video the whole channel follows.
 *
 * The state lives here (one row per channel, see the schema): the host's play, pause and seek change
 * it and every member's player follows. Starting or joining takes Use Activities in the channel, and
 * both are checked here, not just hidden in the UI — a member without it is never sent the link, and
 * can't change the clock. Only people actually in the voice channel take part. The row goes when the
 * channel empties, and the host's role passes to whoever has been there longest when they leave
 * (lib/voiceState.ts).
 */

async function inChannel(ctx: QueryCtx, channelId: Id<"channels">, userId: Id<"users">) {
  const channel = await ctx.db.get(channelId);
  if (!channel || channel.type !== "voice") throw new Error("Not a voice channel.");
  const community = await requireCommunity(ctx, channel.communityId);
  const row = await ctx.db
    .query("channelCallParticipants")
    .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
    .unique();
  return { channel, community, inCall: !!row };
}

const currentRow = (ctx: QueryCtx, channelId: Id<"channels">) =>
  ctx.db.query("voiceActivities").withIndex("by_channel", (q) => q.eq("channelId", channelId)).unique();

/**
 * The channel's running activity for someone in it. Members without Use Activities are told there is one
 * (so the UI can say why they can't join) but get no link and no clock. `serverNow` lets the client work
 * out how far its clock is from the server's.
 */
export const current = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    const channel = await ctx.db.get(channelId);
    if (!channel || channel.type !== "voice") return null;
    const community = await ctx.db.get(channel.communityId);
    if (!community) return null;
    const inCall = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", me._id))
      .unique();
    if (!inCall) return null;
    const activity = await currentRow(ctx, channelId);
    if (!activity) return null;

    const perms = await getChannelPermissions(ctx, community, channelId, me._id);
    const mayJoin = can(perms, PERMISSIONS.USE_EMBEDDED_ACTIVITIES);
    const host = await ctx.db.get(activity.hostId);
    const base = {
      id: activity._id,
      kind: activity.kind,
      title: activity.title ?? null,
      hostId: activity.hostId,
      hostName: host?.name ?? "Someone",
      startedBy: activity.startedBy,
    };
    if (!mayJoin) return { ...base, allowed: false as const };
    // The host runs it; a moderator can always take it over or end it.
    const canControl = activity.hostId === me._id || can(perms, PERMISSIONS.MANAGE_CHANNELS) || can(perms, PERMISSIONS.MUTE_MEMBERS);
    return {
      ...base,
      allowed: true as const,
      canControl,
      isHost: activity.hostId === me._id,
      provider: activity.provider,
      source: activity.source,
      playing: activity.playing,
      positionMs: activity.positionMs,
      updatedAt: activity.updatedAt,
      version: activity.version,
      serverNow: Date.now(),
    };
  },
});

/** Start "Watch together" with a link. One activity per channel; starting is the host's job from then on. */
export const startWatch = mutation({
  args: { channelId: v.id("channels"), url: v.string(), title: v.optional(v.string()) },
  handler: async (ctx, { channelId, url, title }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const { channel, community, inCall } = await inChannel(ctx, channelId, me._id);
    await requireChannelPermission(ctx, community, channelId, me._id, PERMISSIONS.USE_EMBEDDED_ACTIVITIES);
    if (!inCall) throw new Error("Join the voice channel to start an activity.");
    if (channel.isLounge) throw new Error("Activities aren't available in lounges.");
    if (channel.isStage) {
      // A stage is for listening to speakers; a shared video would talk over them.
      throw new Error("Activities aren't available on a stage.");
    }
    if (await currentRow(ctx, channelId)) throw new Error("An activity is already running in this channel.");

    const parsed = parseWatchSource(url);
    if (!parsed.ok) throw new Error(parsed.reason);
    const now = Date.now();
    await ctx.db.insert("voiceActivities", {
      channelId,
      communityId: channel.communityId,
      kind: "watch",
      hostId: me._id,
      startedBy: me._id,
      provider: parsed.value.provider,
      source: parsed.value.source,
      title: cleanTitle(title),
      playing: true,
      positionMs: 0,
      updatedAt: now,
      version: 1,
      startedAt: now,
    });
  },
});

async function requireController(ctx: MutationCtx, channelId: Id<"channels">): Promise<{ activity: Doc<"voiceActivities">; meId: Id<"users"> }> {
  const me = await getCurrentUserOrThrow(ctx);
  const { community, inCall } = await inChannel(ctx, channelId, me._id);
  const perms = await getChannelPermissions(ctx, community, channelId, me._id);
  if (!can(perms, PERMISSIONS.USE_EMBEDDED_ACTIVITIES)) throw new Error("You don't have permission to use activities in this channel.");
  if (!inCall) throw new Error("You're not in this voice channel.");
  const activity = await currentRow(ctx, channelId);
  if (!activity) throw new Error("Nothing is playing.");
  if (activity.hostId !== me._id && !can(perms, PERMISSIONS.MANAGE_CHANNELS) && !can(perms, PERMISSIONS.MUTE_MEMBERS)) {
    throw new Error("Only the host can control playback.");
  }
  return { activity, meId: me._id };
}

/**
 * Play, pause or seek. `positionMs` is where the host's player actually is — what everyone is steered to
 * — rather than something the server extrapolates, so a pause lands where the host paused.
 */
export const controlWatch = mutation({
  args: {
    channelId: v.id("channels"),
    action: v.union(v.literal("play"), v.literal("pause"), v.literal("seek")),
    positionMs: v.number(),
  },
  handler: async (ctx, { channelId, action, positionMs }) => {
    const { activity } = await requireController(ctx, channelId);
    if (!Number.isFinite(positionMs) || positionMs < 0 || positionMs > 1000 * 60 * 60 * 24) throw new Error("That position isn't valid.");
    const act: WatchAction = action === "seek" ? { kind: "seek", positionMs } : { kind: action };
    const next = applyWatchAction(activity, act, Date.now(), action === "seek" ? undefined : positionMs);
    await ctx.db.patch(activity._id, { ...next, version: activity.version + 1 });
  },
});

/** Take over hosting — for a moderator, or when the host has wandered off. */
export const takeHost = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const { activity, meId } = await requireController(ctx, channelId);
    if (activity.hostId === meId) return;
    await ctx.db.patch(activity._id, { hostId: meId, version: activity.version + 1 });
  },
});

/** End the activity for everyone: the host, or a moderator. */
export const stop = mutation({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const { activity } = await requireController(ctx, channelId);
    await ctx.db.delete(activity._id);
  },
});

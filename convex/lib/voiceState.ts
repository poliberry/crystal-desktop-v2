import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { releaseUrl } from "./files";

/**
 * What has to follow a person leaving a voice channel, however they went: the channel's status line
 * and activity belong to the people in it, so the last one out takes them with them, and a "watch
 * together" host who leaves hands playback to whoever has been there longest.
 *
 * Every place that deletes a `channelCallParticipants` row goes through `removeVoiceRow` or calls
 * `afterVoiceRowRemoved` (a row removed some other way leaves a stale status until the channel next
 * empties, which is harmless but untidy).
 */

/** Returns how many people are still in the channel. */
export async function afterVoiceRowRemoved(
  ctx: MutationCtx,
  channelId: Id<"channels">,
  userId: Id<"users">,
): Promise<number> {
  const remaining = await ctx.db
    .query("channelCallParticipants")
    .withIndex("by_channel", (q) => q.eq("channelId", channelId))
    .collect();

  if (remaining.length === 0) {
    const channel = await ctx.db.get(channelId);
    if (channel?.voiceStatus !== undefined) {
      await ctx.db.patch(channelId, { voiceStatus: undefined, voiceStatusBy: undefined, voiceStatusAt: undefined });
    }
    const activity = await ctx.db.query("voiceActivities").withIndex("by_channel", (q) => q.eq("channelId", channelId)).unique();
    if (activity) await ctx.db.delete(activity._id);
    return 0;
  }

  const activity = await ctx.db.query("voiceActivities").withIndex("by_channel", (q) => q.eq("channelId", channelId)).unique();
  if (activity && activity.hostId === userId && !remaining.some((r) => r.userId === userId)) {
    // The longest-standing person who isn't a bot (a bot can't watch a video).
    const byAge = [...remaining].sort((a, b) => a.joinedAt - b.joinedAt);
    for (const row of byAge) {
      const user = await ctx.db.get(row.userId);
      if (user && !user.isBot) {
        await ctx.db.patch(activity._id, { hostId: row.userId, version: activity.version + 1 });
        return remaining.length;
      }
    }
    await ctx.db.delete(activity._id);
  }
  return remaining.length;
}

/**
 * Delete a participant row and tidy up after it. `evict` also removes them from the LiveKit room: a
 * person's own app leaves when its row disappears, but that is the app's good behaviour, not something
 * the server can rely on — a moderator's disconnect, a kick, a ban or a timeout has to actually end
 * the connection.
 */
export async function removeVoiceRow(
  ctx: MutationCtx,
  row: Doc<"channelCallParticipants">,
  options: { evict: boolean },
): Promise<number> {
  await ctx.db.delete(row._id);
  await releaseUrl(ctx, row.streamThumbnailUrl, row.streamThumbnailStorageId);
  if (options.evict) await ctx.scheduler.runAfter(0, internal.voiceSync.evict, { channelId: row.channelId, userId: row.userId });
  return afterVoiceRowRemoved(ctx, row.channelId, row.userId);
}

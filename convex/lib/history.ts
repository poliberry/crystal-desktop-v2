import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { can, getChannelPermissions, PERMISSIONS } from "../permissions";
import { historyFloor, type HistoryFloor } from "./historyPure";

export { filterByHistory, withinHistory, type HistoryFloor } from "./historyPure";

/**
 * Where `userId` starts in a channel. Members who hold Read Message History (and the owner and
 * administrators, through `can`) see all of it; the others see only what was sent after the last
 * time they opened the channel (`channelHistoryAnchors`, written by `channels.openChannel`).
 *
 * `perms` is their permissions in that channel when the caller has already worked them out.
 */
export async function historyFloorFor(ctx: QueryCtx, channelId: Id<"channels">, userId: Id<"users">, perms: number): Promise<HistoryFloor> {
  if (can(perms, PERMISSIONS.READ_MESSAGE_HISTORY)) return historyFloor(true, undefined);
  const anchor = await ctx.db
    .query("channelHistoryAnchors")
    .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
    .unique();
  return historyFloor(false, anchor?.anchorAt);
}

/** `historyFloorFor`, working out the permissions too. */
export async function historyFloorIn(ctx: QueryCtx, community: Doc<"communities">, channelId: Id<"channels">, userId: Id<"users">): Promise<HistoryFloor> {
  return historyFloorFor(ctx, channelId, userId, await getChannelPermissions(ctx, community, channelId, userId));
}

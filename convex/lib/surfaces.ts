import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireCommunity, requireMember } from "../communities";
import { getChannelPermissions, PERMISSIONS } from "../permissions";
import { getCurrentUserOrThrow } from "../users";

/**
 * Everything a special channel's functions have to establish before they do
 * anything: the caller is signed in, is a member, the channel is the kind they
 * think it is, and they can see it.
 */
export async function requireSurface(
  ctx: QueryCtx,
  channelId: Id<"channels">,
  surface: NonNullable<Doc<"channels">["surface"]>,
): Promise<{ me: Doc<"users">; channel: Doc<"channels">; community: Doc<"communities">; perms: number }> {
  const me = await getCurrentUserOrThrow(ctx);
  const channel = await ctx.db.get(channelId);
  if (!channel || channel.surface !== surface) throw new Error("That isn't the right kind of channel.");
  await requireMember(ctx, channel.communityId, me._id);
  const community = await requireCommunity(ctx, channel.communityId);
  const perms = await getChannelPermissions(ctx, community, channelId, me._id);
  if ((perms & PERMISSIONS.VIEW_CHANNELS) === 0 && (perms & PERMISSIONS.ADMINISTRATOR) === 0) {
    throw new Error("You can't see that channel.");
  }
  return { me, channel, community, perms };
}

export const canDo = (perms: number, flag: number) => (perms & PERMISSIONS.ADMINISTRATOR) !== 0 || (perms & flag) !== 0;

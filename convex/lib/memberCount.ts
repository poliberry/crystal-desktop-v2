import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Keeps `communities.memberCount` in step with the `communityMembers` rows. Call it next to every
 * insert (+1) and delete (-1) of a membership. A community that has no count yet (made before the
 * field, not backfilled) is left alone — readers count its rows instead — so a missed call can only
 * ever make a count that exists drift, never invent one.
 */
export async function adjustMemberCount(
  ctx: MutationCtx,
  communityId: Id<"communities">,
  delta: number
): Promise<void> {
  const community = await ctx.db.get(communityId);
  if (!community || community.memberCount === undefined) return;
  await ctx.db.patch(communityId, { memberCount: Math.max(0, community.memberCount + delta) });
}

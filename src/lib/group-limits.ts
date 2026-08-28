/**
 * How big a group DM is allowed to get.
 *
 * Mirrored from convex/conversations.ts, which is where it's enforced — the
 * check here only exists so the friend picker can stop you at the limit
 * instead of letting you pick forty people and then refusing the whole thing.
 * Change one, change the other.
 *
 * The number counts everybody in the group, the creator included.
 */
export const MAX_GROUP_MEMBERS = 30;

/** How many more people can be added to a group of `current` size. */
export function groupSlotsLeft(current: number): number {
  return Math.max(0, MAX_GROUP_MEMBERS - current);
}

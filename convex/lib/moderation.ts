import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * Where staff decisions about accounts and communities are *enforced*.
 *
 * The console records a suspension or a community's status; these are what make
 * it mean something. Kept in one file so "what does suspended stop?" has one
 * answer, rather than being whichever mutations remembered to ask.
 */

/** A suspension with no end date. A real timestamp, so it compares like any
 * other and an absent value can keep meaning "not suspended". */
export const INDEFINITE = 8_640_000_000_000_000;

/** The suspension on a user, if one is in force. */
export function activeSuspension(
  user: Pick<Doc<"users">, "platformSuspendedUntil" | "platformSuspensionReason">,
  now = Date.now(),
): { until: number; indefinite: boolean; reason?: string } | null {
  const until = user.platformSuspendedUntil;
  if (until === undefined || until <= now) return null;
  return { until, indefinite: until >= INDEFINITE, reason: user.platformSuspensionReason };
}

/** What a community's status stops. `restricted` closes the door to newcomers;
 * `archived` also makes it read-only. */
export async function requireCommunityOpen(
  ctx: QueryCtx,
  communityId: Id<"communities">,
  action: "join" | "post",
): Promise<void> {
  const moderation = await ctx.db
    .query("communityModeration")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .unique();
  if (!moderation || moderation.status === "active") return;
  if (moderation.status === "archived") {
    throw new Error("This community has been archived by Crystal staff.");
  }
  if (action === "join") throw new Error("This community isn't accepting new members right now.");
}

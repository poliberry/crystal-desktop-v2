import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { guestExpired } from "./guests";

/**
 * Who a request is signed in as, and on which session.
 *
 * The auth library puts `userId|sessionId` in the subject of the JWT it signs, and Convex has
 * already verified that signature against our key before a function runs, so the subject can be
 * trusted. This also checks the session row is still there and hasn't run out: a JWT stays valid
 * for up to an hour, but a session is deleted the moment an account is banned or suspended, its
 * password is reset, or somebody signs out everywhere, and that should take effect at once
 * rather than when the token happens to expire.
 */
export async function signedInIds(
  ctx: Pick<QueryCtx, "auth" | "db">,
): Promise<{ userId: Id<"users">; sessionId: Id<"authSessions"> } | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const [rawUser, rawSession] = identity.subject.split("|");
  const userId = ctx.db.normalizeId("users", rawUser ?? "");
  const sessionId = ctx.db.normalizeId("authSessions", rawSession ?? "");
  if (!userId || !sessionId) return null;
  const session = await ctx.db.get(sessionId);
  if (!session || session.userId !== userId || session.expirationTime <= Date.now()) return null;
  // A guest's day is up: its session may be good for longer, but the account isn't.
  const user = await ctx.db.get(userId);
  if (!user || guestExpired(user)) return null;
  return { userId, sessionId };
}

/**
 * The same for an action, which has no database to check the session against. The ids are only
 * as good as the signed token they came from, so anything done with them goes through an internal
 * function that checks them with `signedInIds`; this is for choosing what to ask about.
 */
export async function claimedIds(ctx: { auth: Pick<import("convex/server").Auth, "getUserIdentity"> }): Promise<{
  userId: Id<"users">;
  sessionId: Id<"authSessions">;
} | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const [userId, sessionId] = identity.subject.split("|");
  if (!userId || !sessionId) return null;
  return { userId: userId as Id<"users">, sessionId: sessionId as Id<"authSessions"> };
}

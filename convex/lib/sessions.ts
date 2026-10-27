import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Sign an account out everywhere: every session, the refresh tokens that could mint new ones, and
 * any "I just entered my code" grants that rode on them.
 *
 * Called when an account is banned or suspended (so the block bites now, not when a token runs
 * out), when a password is reset or changed, and when somebody asks to be signed out of their
 * other devices. `except` keeps one session, for the device that did it.
 *
 * Reads and writes the library's `authSessions` and `authRefreshTokens` directly, which is what
 * its own `invalidateSessions` does too — the difference is that this can be called from inside
 * a mutation of ours, in the same transaction as the change that needs it.
 */
export async function revokeSessions(
  ctx: MutationCtx,
  userId: Id<"users">,
  except?: Id<"authSessions">,
): Promise<number> {
  const sessions = await ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", userId)).collect();
  let revoked = 0;
  for (const session of sessions) {
    if (session._id === except) continue;
    const tokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionIdAndParentRefreshTokenId", (q) => q.eq("sessionId", session._id))
      .collect();
    for (const token of tokens) await ctx.db.delete(token._id);
    const grants = await ctx.db.query("stepUpGrants").withIndex("by_session", (q) => q.eq("sessionId", session._id)).collect();
    for (const grant of grants) await ctx.db.delete(grant._id);
    await ctx.db.delete(session._id);
    revoked += 1;
  }
  return revoked;
}

import type { MutationCtx, QueryCtx } from "../_generated/server";
import { afterFailure, lockedOut } from "./twoFactor";

/**
 * Limits on guessing: a handful of wrong tries at a password or a code, then a pause.
 *
 * Keyed by what is being guessed (an account, an address), not by who is guessing — the server
 * doesn't see a caller's address in an action, and an attacker has as many of those as they like.
 * The cost is that somebody can lock a victim out of guessing for a quarter of an hour; that is
 * the usual trade, and it never locks out someone who already has a session.
 *
 * `recordFailure` has to be called from a mutation that *returns* the refusal rather than
 * throwing it: a thrown error rolls the transaction back, and the failure with it.
 */

/** When guessing at `key` is allowed again, or `null` if it is allowed now. */
export async function lockedUntil(ctx: QueryCtx, key: string): Promise<number | null> {
  const row = await ctx.db.query("securityRateLimits").withIndex("by_key", (q) => q.eq("key", key)).unique();
  return lockedOut(row, Date.now());
}

export async function recordFailure(ctx: MutationCtx, key: string): Promise<void> {
  const row = await ctx.db.query("securityRateLimits").withIndex("by_key", (q) => q.eq("key", key)).unique();
  const next = afterFailure(row, Date.now());
  if (row) await ctx.db.patch(row._id, { ...next, lockedUntil: next.lockedUntil });
  else await ctx.db.insert("securityRateLimits", { key, ...next });
}

export async function clearFailures(ctx: MutationCtx, key: string): Promise<void> {
  const row = await ctx.db.query("securityRateLimits").withIndex("by_key", (q) => q.eq("key", key)).unique();
  if (row) await ctx.db.delete(row._id);
}

/**
 * A plain allowance: at most `max` of something per `windowMs`, for things that are limited by how
 * often they happen rather than by how often they fail (looking up an address, making a guest).
 * Returns whether this one is allowed, and counts it if so. A refused attempt isn't counted, so
 * waiting out the window is always enough.
 */
export async function allow(ctx: MutationCtx, key: string, max: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const row = await ctx.db.query("securityRateLimits").withIndex("by_key", (q) => q.eq("key", key)).unique();
  if (!row || now - row.windowStart >= windowMs) {
    if (row) await ctx.db.patch(row._id, { failures: 1, windowStart: now, lockedUntil: undefined });
    else await ctx.db.insert("securityRateLimits", { key, failures: 1, windowStart: now });
    return true;
  }
  if (row.failures >= max) return false;
  await ctx.db.patch(row._id, { failures: row.failures + 1 });
  return true;
}

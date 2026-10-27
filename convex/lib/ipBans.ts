import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { sealIp } from "./ip";

/**
 * Every read and write of `userIps` and `bannedIps` is in this file, so there is
 * one place to check that an address never leaves the database.
 *
 * Nothing here returns an address — not decrypted, not as ciphertext, not as a
 * hash. What comes out is only yes/no ("is this address banned?") and counts.
 */

/** How many distinct addresses we keep per account; the least recently seen go first. */
const MAX_ADDRESSES_PER_USER = 25;
/** An address already on file is only touched again after this long, so the usual
 * app load costs a read and no write. */
const REFRESH_AFTER_MS = 60 * 60 * 1000;

/** Seal the caller's address without letting a failure get in the way of signing
 * in. If sealing fails we would rather lose a record than lock everyone out. */
export async function sealRequestIp(ip: string | null | undefined): Promise<{ ipHash: string; ipCipher: string } | null> {
  try {
    return await sealIp(ip);
  } catch (error) {
    console.error("Couldn't record an IP address:", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

/** Note that `userId` was seen at this address. */
export async function recordIp(
  ctx: MutationCtx,
  userId: Id<"users">,
  sealed: { ipHash: string; ipCipher: string },
): Promise<void> {
  const now = Date.now();
  const existing = await ctx.db
    .query("userIps")
    .withIndex("by_user_hash", (q) => q.eq("userId", userId).eq("ipHash", sealed.ipHash))
    .unique();
  if (existing) {
    if (now - existing.lastSeenAt >= REFRESH_AFTER_MS) await ctx.db.patch(existing._id, { lastSeenAt: now });
    return;
  }
  await ctx.db.insert("userIps", { userId, ipHash: sealed.ipHash, ipCipher: sealed.ipCipher, firstSeenAt: now, lastSeenAt: now });
  const newest = await ctx.db
    .query("userIps")
    .withIndex("by_user_seen", (q) => q.eq("userId", userId))
    .order("desc")
    .take(MAX_ADDRESSES_PER_USER + 1);
  if (newest.length > MAX_ADDRESSES_PER_USER) await ctx.db.delete(newest[MAX_ADDRESSES_PER_USER]._id);
}

/** Whether new accounts are refused from this address. */
export async function isIpBanned(ctx: QueryCtx, ipHash: string): Promise<boolean> {
  const rows = await ctx.db.query("bannedIps").withIndex("by_hash", (q) => q.eq("ipHash", ipHash)).take(20);
  return rows.some((row) => row.liftedAt === undefined);
}

/** Refuse new accounts from every address a banned account has used. Returns how
 * many addresses that covered. */
export async function banAddressesOf(
  ctx: MutationCtx,
  userId: Id<"users">,
  actorId: Id<"users">,
  reason: string | undefined,
): Promise<number> {
  const seen = await ctx.db.query("userIps").withIndex("by_user_seen", (q) => q.eq("userId", userId)).take(MAX_ADDRESSES_PER_USER + 1);
  let banned = 0;
  for (const address of seen) {
    if (await isIpBanned(ctx, address.ipHash)) continue;
    await ctx.db.insert("bannedIps", {
      ipHash: address.ipHash,
      ipCipher: address.ipCipher,
      userId,
      actorId,
      reason,
      createdAt: Date.now(),
    });
    banned += 1;
  }
  return banned;
}

/** Lift the address bans that came from this account. */
export async function liftAddressBansOf(ctx: MutationCtx, userId: Id<"users">): Promise<number> {
  const rows = await ctx.db.query("bannedIps").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_ADDRESSES_PER_USER * 4);
  let lifted = 0;
  for (const row of rows) {
    if (row.liftedAt !== undefined) continue;
    await ctx.db.patch(row._id, { liftedAt: Date.now() });
    lifted += 1;
  }
  return lifted;
}

/** How many addresses are banned because of this account — a count, for the console. */
export async function countAddressBansOf(ctx: QueryCtx, userId: Id<"users">): Promise<number> {
  const rows = await ctx.db.query("bannedIps").withIndex("by_user", (q) => q.eq("userId", userId)).take(MAX_ADDRESSES_PER_USER * 4);
  return rows.filter((row) => row.liftedAt === undefined).length;
}

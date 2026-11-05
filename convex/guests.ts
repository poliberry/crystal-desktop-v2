import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { wipeProfile } from "./lib/accountWipe";
import { revokeSessions } from "./lib/sessions";

/**
 * Guest accounts that have run out.
 *
 * Wiped down to an anonymous placeholder, not deleted: messages, reactions and the rest point at
 * the user row, and a hundred tables of them can't be chased. What goes is everything that made it
 * a person — the name, picture, bio, memberships, friends, sessions — and its username, which
 * becomes free for someone else.
 */
const BATCH = 25;

/** How far Axiom's counts go. Past this it says "1000+". */
const COUNT_CAP = 1000;

async function wipeOne(ctx: MutationCtx, user: { _id: Id<"users"> }, placeholderName: string): Promise<string> {
  const full = await ctx.db.get(user._id);
  if (!full) throw new Error("That account is gone.");
  const freed = full.username ?? "";
  await revokeSessions(ctx, full._id);
  for (const row of await ctx.db.query("communityMembers").withIndex("by_user", (q) => q.eq("userId", full._id)).collect()) {
    for (const role of await ctx.db.query("memberRoles").withIndex("by_member", (q) => q.eq("communityId", row.communityId).eq("userId", full._id)).collect()) {
      await ctx.db.delete(role._id);
    }
    await ctx.db.delete(row._id);
  }
  for (const f of await ctx.db.query("friendships").withIndex("by_owner", (q) => q.eq("ownerId", full._id)).collect()) await ctx.db.delete(f._id);
  for (const r of await ctx.db.query("friendRequests").withIndex("by_requester", (q) => q.eq("requesterId", full._id)).collect()) await ctx.db.delete(r._id);
  for (const r of await ctx.db.query("friendRequests").withIndex("by_recipient", (q) => q.eq("recipientId", full._id)).collect()) await ctx.db.delete(r._id);
  for (const p of await ctx.db.query("presence").withIndex("by_user", (q) => q.eq("userId", full._id)).collect()) await ctx.db.delete(p._id);
  for (const p of await ctx.db.query("presenceSessions").withIndex("by_user", (q) => q.eq("userId", full._id)).collect()) await ctx.db.delete(p._id);
  for (const t of await ctx.db.query("devicePushTokens").withIndex("by_user", (q) => q.eq("userId", full._id)).collect()) await ctx.db.delete(t._id);
  for (const s of await ctx.db.query("savedMessages").withIndex("by_user_created", (q) => q.eq("userId", full._id)).collect()) await ctx.db.delete(s._id);

  const now = Date.now();
  await ctx.db.patch(full._id, { guestExpiresAt: undefined, guestExpiredAt: now });
  // The name, pictures and the rest of the profile, files included. The
  // username becomes free for someone else.
  await wipeProfile(ctx, full, {
    name: placeholderName,
    username: `guest.${full._id.slice(-10).toLowerCase().replace(/[^a-z0-9]/g, "x")}`,
  });
  return freed;
}

async function wipeBatch(ctx: MutationCtx): Promise<number> {
    const now = Date.now();
    const due = await ctx.db
      .query("users")
      .withIndex("by_guest_expiry", (q) => q.gt("guestExpiresAt", 0).lte("guestExpiresAt", now))
      .take(BATCH);
    for (const user of due) {
      await wipeOne(ctx, user, "Expired guest");
    }
    return due.length;
}

/** One batch, then carries on straight away while a full batch came back, so a backlog clears. */
async function wipeAndContinue(ctx: MutationCtx): Promise<{ wiped: number; continuing: boolean }> {
  const wiped = await wipeBatch(ctx);
  const continuing = wiped === BATCH;
  if (continuing) await ctx.scheduler.runAfter(0, internal.guests.sweepExpired, {});
  return { wiped, continuing };
}

export const sweepExpired = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => (await wipeAndContinue(ctx)).wiped,
});

/** What a purge would touch, for Axiom's Crystal Moderation app. */
export const adminGuestOverview = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("users")
      .withIndex("by_guest_expiry", (q) => q.gt("guestExpiresAt", 0).lte("guestExpiresAt", now))
      .take(COUNT_CAP + 1);
    const active = await ctx.db
      .query("users")
      .withIndex("by_guest_expiry", (q) => q.gt("guestExpiresAt", now))
      .take(COUNT_CAP + 1);
    return {
      expired: Math.min(due.length, COUNT_CAP),
      expiredCapped: due.length > COUNT_CAP,
      active: Math.min(active.length, COUNT_CAP),
      activeCapped: active.length > COUNT_CAP,
      // Longest overdue first.
      sample: due.slice(0, 25).map((u) => ({ _id: u._id, username: u.username ?? null, name: u.name ?? null, guestExpiresAt: u.guestExpiresAt ?? null })),
    };
  },
});

/**
 * Wipes expired guests now rather than at the next sweep, the same way the sweep does. Only accounts
 * already past their expiry are touched: a guest still inside their day isn't in this index range.
 */
export const adminPurgeExpiredGuests = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ wiped: number; continuing: boolean }> => wipeAndContinue(ctx),
});

/**
 * Wipes one guest by id or username, expired or still inside their day — the
 * same wipe the sweep does (sessions revoked first, so an active guest is
 * signed out at once). Refuses anything that isn't a guest, and anything
 * already wiped: usernames of real accounts are never freed by this.
 */
export const adminDeleteGuest = internalMutation({
  args: { userId: v.optional(v.id("users")), username: v.optional(v.string()) },
  handler: async (ctx, { userId, username }): Promise<{ wiped: number; username: string }> => {
    const name = username?.trim().toLowerCase();
    const user = userId
      ? await ctx.db.get(userId)
      : name
        ? await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", name)).unique()
        : null;
    if (!user) throw new Error(userId ? "That account is gone." : "No account with that username.");
    if (!user.isGuest) throw new Error(`@${user.username} is not a guest account.`);
    if (user.guestExpiredAt) throw new Error(`@${user.username} was already wiped.`);
    const freed = await wipeOne(ctx, user, "Deleted guest");
    return { wiped: 1, username: freed };
  },
});

/** Old counters: the throttles' rows pile up one per network. */
export const sweepLimits = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const rows = await ctx.db.query("securityRateLimits").take(500);
    let removed = 0;
    for (const row of rows) {
      if (row.windowStart < cutoff && (row.lockedUntil ?? 0) < Date.now()) {
        await ctx.db.delete(row._id);
        removed += 1;
      }
    }
    // Proofs, tickets, challenges and codes that ran out without being used.
    const now = Date.now();
    for (const row of await ctx.db.query("authEmailProofs").take(200)) if (row.expiresAt < now) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("authTickets").take(200)) if (row.expiresAt < now) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("authSecondFactorChallenges").take(200)) if (row.expiresAt < now) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("qrLoginRequests").take(200)) if (row.expiresAt < now) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("authEmailCodes").take(200)) if (row.expiresAt < now) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("webauthnChallenges").take(200)) if (row.expiresAt < now) await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("stepUpGrants").take(200)) if (row.expiresAt < now) await ctx.db.delete(row._id);
    return removed;
  },
});

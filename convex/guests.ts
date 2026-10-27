import { internalMutation } from "./_generated/server";
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

export const sweepExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("users")
      .withIndex("by_guest_expiry", (q) => q.gt("guestExpiresAt", 0).lte("guestExpiresAt", now))
      .take(BATCH);
    for (const user of due) {
      await revokeSessions(ctx, user._id);
      for (const row of await ctx.db.query("communityMembers").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()) {
        for (const role of await ctx.db.query("memberRoles").withIndex("by_member", (q) => q.eq("communityId", row.communityId).eq("userId", user._id)).collect()) {
          await ctx.db.delete(role._id);
        }
        await ctx.db.delete(row._id);
      }
      for (const f of await ctx.db.query("friendships").withIndex("by_owner", (q) => q.eq("ownerId", user._id)).collect()) await ctx.db.delete(f._id);
      for (const r of await ctx.db.query("friendRequests").withIndex("by_requester", (q) => q.eq("requesterId", user._id)).collect()) await ctx.db.delete(r._id);
      for (const r of await ctx.db.query("friendRequests").withIndex("by_recipient", (q) => q.eq("recipientId", user._id)).collect()) await ctx.db.delete(r._id);
      for (const p of await ctx.db.query("presence").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()) await ctx.db.delete(p._id);
      for (const p of await ctx.db.query("presenceSessions").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()) await ctx.db.delete(p._id);
      for (const t of await ctx.db.query("devicePushTokens").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()) await ctx.db.delete(t._id);
      for (const s of await ctx.db.query("savedMessages").withIndex("by_user_created", (q) => q.eq("userId", user._id)).collect()) await ctx.db.delete(s._id);

      await ctx.db.patch(user._id, { guestExpiresAt: undefined, guestExpiredAt: now });
      // The name, pictures and the rest of the profile, files included.
      await wipeProfile(ctx, user, {
        name: "Expired guest",
        username: `guest.${user._id.slice(-10).toLowerCase().replace(/[^a-z0-9]/g, "x")}`,
      });
    }
    return due.length;
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

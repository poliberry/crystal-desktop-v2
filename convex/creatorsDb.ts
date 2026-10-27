import { v } from "convex/values";

import { internalMutation, internalQuery, query } from "./_generated/server";
import { getCurrentUserOrNull } from "./users";

/**
 * A creator's payout account and what they have earned.
 *
 * Nothing here is writable from the app. Whether an account can take payouts is
 * Stripe's answer, copied in by `creators.refreshAccount` and the `account.updated`
 * webhook — a creator who could set it themselves could mark an unverified
 * account as ready, or point their earnings at an account that isn't theirs.
 */

/** What the app is told about the caller's own payout account. Not the Stripe
 * account's id: nothing in the app needs it. */
export const myAccount = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    const account = await ctx.db
      .query("creatorAccounts")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .unique();
    if (!account) return { connected: false as const };
    return {
      connected: true as const,
      detailsSubmitted: account.detailsSubmitted ?? false,
      chargesEnabled: account.chargesEnabled,
      payoutsEnabled: account.payoutsEnabled,
    };
  },
});

/** The caller's earnings: totals by currency and the latest sales. */
export const myEarnings = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    const rows = await ctx.db
      .query("creatorEarnings")
      .withIndex("by_creator", (q) => q.eq("creatorId", me._id))
      .order("desc")
      .take(500);

    const totals = new Map<string, { currency: string; paid: number; waiting: number; reversed: number }>();
    for (const row of rows) {
      const entry = totals.get(row.currency) ?? { currency: row.currency, paid: 0, waiting: 0, reversed: 0 };
      if (row.status === "transferred") entry.paid += row.creatorCents;
      else if (row.status === "held" || row.status === "pending") entry.waiting += row.creatorCents;
      else if (row.status === "refunded") entry.reversed += row.creatorCents;
      totals.set(row.currency, entry);
    }

    const recent = await Promise.all(
      rows.slice(0, 30).map(async (row) => ({
        id: row._id,
        skuName: (await ctx.db.get(row.skuId))?.name ?? "Removed item",
        creatorCents: row.creatorCents,
        grossCents: row.grossCents,
        currency: row.currency,
        status: row.status,
        createdAt: row.createdAt,
      })),
    );
    return { totals: [...totals.values()], recent };
  },
});

export const accountForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) =>
    ctx.db
      .query("creatorAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique(),
});

/** Remember which Stripe account is a user's. The first one wins: a creator
 * clicking twice must not end up with two. */
export const createAccount = internalMutation({
  args: { userId: v.id("users"), stripeAccountId: v.string() },
  handler: async (ctx, { userId, stripeAccountId }) => {
    const existing = await ctx.db
      .query("creatorAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) return existing.stripeAccountId;
    const now = Date.now();
    await ctx.db.insert("creatorAccounts", {
      userId,
      stripeAccountId,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      createdAt: now,
      updatedAt: now,
    });
    return stripeAccountId;
  },
});

/** Copy Stripe's view of an account in. Returns the creator it belongs to. */
export const setAccountFlags = internalMutation({
  args: {
    stripeAccountId: v.string(),
    chargesEnabled: v.boolean(),
    payoutsEnabled: v.boolean(),
    detailsSubmitted: v.boolean(),
  },
  handler: async (ctx, { stripeAccountId, ...flags }) => {
    const account = await ctx.db
      .query("creatorAccounts")
      .withIndex("by_stripe_account", (q) => q.eq("stripeAccountId", stripeAccountId))
      .unique();
    if (!account) return null;
    await ctx.db.patch(account._id, { ...flags, updatedAt: Date.now() });
    return account.userId;
  },
});

export const creatorForOrder = internalQuery({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.get(orderId);
    if (!order) return null;
    const sku = await ctx.db.get(order.skuId);
    if (!sku?.creatorId) return null;
    const creatorId = sku.creatorId;
    return {
      creatorId,
      creatorShareBps: sku.creatorShareBps,
      account: await ctx.db
        .query("creatorAccounts")
        .withIndex("by_user", (q) => q.eq("userId", creatorId))
        .unique(),
    };
  },
});

export const earningForOrder = internalQuery({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) =>
    ctx.db
      .query("creatorEarnings")
      .withIndex("by_order", (q) => q.eq("orderId", orderId))
      .unique(),
});

/** Earnings still waiting to be paid out — held for onboarding, or failed. */
export const unpaidForCreator = internalQuery({
  args: { creatorId: v.id("users") },
  handler: async (ctx, { creatorId }) => {
    const rows = await ctx.db
      .query("creatorEarnings")
      .withIndex("by_creator", (q) => q.eq("creatorId", creatorId))
      .collect();
    return rows.filter((r) => r.status === "held" || r.status === "pending").map((r) => r.orderId);
  },
});

/** Write an order's earning: created the first time, updated after. */
export const recordEarning = internalMutation({
  args: {
    orderId: v.id("orders"),
    creatorId: v.id("users"),
    skuId: v.id("skus"),
    grossCents: v.number(),
    platformFeeCents: v.number(),
    creatorCents: v.number(),
    currency: v.string(),
    status: v.union(v.literal("pending"), v.literal("transferred"), v.literal("held"), v.literal("refunded")),
    stripeTransferId: v.optional(v.string()),
    stripeReversalId: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("creatorEarnings")
      .withIndex("by_order", (q) => q.eq("orderId", args.orderId))
      .unique();
    const now = Date.now();
    if (existing) {
      // A paid-out earning is only ever moved on by a reversal, never back.
      if (existing.status === "transferred" && args.status === "transferred") {
        // Only a note can change: this is how a failed reversal is flagged.
        if (args.note !== undefined) await ctx.db.patch(existing._id, { note: args.note, updatedAt: now });
        return existing._id;
      }
      if (existing.status === "transferred" && args.status !== "refunded") return existing._id;
      if (existing.status === "refunded") return existing._id;
      await ctx.db.patch(existing._id, {
        status: args.status,
        stripeTransferId: args.stripeTransferId ?? existing.stripeTransferId,
        stripeReversalId: args.stripeReversalId ?? existing.stripeReversalId,
        note: args.note,
        updatedAt: now,
      });
      return existing._id;
    }
    return ctx.db.insert("creatorEarnings", { ...args, createdAt: now, updatedAt: now });
  },
});

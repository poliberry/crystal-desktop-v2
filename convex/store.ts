import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { requireCommunity } from "./communities";
import {
  grantEntitlements,
  isActive,
  ownsSku,
  revokeOrderEntitlements,
  setOrderEntitlementExpiry,
} from "./lib/entitlements";
import { requireCommunityPermission } from "./permissions";
import { PERMISSIONS } from "./permissions";

/**
 * The marketplace's internals: everything that decides what an order is worth
 * and what it gives. Only `payments.ts` (which talks to Stripe) calls these, and
 * none of them is reachable from the app.
 *
 * The rule they all serve: the client says *what it wants*, and the server
 * decides everything else — the price from the SKU's row, whether the buyer
 * may have it, and whether a payment really happened (because Stripe says so,
 * not because the client does).
 */

export const userByClerkId = internalQuery({
  args: { clerkId: v.string() },
  handler: async (ctx, { clerkId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();
    return user ? { id: user._id, name: user.name, username: user.username } : null;
  },
});

export const skuForSync = internalQuery({
  args: { skuId: v.id("skus") },
  handler: async (ctx, { skuId }) => ctx.db.get(skuId),
});

export const setStripeIds = internalMutation({
  args: {
    skuId: v.id("skus"),
    stripeProductId: v.string(),
    stripePriceId: v.optional(v.string()),
  },
  handler: async (ctx, { skuId, stripeProductId, stripePriceId }) => {
    await ctx.db.patch(skuId, {
      stripeProductId,
      ...(stripePriceId ? { stripePriceId } : {}),
    });
  },
});

export const stripeCustomerFor = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const row = await ctx.db
      .query("stripeCustomers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return row?.stripeCustomerId ?? null;
  },
});

export const saveStripeCustomer = internalMutation({
  args: { userId: v.id("users"), stripeCustomerId: v.string() },
  handler: async (ctx, { userId, stripeCustomerId }) => {
    const existing = await ctx.db
      .query("stripeCustomers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    // First writer wins: two tabs racing to make a customer must end up with one.
    if (existing) return existing.stripeCustomerId;
    await ctx.db.insert("stripeCustomers", { userId, stripeCustomerId });
    return stripeCustomerId;
  },
});

export const userForCustomer = internalQuery({
  args: { stripeCustomerId: v.string() },
  handler: async (ctx, { stripeCustomerId }) => {
    const row = await ctx.db
      .query("stripeCustomers")
      .withIndex("by_stripe_customer", (q) => q.eq("stripeCustomerId", stripeCustomerId))
      .unique();
    return row?.userId ?? null;
  },
});

/**
 * Everything needed to start buying something, checked in one place.
 *
 * Returns what the SKU costs *now*, read from the database — the price is never
 * an argument to anything.
 */
export const prepareOrder = internalMutation({
  args: {
    userId: v.id("users"),
    skuId: v.id("skus"),
    communityId: v.optional(v.id("communities")),
  },
  handler: async (ctx, { userId, skuId, communityId }) => {
    const sku = await ctx.db.get(skuId);
    if (!sku || sku.status !== "active") throw new Error("That item isn't for sale.");

    if (sku.type === "community") {
      if (!communityId) throw new Error("Pick which community this is for.");
      const community = await requireCommunity(ctx, communityId);
      // Whoever buys something for a community has to be able to run it.
      await requireCommunityPermission(ctx, community, userId, PERMISSIONS.MANAGE_COMMUNITY);
    } else if (communityId) {
      throw new Error("That item isn't for a community.");
    }

    // One Crystal plan at a time: a second would charge for perks the first
    // already gives. Cancelling the current one leaves it running until the end
    // of what was paid for, and the new one can be bought when it has.
    if (sku.grants.some((g) => g.kind === "plan")) {
      const held = await ctx.db
        .query("entitlements")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      if (held.some((e) => e.kind === "plan" && isActive(e))) {
        throw new Error(
          "You already have a Crystal plan. Cancel it in Settings → Subscriptions and you can switch when it ends.",
        );
      }
    }

    if (await ownsSku(ctx, userId, skuId, communityId)) {
      throw new Error(sku.type === "subscription" ? "You're already subscribed." : "You already own that.");
    }

    // Crystal Geode plans carry their cosmetic discount as a signed, staff-
    // authored grant payload. Apply it only to one-time cosmetic/community
    // purchases; subscriptions and bundles retain their catalogue price.
    let discountBps = 0;
    if (sku.type === "cosmetic" || sku.type === "community") {
      const plans = await ctx.db
        .query("entitlements")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const entitlement of plans) {
        if (!isActive(entitlement) || entitlement.kind !== "plan") continue;
        try {
          const payload = JSON.parse(entitlement.payload ?? "") as { cosmeticDiscountBps?: unknown };
          if (typeof payload.cosmeticDiscountBps === "number") {
            discountBps = Math.max(discountBps, Math.min(5000, Math.floor(payload.cosmeticDiscountBps)));
          }
        } catch {
          // A malformed legacy plan simply grants no discount.
        }
      }
    }
    const amountCents = Math.max(
      0,
      Math.floor((sku.priceCents * (10000 - discountBps)) / 10000),
    );

    // A purchase that was started and never finished is reused rather than piled
    // up: the buyer reopening the dialog gets the same order, not another.
    const pending = await ctx.db
      .query("orders")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);
    const reusable = pending.find(
      (o) =>
        o.skuId === skuId &&
        o.status === "pending" &&
        o.communityId === communityId &&
        // A stale intent is not worth resuming.
        Date.now() - o.createdAt < 60 * 60 * 1000 &&
        // The price may have changed since: resuming at the old one would charge
        // what the SKU no longer costs.
        o.amountCents === amountCents &&
        o.currency === sku.currency
    );

    const orderId =
      reusable?._id ??
      (await ctx.db.insert("orders", {
        userId,
        skuId,
        skuName: sku.name,
        status: "pending",
        amountCents,
        discountCents: sku.priceCents - amountCents,
        currency: sku.currency,
        communityId,
        grants: sku.grants.map((g) => ({ kind: g.kind, payload: g.payload, label: g.label })),
        createdAt: Date.now(),
      }));

    return {
      orderId,
      reused: !!reusable,
      amountCents,
      discountBps,
      existingIntentId: reusable?.stripePaymentIntentId,
      existingSubscriptionId: reusable?.stripeSubscriptionId,
      sku: {
        id: sku._id,
        name: sku.name,
        type: sku.type,
        priceCents: sku.priceCents,
        currency: sku.currency,
        interval: sku.interval,
        stripePriceId: sku.stripePriceId,
        stripeProductId: sku.stripeProductId,
      },
    };
  },
});

export const attachStripeObjects = internalMutation({
  args: {
    orderId: v.id("orders"),
    paymentIntentId: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
  },
  handler: async (ctx, { orderId, paymentIntentId, subscriptionId }) => {
    await ctx.db.patch(orderId, {
      ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
      ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
    });
  },
});

export const orderById = internalQuery({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => ctx.db.get(orderId),
});

export const orderBySubscription = internalQuery({
  args: { subscriptionId: v.string() },
  handler: async (ctx, { subscriptionId }) =>
    ctx.db
      .query("orders")
      .withIndex("by_subscription", (q) => q.eq("stripeSubscriptionId", subscriptionId))
      .first(),
});

export const orderByPaymentIntent = internalQuery({
  args: { paymentIntentId: v.string() },
  handler: async (ctx, { paymentIntentId }) =>
    ctx.db
      .query("orders")
      .withIndex("by_payment_intent", (q) => q.eq("stripePaymentIntentId", paymentIntentId))
      .first(),
});

/** A user's paid subscription orders, newest first. */
export const subscriptionOrdersFor = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("orders")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    return rows.filter((o) => o.status === "paid" && !!o.stripeSubscriptionId);
  },
});

/** A free item: there is nothing to charge, so the order is paid as it is made. */
export const completeFreeOrder = internalMutation({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.get(orderId);
    if (!order) throw new Error("That order doesn't exist.");
    if (order.amountCents !== 0) throw new Error("That isn't a free item.");
    if (order.status === "paid") return;
    await ctx.db.patch(orderId, { status: "paid", paidAt: Date.now() });
    await grantEntitlements(ctx, {
      userId: order.userId,
      skuId: order.skuId,
      grants: order.grants,
      source: "purchase",
      orderId,
      communityId: order.communityId,
    });
  },
});

/**
 * An order has been paid. Gives the buyer what it promised — once.
 *
 * Called by the webhook and by the buyer's own "did that work?" check, which
 * both read the payment from Stripe first. It checks the amount and currency
 * against the order, so a payment for less than the item costs gives nothing.
 * Calling it again for an order that is already paid does nothing, which is what
 * makes a retried or duplicated webhook harmless.
 */
export const fulfillOrder = internalMutation({
  args: {
    orderId: v.id("orders"),
    paymentIntentId: v.optional(v.string()),
    amountCents: v.number(),
    currency: v.string(),
    /** Subscriptions: the end of what has just been paid for, in epoch ms. */
    periodEnd: v.optional(v.number()),
  },
  handler: async (ctx, { orderId, paymentIntentId, amountCents, currency, periodEnd }) => {
    const order = await ctx.db.get(orderId);
    if (!order) return { ok: false as const, reason: "missing" };

    if (order.amountCents !== amountCents || order.currency !== currency.toLowerCase()) {
      return { ok: false as const, reason: "amount_mismatch" };
    }
    if (order.status === "refunded") return { ok: false as const, reason: "refunded" };

    const isSubscription = !!order.stripeSubscriptionId;
    if (order.status === "paid") {
      // A renewal: the order is already paid, and what changes is how far it runs.
      if (isSubscription && periodEnd !== undefined) {
        await setOrderEntitlementExpiry(ctx, orderId, periodEnd);
      }
      return { ok: true as const, already: true };
    }

    await ctx.db.patch(orderId, {
      status: "paid",
      paidAt: Date.now(),
      ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
    });
    await grantEntitlements(ctx, {
      userId: order.userId,
      skuId: order.skuId,
      grants: order.grants,
      source: isSubscription ? "subscription" : "purchase",
      orderId,
      communityId: order.communityId,
      expiresAt: isSubscription ? periodEnd : undefined,
    });
    await ctx.scheduler.runAfter(0, internal.creators.transferForOrder, { orderId });
    return { ok: true as const, already: false };
  },
});

export const failOrder = internalMutation({
  args: { orderId: v.id("orders"), status: v.union(v.literal("failed"), v.literal("canceled")) },
  handler: async (ctx, { orderId, status }) => {
    const order = await ctx.db.get(orderId);
    // Only a payment that is still open can fail: a paid order stays paid.
    if (order && order.status === "pending") await ctx.db.patch(orderId, { status });
  },
});

/** A subscription ended: what it gave stops now. */
export const endSubscription = internalMutation({
  args: { orderId: v.id("orders"), endedAt: v.number() },
  handler: async (ctx, { orderId, endedAt }) => {
    await setOrderEntitlementExpiry(ctx, orderId, endedAt);
  },
});

export const markRefunded = internalMutation({
  args: { orderId: v.id("orders"), refundedCents: v.number() },
  handler: async (ctx, { orderId, refundedCents }) => {
    const order = await ctx.db.get(orderId);
    if (!order || order.status === "refunded") return;
    const full = refundedCents >= order.amountCents;
    await ctx.db.patch(orderId, {
      refundedCents,
      // A part-refund is a record of money going back, not of the purchase being
      // undone: only a full one takes the item away.
      ...(full ? { status: "refunded" as const, refundedAt: Date.now() } : {}),
    });
    if (full) await revokeOrderEntitlements(ctx, orderId);
  },
});

/** Webhook de-duplication: `true` the first time an event is seen, `false` after. */
export const claimEvent = internalMutation({
  args: { eventId: v.string(), type: v.string() },
  handler: async (ctx, { eventId, type }) => {
    const seen = await ctx.db
      .query("stripeEvents")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .first();
    if (seen) return false;
    await ctx.db.insert("stripeEvents", { eventId, type, handledAt: Date.now() });
    return true;
  },
});

/** If handling an event fails, it must be handled again when Stripe retries. */
export const releaseEvent = internalMutation({
  args: { eventId: v.string() },
  handler: async (ctx, { eventId }) => {
    const row = await ctx.db
      .query("stripeEvents")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .first();
    if (row) await ctx.db.delete(row._id);
  },
});

/** Record a finance action taken from an action, which has no database of its own. */
export const logFinanceAction = internalMutation({
  args: {
    actorId: v.id("users"),
    action: v.string(),
    targetId: v.string(),
    summary: v.string(),
  },
  handler: async (ctx, { actorId, action, targetId, summary }) => {
    await ctx.db.insert("staffAuditLog", {
      actorId,
      action,
      targetType: "order",
      targetId,
      summary: summary.slice(0, 500),
      createdAt: Date.now(),
    });
  },
});

export type OrderDoc = Doc<"orders">;
export type OrderId = Id<"orders">;

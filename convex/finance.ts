import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { isActive } from "./lib/entitlements";
import { audit, requireStaff } from "./lib/staff";

/**
 * The finance section: revenue, orders, refunds and creator payouts.
 *
 * Every function asks for `finance.read`, which only the finance role holds —
 * owners and admins do not, on purpose. Money is grouped by currency and never
 * converted: converting needs an exchange-rate policy this doesn't have, and a
 * silently-wrong total is worse than two honest ones.
 */

const DAY = 24 * 60 * 60 * 1000;

type OrderStatus = Doc<"orders">["status"];

/** Revenue for a window, and the shape of it over time. */
export const summary = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    await requireStaff(ctx, "finance.read");
    const windowDays = Math.min(Math.max(Math.floor(days ?? 30), 1), 365);
    const since = Date.now() - windowDays * DAY;
    const orders = await ctx.db
      .query("orders")
      .withIndex("by_created", (q) => q.gte("createdAt", since))
      .take(10_000);

    const byCurrency = new Map<
      string,
      { currency: string; gross: number; refunded: number; discounts: number; orders: number; refunds: number }
    >();
    const entry = (currency: string) => {
      let e = byCurrency.get(currency);
      if (!e) {
        e = { currency, gross: 0, refunded: 0, discounts: 0, orders: 0, refunds: 0 };
        byCurrency.set(currency, e);
      }
      return e;
    };

    // One bucket per day, per currency — the chart's data.
    const series = new Map<string, Map<string, number>>();
    const bucket = (currency: string, at: number, cents: number) => {
      const day = new Date(at).toISOString().slice(0, 10);
      let perDay = series.get(currency);
      if (!perDay) {
        perDay = new Map();
        series.set(currency, perDay);
      }
      perDay.set(day, (perDay.get(day) ?? 0) + cents);
    };

    const bySku = new Map<string, { name: string; currency: string; cents: number; units: number }>();
    for (const order of orders) {
      const e = entry(order.currency);
      if (order.status === "paid" || order.status === "refunded") {
        e.gross += order.amountCents;
        e.discounts += order.discountCents ?? 0;
        e.orders += 1;
        bucket(order.currency, order.paidAt ?? order.createdAt, order.amountCents);
        const key = `${order.skuId}:${order.currency}`;
        const sku = bySku.get(key) ?? { name: order.skuName, currency: order.currency, cents: 0, units: 0 };
        sku.cents += order.amountCents - (order.refundedCents ?? 0);
        sku.units += 1;
        bySku.set(key, sku);
      }
      if (order.refundedCents) {
        e.refunded += order.refundedCents;
        e.refunds += 1;
        bucket(order.currency, order.refundedAt ?? order.createdAt, -order.refundedCents);
      }
    }

    // What recurring revenue looks like right now: paid subscriptions whose plan
    // is still in force, normalised to a month.
    const subs = (
      await ctx.db.query("orders").filter((q) => q.neq(q.field("stripeSubscriptionId"), undefined)).take(5000)
    ).filter((o) => o.status === "paid");
    const entitlementActive = await Promise.all(
      subs.map(async (o) => {
        const rows = await ctx.db
          .query("entitlements")
          .withIndex("by_order", (q) => q.eq("orderId", o._id))
          .take(1);
        return rows[0] ? isActive(rows[0]) : false;
      }),
    );
    const recurring = new Map<string, { currency: string; monthlyCents: number; subscribers: number }>();
    for (let i = 0; i < subs.length; i++) {
      if (!entitlementActive[i]) continue;
      const order = subs[i];
      const sku = await ctx.db.get(order.skuId);
      const monthly = sku?.interval === "year" ? Math.round(order.amountCents / 12) : order.amountCents;
      const r = recurring.get(order.currency) ?? { currency: order.currency, monthlyCents: 0, subscribers: 0 };
      r.monthlyCents += monthly;
      r.subscribers += 1;
      recurring.set(order.currency, r);
    }

    // Creator payouts: what has been paid, what is waiting, what failed.
    const earnings = await ctx.db.query("creatorEarnings").order("desc").take(5000);
    const payouts = new Map<string, { currency: string; paid: number; waiting: number; failed: number }>();
    for (const row of earnings) {
      const p = payouts.get(row.currency) ?? { currency: row.currency, paid: 0, waiting: 0, failed: 0 };
      if (row.status === "transferred") p.paid += row.creatorCents;
      else if (row.status === "held") p.waiting += row.creatorCents;
      else if (row.status === "pending") p.failed += row.creatorCents;
      payouts.set(row.currency, p);
    }

    const dates: string[] = [];
    for (let i = windowDays - 1; i >= 0; i--) dates.push(new Date(Date.now() - i * DAY).toISOString().slice(0, 10));

    return {
      days: windowDays,
      currencies: [...byCurrency.values()].map((e) => ({
        ...e,
        net: e.gross - e.refunded,
        series: dates.map((date) => ({ date, cents: series.get(e.currency)?.get(date) ?? 0 })),
      })),
      topItems: [...bySku.values()].sort((a, b) => b.cents - a.cents).slice(0, 8),
      recurring: [...recurring.values()],
      payouts: [...payouts.values()],
      pending: orders.filter((o) => o.status === "pending").length,
      failed: orders.filter((o) => o.status === "failed").length,
    };
  },
});

/** Orders, newest first, optionally filtered. */
export const orders = query({
  args: {
    status: v.optional(
      v.union(v.literal("pending"), v.literal("paid"), v.literal("failed"), v.literal("canceled"), v.literal("refunded")),
    ),
    username: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { status, username, limit }) => {
    await requireStaff(ctx, "finance.read");
    const cap = Math.min(Math.max(Math.floor(limit ?? 50), 1), 200);

    let rows: Doc<"orders">[];
    const needle = username?.trim().toLowerCase().replace(/^@/, "");
    if (needle) {
      const user = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", needle)).unique();
      if (!user) return [];
      rows = await ctx.db.query("orders").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(cap * 2);
    } else if (status) {
      rows = await ctx.db.query("orders").withIndex("by_status", (q) => q.eq("status", status)).order("desc").take(cap);
    } else {
      rows = await ctx.db.query("orders").withIndex("by_created").order("desc").take(cap);
    }
    if (needle && status) rows = rows.filter((o) => o.status === status);

    const names = new Map<Id<"users">, string>();
    return Promise.all(
      rows.slice(0, cap).map(async (order) => {
        if (!names.has(order.userId)) names.set(order.userId, (await ctx.db.get(order.userId))?.username ?? "unknown");
        return {
          id: order._id,
          skuName: order.skuName,
          status: order.status,
          amountCents: order.amountCents,
          discountCents: order.discountCents ?? 0,
          currency: order.currency,
          createdAt: order.createdAt,
          refundedCents: order.refundedCents ?? 0,
          isSubscription: !!order.stripeSubscriptionId,
          username: names.get(order.userId)!,
          userId: order.userId,
        };
      }),
    );
  },
});

/** One order in full, with everything staff need to settle a question about it. */
export const orderDetail = query({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    await requireStaff(ctx, "finance.read");
    const order = await ctx.db.get(orderId);
    if (!order) return null;
    const [user, sku, entitlements, earning] = await Promise.all([
      ctx.db.get(order.userId),
      ctx.db.get(order.skuId),
      ctx.db.query("entitlements").withIndex("by_order", (q) => q.eq("orderId", orderId)).take(20),
      ctx.db.query("creatorEarnings").withIndex("by_order", (q) => q.eq("orderId", orderId)).unique(),
    ]);
    const creator = earning ? await ctx.db.get(earning.creatorId) : null;
    return {
      id: order._id,
      status: order.status,
      skuId: order.skuId,
      skuName: order.skuName,
      amountCents: order.amountCents,
      discountCents: order.discountCents ?? 0,
      currency: order.currency,
      createdAt: order.createdAt,
      paidAt: order.paidAt ?? null,
      refundedAt: order.refundedAt ?? null,
      refundedCents: order.refundedCents ?? 0,
      isSubscription: !!order.stripeSubscriptionId,
      stripePaymentIntentId: order.stripePaymentIntentId ?? null,
      stripeSubscriptionId: order.stripeSubscriptionId ?? null,
      user: user ? { id: user._id, name: user.name, username: user.username } : null,
      skuStatus: sku?.status ?? null,
      entitlements: entitlements.map((e) => ({
        id: e._id,
        kind: e.kind,
        active: isActive(e),
        expiresAt: e.expiresAt ?? null,
        revokedAt: e.revokedAt ?? null,
      })),
      earning: earning
        ? {
            creator: creator?.username ?? "unknown",
            creatorId: earning.creatorId,
            creatorCents: earning.creatorCents,
            platformFeeCents: earning.platformFeeCents,
            status: earning.status,
            note: earning.note ?? null,
          }
        : null,
    };
  },
});

/** Creator payouts, with the ones that need attention first. */
export const payouts = query({
  args: {
    status: v.optional(v.union(v.literal("pending"), v.literal("held"), v.literal("transferred"), v.literal("refunded"))),
  },
  handler: async (ctx, { status }) => {
    await requireStaff(ctx, "finance.read");
    const rows = status
      ? await ctx.db.query("creatorEarnings").withIndex("by_status", (q) => q.eq("status", status)).order("desc").take(200)
      : await ctx.db.query("creatorEarnings").order("desc").take(200);
    const rank = { pending: 0, held: 1, transferred: 2, refunded: 3 } as const;
    const names = new Map<Id<"users">, string>();
    const out = await Promise.all(
      rows.map(async (row) => {
        if (!names.has(row.creatorId)) names.set(row.creatorId, (await ctx.db.get(row.creatorId))?.username ?? "unknown");
        return {
          id: row._id,
          orderId: row.orderId,
          creator: names.get(row.creatorId)!,
          creatorId: row.creatorId,
          skuName: (await ctx.db.get(row.skuId))?.name ?? "Removed item",
          creatorCents: row.creatorCents,
          platformFeeCents: row.platformFeeCents,
          grossCents: row.grossCents,
          currency: row.currency,
          status: row.status,
          note: row.note ?? null,
          createdAt: row.createdAt,
        };
      }),
    );
    return out.sort((a, b) => rank[a.status] - rank[b.status] || b.createdAt - a.createdAt);
  },
});

const csvCell = (value: string | number) => {
  const text = String(value);
  // A leading = + - @ would be run as a formula by a spreadsheet; prefix it so
  // a username or item name can't turn an export into one.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Orders as CSV, for accounting. A mutation only so the export is on the record
 * — who took what out is something the audit log should say. */
export const exportOrders = mutation({
  args: { days: v.number() },
  handler: async (ctx, { days }) => {
    const staff = await requireStaff(ctx, "finance.read");
    const windowDays = Math.min(Math.max(Math.floor(days), 1), 365);
    const since = Date.now() - windowDays * DAY;
    const rows = await ctx.db
      .query("orders")
      .withIndex("by_created", (q) => q.gte("createdAt", since))
      .take(5000);
    const status = (s: OrderStatus) => s;
    const lines = [
      ["order_id", "date", "status", "item", "username", "currency", "amount", "discount", "refunded"].join(","),
    ];
    const names = new Map<Id<"users">, string>();
    for (const order of rows) {
      if (!names.has(order.userId)) names.set(order.userId, (await ctx.db.get(order.userId))?.username ?? "unknown");
      lines.push(
        [
          order._id,
          new Date(order.paidAt ?? order.createdAt).toISOString(),
          status(order.status),
          order.skuName,
          names.get(order.userId)!,
          order.currency.toUpperCase(),
          (order.amountCents / 100).toFixed(2),
          ((order.discountCents ?? 0) / 100).toFixed(2),
          ((order.refundedCents ?? 0) / 100).toFixed(2),
        ]
          .map(csvCell)
          .join(","),
      );
    }
    await audit(ctx, staff.user._id, "finance.export", undefined, `${rows.length} orders, last ${windowDays} days`);
    return { csv: lines.join("\n"), rows: rows.length };
  },
});

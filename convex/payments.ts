"use node";

import { v } from "convex/values";
import Stripe from "stripe";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, type ActionCtx } from "./_generated/server";

/**
 * Stripe: publishing the catalogue, taking payment, and hearing back.
 *
 * Three rules run through all of it.
 *
 *  1. **The server decides the price.** `startPurchase` takes a SKU and nothing
 *     else about money; the amount comes from the SKU's row (via
 *     `store.prepareOrder`), and the order records it.
 *  2. **A payment is real because Stripe says so.** Fulfilment happens from the
 *     webhook, or from `confirmOrder`, which asks Stripe — never from anything the
 *     browser reports.
 *  3. **Doing it twice does no harm.** Events are recorded as they are handled,
 *     fulfilment ignores an order that is already paid, and Stripe calls carry
 *     idempotency keys, so a retry, a double-click or a duplicated delivery cannot
 *     charge or give twice.
 *
 * Needs `STRIPE_SECRET_KEY` and, for the webhook, `STRIPE_WEBHOOK_SECRET` on the
 * Convex deployment.
 */

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Payments aren't set up yet.");
  return new Stripe(key);
}

/** The signed-in user's id in our database, or an error. */
async function requireUserId(ctx: ActionCtx): Promise<{ userId: Id<"users">; email?: string; name?: string }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in.");
  const user = await ctx.runQuery(internal.store.userByClerkId, { clerkId: identity.subject });
  if (!user) throw new Error("Your account isn't ready yet.");
  return { userId: user.id, email: identity.email ?? undefined, name: user.name };
}

/** The Stripe customer for a user, made on first need. */
async function ensureCustomer(
  ctx: ActionCtx,
  stripe: Stripe,
  who: { userId: Id<"users">; email?: string; name?: string }
): Promise<string> {
  const existing = await ctx.runQuery(internal.store.stripeCustomerFor, { userId: who.userId });
  if (existing) return existing;
  const customer = await stripe.customers.create(
    { email: who.email, name: who.name, metadata: { userId: who.userId } },
    // One per user even if two tabs ask at once.
    { idempotencyKey: `customer-${who.userId}` }
  );
  return ctx.runMutation(internal.store.saveStripeCustomer, {
    userId: who.userId,
    stripeCustomerId: customer.id,
  });
}

// --- Publishing the catalogue ----------------------------------------------------

/**
 * Tell Stripe about a SKU: its product, and a price that matches it.
 *
 * A Stripe price can't be edited, so a changed price is a new one and the old is
 * switched off — subscribers already on the old one stay on it, which is what
 * they agreed to.
 */
export const syncSku = internalAction({
  args: { skuId: v.id("skus") },
  handler: async (ctx, { skuId }) => {
    if (!process.env.STRIPE_SECRET_KEY) return { synced: false, reason: "not_configured" };
    const stripe = stripeClient();
    const sku = await ctx.runQuery(internal.store.skuForSync, { skuId });
    if (!sku || sku.priceCents === 0) return { synced: false, reason: "free_or_missing" };

    const productFields = {
      name: sku.name,
      description: sku.description || undefined,
      images: sku.imageUrl ? [sku.imageUrl] : undefined,
      metadata: { skuId: sku._id, type: sku.type },
    };
    const productId = sku.stripeProductId
      ? (await stripe.products.update(sku.stripeProductId, productFields)).id
      : (await stripe.products.create(productFields)).id;

    let priceId = sku.stripePriceId;
    if (priceId) {
      const current = await stripe.prices.retrieve(priceId);
      const matches =
        current.active &&
        current.unit_amount === sku.priceCents &&
        current.currency === sku.currency &&
        (current.recurring?.interval ?? undefined) === sku.interval;
      if (!matches) {
        await stripe.prices.update(priceId, { active: false });
        priceId = undefined;
      }
    }
    if (!priceId) {
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: sku.priceCents,
        currency: sku.currency,
        ...(sku.interval ? { recurring: { interval: sku.interval } } : {}),
        metadata: { skuId: sku._id },
      });
      priceId = price.id;
    }
    await ctx.runMutation(internal.store.setStripeIds, {
      skuId,
      stripeProductId: productId,
      stripePriceId: priceId,
    });
    return { synced: true };
  },
});

// --- Buying -------------------------------------------------------------------------

/**
 * Start buying a SKU.
 *
 * Returns either `free` (it was free, and is already yours) or the secret the
 * browser uses to take payment with Stripe's own card fields — the card details
 * go to Stripe and never through here.
 */
export const startPurchase = action({
  args: {
    skuId: v.id("skus"),
    communityId: v.optional(v.id("communities")),
    /** Keep the card for next time. */
    saveCard: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { skuId, communityId, saveCard }
  ): Promise<
    | { kind: "free"; orderId: Id<"orders"> }
    | { kind: "payment"; orderId: Id<"orders">; clientSecret: string; amountCents: number; currency: string }
  > => {
    const who = await requireUserId(ctx);
    const prepared = await ctx.runMutation(internal.store.prepareOrder, {
      userId: who.userId,
      skuId,
      communityId,
    });

    if (prepared.amountCents === 0) {
      await ctx.runMutation(internal.store.completeFreeOrder, { orderId: prepared.orderId });
      return { kind: "free", orderId: prepared.orderId };
    }

    const stripe = stripeClient();
    const customerId = await ensureCustomer(ctx, stripe, who);
    const metadata = { orderId: prepared.orderId, userId: who.userId, skuId };

    if (prepared.sku.type === "subscription") {
      let priceId = prepared.sku.stripePriceId;
      if (!priceId) {
        // Published a moment ago and not yet synced: do it now rather than make
        // the buyer wait and retry.
        await ctx.runAction(internal.payments.syncSku, { skuId });
        const refreshed = await ctx.runQuery(internal.store.skuForSync, { skuId });
        priceId = refreshed?.stripePriceId;
      }
      if (!priceId) throw new Error("That item isn't ready to buy yet.");

      const subscription = prepared.existingSubscriptionId
        ? await stripe.subscriptions.retrieve(prepared.existingSubscriptionId, {
            expand: ["latest_invoice.confirmation_secret"],
          })
        : await stripe.subscriptions.create(
            {
              customer: customerId,
              items: [{ price: priceId }],
              payment_behavior: "default_incomplete",
              payment_settings: { save_default_payment_method: "on_subscription" },
              metadata,
              expand: ["latest_invoice.confirmation_secret"],
            },
            { idempotencyKey: `subscription-${prepared.orderId}` }
          );
      await ctx.runMutation(internal.store.attachStripeObjects, {
        orderId: prepared.orderId,
        subscriptionId: subscription.id,
      });
      const invoice = subscription.latest_invoice;
      const secret =
        invoice && typeof invoice !== "string" ? invoice.confirmation_secret?.client_secret : undefined;
      if (!secret) throw new Error("Couldn't start that subscription. Try again.");
      return {
        kind: "payment",
        orderId: prepared.orderId,
        clientSecret: secret,
        amountCents: prepared.amountCents,
        currency: prepared.sku.currency,
      };
    }

    // A one-time purchase: a PaymentIntent for exactly what the SKU costs.
    if (prepared.existingIntentId) {
      const existing = await stripe.paymentIntents.retrieve(prepared.existingIntentId);
      const open = ["requires_payment_method", "requires_confirmation", "requires_action"].includes(existing.status);
      if (open && existing.client_secret && existing.amount === prepared.amountCents) {
        return {
          kind: "payment",
          orderId: prepared.orderId,
          clientSecret: existing.client_secret,
          amountCents: existing.amount,
          currency: existing.currency,
        };
      }
    }
    const intent = await stripe.paymentIntents.create(
      {
        amount: prepared.amountCents,
        currency: prepared.sku.currency,
        customer: customerId,
        automatic_payment_methods: { enabled: true },
        description: prepared.sku.name,
        receipt_email: who.email,
        metadata,
        ...(saveCard ? { setup_future_usage: "off_session" as const } : {}),
      },
      { idempotencyKey: `order-${prepared.orderId}-${prepared.reused ? "r" : "n"}` }
    );
    await ctx.runMutation(internal.store.attachStripeObjects, {
      orderId: prepared.orderId,
      paymentIntentId: intent.id,
    });
    if (!intent.client_secret) throw new Error("Couldn't start that payment. Try again.");
    return {
      kind: "payment",
      orderId: prepared.orderId,
      clientSecret: intent.client_secret,
      amountCents: intent.amount,
      currency: intent.currency,
    };
  },
});

/** The end of a subscription period, in epoch ms. */
async function periodEndOf(stripe: Stripe, subscriptionId: string): Promise<number | undefined> {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const end = subscription.items.data[0]?.current_period_end;
  return end ? end * 1000 : undefined;
}

/**
 * "Did my payment go through?" — answered by asking Stripe.
 *
 * The browser calls this after paying, so the item appears at once instead of
 * when the webhook arrives (which, in development without the Stripe CLI, may be
 * never). It trusts nothing it is told: it reads the payment from Stripe and
 * fulfils from that.
 */
export const confirmOrder = action({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }): Promise<{ status: "paid" | "pending" | "failed" }> => {
    const who = await requireUserId(ctx);
    const order = await ctx.runQuery(internal.store.orderById, { orderId });
    if (!order || order.userId !== who.userId) throw new Error("That order isn't yours.");
    if (order.status === "paid") return { status: "paid" };
    if (order.status === "failed" || order.status === "canceled") return { status: "failed" };

    const stripe = stripeClient();

    if (order.stripeSubscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(order.stripeSubscriptionId, {
        expand: ["latest_invoice"],
      });
      const invoice = subscription.latest_invoice;
      if (invoice && typeof invoice !== "string" && invoice.status === "paid") {
        const result = await ctx.runMutation(internal.store.fulfillOrder, {
          orderId,
          amountCents: invoice.amount_paid,
          currency: invoice.currency,
          periodEnd: subscription.items.data[0]?.current_period_end
            ? subscription.items.data[0].current_period_end * 1000
            : undefined,
        });
        return { status: result.ok ? "paid" : "pending" };
      }
      return { status: "pending" };
    }

    if (!order.stripePaymentIntentId) return { status: "pending" };
    const intent = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId);
    if (intent.status === "succeeded") {
      const result = await ctx.runMutation(internal.store.fulfillOrder, {
        orderId,
        paymentIntentId: intent.id,
        amountCents: intent.amount_received,
        currency: intent.currency,
      });
      return { status: result.ok ? "paid" : "pending" };
    }
    if (intent.status === "canceled") {
      await ctx.runMutation(internal.store.failOrder, { orderId, status: "canceled" });
      return { status: "failed" };
    }
    return { status: "pending" };
  },
});

// --- Saved payment methods -------------------------------------------------------------

export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

export const listPaymentMethods = action({
  args: {},
  handler: async (ctx): Promise<SavedCard[]> => {
    const who = await requireUserId(ctx);
    const customerId = await ctx.runQuery(internal.store.stripeCustomerFor, { userId: who.userId });
    // No customer yet means no cards: nothing to list, and nothing to create.
    if (!customerId) return [];
    const stripe = stripeClient();
    const [methods, customer] = await Promise.all([
      stripe.paymentMethods.list({ customer: customerId, type: "card" }),
      stripe.customers.retrieve(customerId),
    ]);
    const defaultId =
      !customer.deleted && customer.invoice_settings.default_payment_method
        ? typeof customer.invoice_settings.default_payment_method === "string"
          ? customer.invoice_settings.default_payment_method
          : customer.invoice_settings.default_payment_method.id
        : null;
    return methods.data.map((m) => ({
      id: m.id,
      brand: m.card?.brand ?? "card",
      last4: m.card?.last4 ?? "????",
      expMonth: m.card?.exp_month ?? 0,
      expYear: m.card?.exp_year ?? 0,
      isDefault: m.id === defaultId,
    }));
  },
});

/** A secret for saving a card without buying anything. */
export const createSetupIntent = action({
  args: {},
  handler: async (ctx): Promise<{ clientSecret: string }> => {
    const who = await requireUserId(ctx);
    const stripe = stripeClient();
    const customerId = await ensureCustomer(ctx, stripe, who);
    const intent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session",
    });
    if (!intent.client_secret) throw new Error("Couldn't start that. Try again.");
    return { clientSecret: intent.client_secret };
  },
});

/** Only a card that belongs to the caller's own customer can be touched: the id
 * comes from the browser, so it is checked against Stripe. */
async function ownedMethod(ctx: ActionCtx, stripe: Stripe, methodId: string) {
  const who = await requireUserId(ctx);
  const customerId = await ctx.runQuery(internal.store.stripeCustomerFor, { userId: who.userId });
  if (!customerId) throw new Error("No saved cards.");
  const method = await stripe.paymentMethods.retrieve(methodId);
  const owner = typeof method.customer === "string" ? method.customer : method.customer?.id;
  if (owner !== customerId) throw new Error("That isn't your card.");
  return customerId;
}

export const removePaymentMethod = action({
  args: { paymentMethodId: v.string() },
  handler: async (ctx, { paymentMethodId }) => {
    const stripe = stripeClient();
    await ownedMethod(ctx, stripe, paymentMethodId);
    await stripe.paymentMethods.detach(paymentMethodId);
  },
});

export const setDefaultPaymentMethod = action({
  args: { paymentMethodId: v.string() },
  handler: async (ctx, { paymentMethodId }) => {
    const stripe = stripeClient();
    const customerId = await ownedMethod(ctx, stripe, paymentMethodId);
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  },
});

/** Stop a subscription renewing. What was paid for stays until it runs out. */
export const cancelSubscription = action({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const who = await requireUserId(ctx);
    const order = await ctx.runQuery(internal.store.orderById, { orderId });
    if (!order || order.userId !== who.userId) throw new Error("That order isn't yours.");
    if (!order.stripeSubscriptionId) throw new Error("That isn't a subscription.");
    const stripe = stripeClient();
    await stripe.subscriptions.update(order.stripeSubscriptionId, { cancel_at_period_end: true });
  },
});

/** Undo "cancel at period end" while the subscription is still running. */
export const resumeSubscription = action({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const who = await requireUserId(ctx);
    const order = await ctx.runQuery(internal.store.orderById, { orderId });
    if (!order || order.userId !== who.userId) throw new Error("That order isn't yours.");
    if (!order.stripeSubscriptionId) throw new Error("That isn't a subscription.");
    const stripe = stripeClient();
    const subscription = await stripe.subscriptions.retrieve(order.stripeSubscriptionId);
    if (subscription.status === "canceled") throw new Error("That subscription has ended. Subscribe again to continue.");
    await stripe.subscriptions.update(order.stripeSubscriptionId, { cancel_at_period_end: false });
  },
});

export interface SubscriptionSummary {
  orderId: Id<"orders">;
  skuId: Id<"skus">;
  name: string;
  amountCents: number;
  currency: string;
  interval: "month" | "year" | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  /** Epoch ms: when it renews, or — if cancelled — when it runs out. */
  currentPeriodEnd: number | null;
  card: { brand: string; last4: string } | null;
}

/** The caller's subscriptions as Stripe sees them right now: the status and the
 * dates are Stripe's, and a copy of them here would only go out of date. */
export const listSubscriptions = action({
  args: {},
  handler: async (ctx): Promise<SubscriptionSummary[]> => {
    const who = await requireUserId(ctx);
    const orders = await ctx.runQuery(internal.store.subscriptionOrdersFor, { userId: who.userId });
    if (orders.length === 0) return [];
    const stripe = stripeClient();
    const out: SubscriptionSummary[] = [];
    for (const order of orders) {
      if (!order.stripeSubscriptionId) continue;
      try {
        const subscription = await stripe.subscriptions.retrieve(order.stripeSubscriptionId, {
          expand: ["default_payment_method"],
        });
        if (subscription.status === "canceled" || subscription.status === "incomplete_expired") continue;
        const item = subscription.items.data[0];
        const method =
          subscription.default_payment_method && typeof subscription.default_payment_method !== "string"
            ? subscription.default_payment_method
            : null;
        out.push({
          orderId: order._id,
          skuId: order.skuId,
          name: order.skuName,
          amountCents: item?.price.unit_amount ?? order.amountCents,
          currency: item?.price.currency ?? order.currency,
          interval: (item?.price.recurring?.interval as "month" | "year" | undefined) ?? null,
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          currentPeriodEnd: item?.current_period_end ? item.current_period_end * 1000 : null,
          card: method?.card ? { brand: method.card.brand, last4: method.card.last4 } : null,
        });
      } catch (error) {
        // A subscription Stripe can't find is not worth failing the whole list.
        console.error("Couldn't load subscription", order.stripeSubscriptionId, error);
      }
    }
    return out;
  },
});

/** A receipt the buyer can open: Stripe's hosted page for the charge or invoice. */
export const receiptUrl = action({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }): Promise<string | null> => {
    const who = await requireUserId(ctx);
    const order = await ctx.runQuery(internal.store.orderById, { orderId });
    if (!order || order.userId !== who.userId) throw new Error("That order isn't yours.");
    if (order.status !== "paid" && order.status !== "refunded") return null;
    const stripe = stripeClient();
    if (order.stripeSubscriptionId) {
      const invoices = await stripe.invoices.list({ subscription: order.stripeSubscriptionId, limit: 1 });
      return invoices.data[0]?.hosted_invoice_url ?? null;
    }
    if (!order.stripePaymentIntentId) return null;
    const intent = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId, {
      expand: ["latest_charge"],
    });
    const charge = intent.latest_charge && typeof intent.latest_charge !== "string" ? intent.latest_charge : null;
    return charge?.receipt_url ?? null;
  },
});

// --- Refunds (finance) -----------------------------------------------------------------

/**
 * Refund an order in full. Finance only — checked here, from the caller's staff
 * row, and not by whether the console showed the button.
 */
export const refundOrder = action({
  args: { orderId: v.id("orders"), reason: v.string() },
  handler: async (ctx, { orderId, reason }): Promise<{ refundedCents: number }> => {
    const staff = await ctx.runQuery(api.staff.me, {});
    if (!staff?.permissions.includes("finance.refund")) throw new Error("Not allowed.");
    const note = reason.trim();
    if (note.length < 3) throw new Error("Say why this is being refunded.");

    const order = await ctx.runQuery(internal.store.orderById, { orderId });
    if (!order) throw new Error("That order doesn't exist.");
    if (order.status !== "paid") throw new Error("Only a paid order can be refunded.");

    const stripe = stripeClient();
    let paymentIntentId = order.stripePaymentIntentId;
    if (!paymentIntentId && order.stripeSubscriptionId) {
      const invoices = await stripe.invoices.list({
        subscription: order.stripeSubscriptionId,
        limit: 1,
        expand: ["data.payments"],
      });
      const payment = invoices.data[0]?.payments?.data[0]?.payment;
      paymentIntentId =
        payment?.type === "payment_intent"
          ? typeof payment.payment_intent === "string"
            ? payment.payment_intent
            : payment.payment_intent?.id
          : undefined;
    }
    if (!paymentIntentId) throw new Error("There's no payment to refund for that order.");

    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        reason: "requested_by_customer",
        metadata: { orderId, by: staff.userId },
      },
      { idempotencyKey: `refund-${orderId}` }
    );
    await ctx.runMutation(internal.store.markRefunded, { orderId, refundedCents: refund.amount });
    // What the creator was paid for this sale comes back with it.
    if (refund.amount >= order.amountCents) {
      await ctx.runAction(internal.creators.reverseForOrder, { orderId });
    }
    // A refunded subscription stops renewing as well.
    if (order.stripeSubscriptionId) {
      await stripe.subscriptions.cancel(order.stripeSubscriptionId).catch(() => {});
    }
    await ctx.runMutation(internal.store.logFinanceAction, {
      actorId: staff.userId,
      action: "finance.refund",
      targetId: orderId,
      summary: `${order.skuName}: ${(refund.amount / 100).toFixed(2)} ${order.currency.toUpperCase()} — ${note}`.slice(0, 480),
    });
    return { refundedCents: refund.amount };
  },
});

// --- Stripe calling us ------------------------------------------------------------------

/**
 * Handle one webhook delivery.
 *
 * The signature is checked against the raw body before anything else is read;
 * an event whose signature doesn't verify is thrown away. Each event is claimed
 * first (so a duplicate is ignored) and released again if handling fails (so
 * Stripe's retry is handled, not ignored).
 */
export const handleWebhook = internalAction({
  args: { payload: v.string(), signature: v.string() },
  handler: async (ctx, { payload, signature }): Promise<void> => {
    // Two endpoints can point here: the platform's own events, and Connect's
    // (creator account changes). Each has its own signing secret.
    const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(
      (secret): secret is string => !!secret,
    );
    if (secrets.length === 0) throw new Error("Webhook secret isn't set.");
    const stripe = stripeClient();
    let event: Stripe.Event | null = null;
    let failure: unknown;
    for (const secret of secrets) {
      try {
        // Throws on a bad signature or a stale timestamp.
        event = stripe.webhooks.constructEvent(payload, signature, secret);
        break;
      } catch (error) {
        failure = error;
      }
    }
    if (!event) throw failure;

    const fresh = await ctx.runMutation(internal.store.claimEvent, { eventId: event.id, type: event.type });
    if (!fresh) return;

    try {
      await applyEvent(ctx, stripe, event);
    } catch (error) {
      await ctx.runMutation(internal.store.releaseEvent, { eventId: event.id });
      throw error;
    }
  },
});

async function applyEvent(ctx: ActionCtx, stripe: Stripe, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "payment_intent.succeeded": {
      const intent = event.data.object;
      const orderId = intent.metadata?.orderId as Id<"orders"> | undefined;
      // A subscription's payments are fulfilled from the invoice, not here.
      if (!orderId) return;
      const order = await ctx.runQuery(internal.store.orderById, { orderId });
      if (!order || order.stripeSubscriptionId) return;
      await ctx.runMutation(internal.store.fulfillOrder, {
        orderId,
        paymentIntentId: intent.id,
        amountCents: intent.amount_received,
        currency: intent.currency,
      });
      return;
    }

    case "payment_intent.payment_failed":
    case "payment_intent.canceled": {
      const intent = event.data.object;
      const orderId = intent.metadata?.orderId as Id<"orders"> | undefined;
      if (!orderId) return;
      const order = await ctx.runQuery(internal.store.orderById, { orderId });
      if (!order || order.stripeSubscriptionId) return;
      // A failed attempt can be retried on the same intent, so only a cancelled
      // intent closes the order for good.
      if (event.type === "payment_intent.canceled") {
        await ctx.runMutation(internal.store.failOrder, { orderId, status: "canceled" });
      }
      return;
    }

    case "invoice.paid": {
      const invoice = event.data.object;
      const subscriptionRef = invoice.parent?.subscription_details?.subscription;
      const subscriptionId = typeof subscriptionRef === "string" ? subscriptionRef : subscriptionRef?.id;
      if (!subscriptionId) return;
      const metaOrder = invoice.parent?.subscription_details?.metadata?.orderId as Id<"orders"> | undefined;
      const order = metaOrder
        ? await ctx.runQuery(internal.store.orderById, { orderId: metaOrder })
        : await ctx.runQuery(internal.store.orderBySubscription, { subscriptionId });
      if (!order) return;
      await ctx.runMutation(internal.store.fulfillOrder, {
        orderId: order._id,
        amountCents: invoice.amount_paid,
        currency: invoice.currency,
        periodEnd: await periodEndOf(stripe, subscriptionId),
      });
      return;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const order = await ctx.runQuery(internal.store.orderBySubscription, { subscriptionId: subscription.id });
      if (order) await ctx.runMutation(internal.store.endSubscription, { orderId: order._id, endedAt: Date.now() });
      return;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object;
      if (!["canceled", "unpaid", "incomplete_expired"].includes(subscription.status)) return;
      const order = await ctx.runQuery(internal.store.orderBySubscription, { subscriptionId: subscription.id });
      if (order) await ctx.runMutation(internal.store.endSubscription, { orderId: order._id, endedAt: Date.now() });
      return;
    }

    case "charge.refunded": {
      const charge = event.data.object;
      const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      let order = intentId
        ? await ctx.runQuery(internal.store.orderByPaymentIntent, { paymentIntentId: intentId })
        : null;
      if (!order) {
        // A subscription's charge: find it through its invoice.
        const invoiceRef = (charge as { invoice?: string | { id: string } | null }).invoice;
        const invoiceId = typeof invoiceRef === "string" ? invoiceRef : invoiceRef?.id;
        if (invoiceId) {
          const invoice = await stripe.invoices.retrieve(invoiceId);
          const ref = invoice.parent?.subscription_details?.subscription;
          const subscriptionId = typeof ref === "string" ? ref : ref?.id;
          if (subscriptionId) {
            order = await ctx.runQuery(internal.store.orderBySubscription, { subscriptionId });
          }
        }
      }
      if (order) {
        await ctx.runMutation(internal.store.markRefunded, {
          orderId: order._id,
          refundedCents: charge.amount_refunded,
        });
        // A refund made from Stripe's dashboard takes the creator's share back too.
        if (charge.amount_refunded >= order.amountCents) {
          await ctx.runAction(internal.creators.reverseForOrder, { orderId: order._id });
        }
      }
      return;
    }

    case "account.updated": {
      // A creator's payout account changed — copy Stripe's view in, and pay out
      // anything that was waiting for it.
      await ctx.runAction(internal.creators.syncFromWebhook, { stripeAccountId: event.data.object.id });
      return;
    }

    default:
      return;
  }
}

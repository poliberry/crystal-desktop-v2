import { action, query } from "./_generated/server";
import { api, components } from "./_generated/api";
import { StripeSubscriptions } from "@convex-dev/stripe";
import { v } from "convex/values";
import Stripe from "stripe";

const stripeClient = new StripeSubscriptions(components.stripe, {});
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Create a checkout session for a subscription
export const createSubscriptionCheckout = action({
  args: { priceId: v.string() },
  returns: v.object({
    sessionId: v.string(),
    url: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    // Get or create a Stripe customer
    const customer = await stripeClient.getOrCreateCustomer(ctx, {
      userId: identity.subject,
      email: identity.email,
      name: identity.name,
    });

    // Create checkout session
    return await stripeClient.createCheckoutSession(ctx, {
      priceId: args.priceId,
      customerId: customer.customerId,
      mode: "subscription",
      successUrl: "http://localhost:5173/?success=true",
      cancelUrl: "http://localhost:5173/?canceled=true",
      subscriptionMetadata: { userId: identity.subject },
    });
  },
});

// Create a checkout session for a one-time payment
export const createPaymentCheckout = action({
  args: { priceId: v.string() },
  returns: v.object({
    sessionId: v.string(),
    url: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const customer = await stripeClient.getOrCreateCustomer(ctx, {
      userId: identity.subject,
      email: identity.email,
      name: identity.name,
    });

    return await stripeClient.createCheckoutSession(ctx, {
      priceId: args.priceId,
      customerId: customer.customerId,
      mode: "payment",
      successUrl: "http://localhost:5173/?success=true",
      cancelUrl: "http://localhost:5173/?canceled=true",
      paymentIntentMetadata: { userId: identity.subject },
    });
  },
});

export const createSetupIntent = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new Error("Not authenticated");
    }

    const customer = await stripeClient.getOrCreateCustomer(ctx, {
      userId: identity.subject,
      email: identity.email,
      name: identity.name,
    });

    const setupIntent = await stripe.setupIntents.create({
      customer: customer.customerId,
      payment_method_types: ["card"],
      usage: "off_session",
    });

    return {
      clientSecret: setupIntent.client_secret,
    };
  },
});

export const getPaymentMethods = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    // Annotated to break a type cycle: `api` references this action, so its
    // return type can't depend on an inferred `customer` type.
    const customer: { customerId: string } = await ctx.runAction(
      api.users.createOrGetStripeUser,
    );

    const [paymentMethods, stripeCustomer, subscriptions] = await Promise.all([
      stripe.paymentMethods.list({ customer: customer.customerId, type: "card" }),
      stripe.customers.retrieve(customer.customerId),
      stripe.subscriptions.list({ customer: customer.customerId, status: "all" }),
    ]);

    // The customer's default payment method — the one new invoices charge
    // unless a subscription overrides it.
    const defaultPaymentMethodId =
      !stripeCustomer.deleted &&
      stripeCustomer.invoice_settings.default_payment_method
        ? typeof stripeCustomer.invoice_settings.default_payment_method === "string"
          ? stripeCustomer.invoice_settings.default_payment_method
          : stripeCustomer.invoice_settings.default_payment_method.id
        : null;

    // Any card a live subscription bills directly.
    const subscriptionPaymentMethodIds = new Set(
      subscriptions.data
        .filter(
          (s) =>
            s.status === "active" ||
            s.status === "trialing" ||
            s.status === "past_due",
        )
        .map((s) =>
          typeof s.default_payment_method === "string"
            ? s.default_payment_method
            : s.default_payment_method?.id,
        )
        .filter((id): id is string => !!id),
    );

    const country =
      (!stripeCustomer.deleted && stripeCustomer.address?.country) ||
      paymentMethods.data[0]?.card?.country ||
      null;

    const now = new Date();
    const methods = paymentMethods.data.map((pm) => {
      const expYear = pm.card?.exp_year ?? 0;
      const expMonth = pm.card?.exp_month ?? 0;
      const isExpired =
        expYear < now.getFullYear() ||
        (expYear === now.getFullYear() && expMonth < now.getMonth() + 1);
      return {
        id: pm.id,
        brand: pm.card?.brand ?? null,
        last4: pm.card?.last4 ?? null,
        expMonth: pm.card?.exp_month ?? null,
        expYear: pm.card?.exp_year ?? null,
        country: pm.card?.country ?? null,
        isDefault: pm.id === defaultPaymentMethodId,
        isSubscription: subscriptionPaymentMethodIds.has(pm.id),
        isExpired,
      };
    });

    return { country, methods };
  },
});

async function requireStripeCustomer(
  ctx: any,
): Promise<{ customerId: string }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return await ctx.runAction(api.users.createOrGetStripeUser);
}

async function assertPaymentMethodOwner(
  paymentMethodId: string,
  customerId: string,
) {
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  const owner = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
  if (owner !== customerId) throw new Error("Payment method not found");
}

async function assertSubscriptionOwner(
  subscriptionId: string,
  customerId: string,
) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const owner =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  if (owner !== customerId) throw new Error("Subscription not found");
}

export const setDefaultPaymentMethod = action({
  args: { paymentMethodId: v.string() },
  handler: async (ctx, args) => {
    const customer = await requireStripeCustomer(ctx);
    await assertPaymentMethodOwner(args.paymentMethodId, customer.customerId);
    await stripe.customers.update(customer.customerId, {
      invoice_settings: { default_payment_method: args.paymentMethodId },
    });
    return { ok: true };
  },
});

export const removePaymentMethod = action({
  args: { paymentMethodId: v.string() },
  handler: async (ctx, args) => {
    const customer = await requireStripeCustomer(ctx);
    await assertPaymentMethodOwner(args.paymentMethodId, customer.customerId);
    await stripe.paymentMethods.detach(args.paymentMethodId);
    return { ok: true };
  },
});

export const updateSubscriptionPaymentMethod = action({
  args: { subscriptionId: v.string(), paymentMethodId: v.string() },
  handler: async (ctx, args) => {
    const customer = await requireStripeCustomer(ctx);
    await assertSubscriptionOwner(args.subscriptionId, customer.customerId);
    await assertPaymentMethodOwner(args.paymentMethodId, customer.customerId);
    await stripe.subscriptions.update(args.subscriptionId, {
      default_payment_method: args.paymentMethodId,
    });
    return { ok: true };
  },
});

export const cancelSubscription = action({
  args: { subscriptionId: v.string(), immediately: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const customer = await requireStripeCustomer(ctx);
    await assertSubscriptionOwner(args.subscriptionId, customer.customerId);
    if (args.immediately) {
      await stripe.subscriptions.cancel(args.subscriptionId);
    } else {
      await stripe.subscriptions.update(args.subscriptionId, {
        cancel_at_period_end: true,
      });
    }
    return { ok: true };
  },
});

export const resumeSubscription = action({
  args: { subscriptionId: v.string() },
  handler: async (ctx, args) => {
    const customer = await requireStripeCustomer(ctx);
    await assertSubscriptionOwner(args.subscriptionId, customer.customerId);
    await stripe.subscriptions.update(args.subscriptionId, {
      cancel_at_period_end: false,
    });
    return { ok: true };
  },
});

export const getTransactions = action({
  args: {},
  handler: async (ctx) => {
    const customer = await requireStripeCustomer(ctx);
    if (!customer) return [];

    const invoices = await stripe.invoices.list({
      customer: customer.customerId,
      limit: 24,
    });

    return invoices.data.map((invoice) => {
      const lines = invoice.lines?.data ?? [];
      const description =
        lines[0]?.description ||
        lines
          .map((l) => l.description)
          .filter(Boolean)
          .join(", ") ||
        "Subscription";
      const failed =
        invoice.status === "uncollectible" ||
        (invoice.status === "open" && (invoice.attempt_count ?? 0) > 0);

      return {
        id: invoice.id,
        number: invoice.number ?? null,
        date: invoice.created,
        description,
        amount: invoice.total,
        currency: invoice.currency,
        status: invoice.status ?? "draft",
        paid: invoice.status === "paid",
        failed,
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
        invoicePdf: invoice.invoice_pdf ?? null,
        lines: lines.map((l) => ({
          description: l.description ?? "Item",
          amount: l.amount,
          currency: l.currency,
        })),
      };
    });
  },
});

export const getSubscriptions = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new Error("Not authenticated");
    }

    const customer = await ctx.runAction(
      api.users.createOrGetStripeUser
    );

    if (!customer) {
      return [];
    }

    const subscriptions = await stripe.subscriptions.list({
      customer: customer.customerId,
      status: "all",
      expand: [
        "data.items.data.price",
        "data.default_payment_method",
      ],
    });

    const results = await Promise.all(
      subscriptions.data.map(async (subscription) => {
        const item = subscription.items.data[0];

        if (!item) {
          return null;
        }

        // --------------------------------------------------
        // Product
        // --------------------------------------------------

        const productId =
          typeof item.price.product === "string"
            ? item.price.product
            : item.price.product.id;

        const product = await stripe.products.retrieve(productId);

        const productName = product.deleted
          ? "Subscription"
          : product.name;

        const productDescription = product.deleted
          ? null
          : product.description ?? null;

        // --------------------------------------------------
        // Payment method
        // --------------------------------------------------

        let paymentMethod =
          subscription.default_payment_method;

        // If the subscription doesn't have its own default
        // payment method, fall back to the customer's default.
        if (!paymentMethod) {
          const stripeCustomer =
            await stripe.customers.retrieve(
              customer.customerId
            );

          if (!stripeCustomer.deleted) {
            paymentMethod =
              stripeCustomer.invoice_settings
                .default_payment_method;
          }
        }

        let paymentMethodData = null;

        if (paymentMethod) {
          const paymentMethodId =
            typeof paymentMethod === "string"
              ? paymentMethod
              : paymentMethod.id;

          const stripePaymentMethod =
            typeof paymentMethod === "string"
              ? await stripe.paymentMethods.retrieve(
                  paymentMethod
                )
              : paymentMethod;

          if (
            stripePaymentMethod &&
            stripePaymentMethod.type === "card" &&
            stripePaymentMethod.card
          ) {
            paymentMethodData = {
              brand: stripePaymentMethod.card.brand,
              last4: stripePaymentMethod.card.last4,
              expMonth:
                stripePaymentMethod.card.exp_month,
              expYear:
                stripePaymentMethod.card.exp_year,
            };
          }
        }

        // --------------------------------------------------
        // Determine billing state
        // --------------------------------------------------

        const now = Math.floor(Date.now() / 1000);

        let billingStatus:
          | "active"
          | "trialing"
          | "paused"
          | "canceled"
          | "past_due"
          | "unpaid"
          | "incomplete"
          | "incomplete_expired"
          | "manual_invoice"
          | "unknown" = "unknown";

        if (subscription.status === "trialing") {
          billingStatus = "trialing";
        } else if (
          subscription.status === "canceled"
        ) {
          billingStatus = "canceled";
        } else if (
          subscription.status === "past_due"
        ) {
          billingStatus = "past_due";
        } else if (
          subscription.status === "unpaid"
        ) {
          billingStatus = "unpaid";
        } else if (
          subscription.status === "incomplete"
        ) {
          billingStatus = "incomplete";
        } else if (
          subscription.status === "incomplete_expired"
        ) {
          billingStatus = "incomplete_expired";
        } else if (subscription.pause_collection) {
          billingStatus = "paused";
        } else if (
          subscription.collection_method ===
          "send_invoice"
        ) {
          billingStatus = "manual_invoice";
        } else if (
          subscription.status === "active"
        ) {
          billingStatus = "active";
        }

        // --------------------------------------------------
        // Upcoming invoice
        // --------------------------------------------------

        let upcomingInvoice: Stripe.Invoice | null =
          null;

        if (
          subscription.status !== "canceled" &&
          subscription.status !== "incomplete_expired"
        ) {
          try {
            upcomingInvoice =
              await stripe.invoices.createPreview({
                customer: customer.customerId,
                subscription: subscription.id,
              });
          } catch (error) {
            // There isn't always an upcoming invoice.
            // For example, a paused/canceled subscription
            // may not have one.
            console.warn(
              `Unable to preview invoice for ${subscription.id}`,
              error
            );
          }
        }

        // --------------------------------------------------
        // Calculate next billing/payment date
        // --------------------------------------------------

        let nextPaymentDate: number | null = null;

        let paymentDateType:
          | "trial_end"
          | "automatic_payment"
          | "invoice_due"
          | "paused"
          | "canceled"
          | "none" = "none";

        // TRIAL
        //
        // If the subscription is currently trialing,
        // the important date is when the trial ends.
        if (
          subscription.status === "trialing" &&
          subscription.trial_end
        ) {
          nextPaymentDate = subscription.trial_end;
          paymentDateType = "trial_end";
        }

        // PAUSED
        //
        // A subscription with pause_collection won't
        // necessarily result in a payment at the normal
        // billing date.
        else if (subscription.pause_collection) {
          nextPaymentDate = null;
          paymentDateType = "paused";
        }

        // CANCELED
        //
        // There won't be another payment.
        else if (subscription.status === "canceled") {
          nextPaymentDate = null;
          paymentDateType = "canceled";
        }

        // MANUAL INVOICE
        //
        // For send_invoice subscriptions, the invoice's
        // due date is the relevant date.
        else if (
          subscription.collection_method ===
            "send_invoice" &&
          upcomingInvoice?.due_date
        ) {
          nextPaymentDate =
            upcomingInvoice.due_date;
          paymentDateType = "invoice_due";
        }

        // AUTOMATIC PAYMENT
        //
        // For charge_automatically subscriptions, Stripe
        // attempts payment rather than having an invoice
        // "due date".
        else if (
          subscription.collection_method ===
          "charge_automatically"
        ) {
          nextPaymentDate =
            upcomingInvoice?.next_payment_attempt ??
            null;

          paymentDateType = "automatic_payment";
        }

        // --------------------------------------------------
        // Amount
        // --------------------------------------------------

        let amount: number | null = null;
        let currency: string | null = null;

        if (upcomingInvoice) {
          amount = upcomingInvoice.amount_due;
          currency = upcomingInvoice.currency;
        } else {
          amount = item.price.unit_amount ?? 0;
          currency = item.price.currency;
        }

        // --------------------------------------------------
        // Return UI-friendly object
        // --------------------------------------------------

        return {
          id: subscription.id,

          name: productName,
          description: productDescription,

          amount,
          currency,

          interval:
            item.price.recurring?.interval ?? null,

          status: subscription.status,

          billingStatus,

          collectionMethod:
            subscription.collection_method,

          cancelAtPeriodEnd:
            subscription.cancel_at_period_end,

          nextPaymentDate,

          paymentDateType,

          paymentMethod: paymentMethodData,

          paymentMethodId: paymentMethod
            ? typeof paymentMethod === "string"
              ? paymentMethod
              : paymentMethod.id
            : null,

          trialEnd:
            subscription.trial_end ?? null,

          pauseCollection:
            subscription.pause_collection
              ? {
                  behavior:
                    subscription.pause_collection
                      .behavior,
                  resumesAt:
                    subscription.pause_collection
                      .resumes_at ?? null,
                }
              : null,
        };
      })
    );

    return results.filter(
      (
        subscription
      ): subscription is NonNullable<typeof subscription> =>
        subscription !== null
    );
  },
});

"use node";

import { v } from "convex/values";
import Stripe from "stripe";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, type ActionCtx } from "./_generated/server";

/**
 * Paying creators: Stripe Connect Express accounts, and a transfer for every
 * sale of something they made.
 *
 * The platform takes the payment (so refunds, receipts and disputes stay
 * with us) and sends the creator their share afterwards. Each step is safe to
 * run twice: accounts and transfers carry idempotency keys, and the earnings
 * ledger row records what has already happened.
 */

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Payments aren't set up yet.");
  return new Stripe(key);
}

async function requireUserId(ctx: ActionCtx): Promise<Id<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not signed in.");
  const user = await ctx.runQuery(internal.store.userByClerkId, { clerkId: identity.subject });
  if (!user) throw new Error("Your account isn't ready yet.");
  return user.id;
}

/** Where Stripe sends a creator back to. The app is a desktop window, so this is
 * a page that tells them to return to Crystal. */
function returnUrl(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? "https://usecrystal.app"}/creator-return`;
}

/** Start (or continue) setting up payouts. Returns the Stripe-hosted page to open. */
export const startOnboarding = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const userId = await requireUserId(ctx);
    const stripe = stripeClient();

    const existing = await ctx.runQuery(internal.creatorsDb.accountForUser, { userId });
    const accountId =
      existing?.stripeAccountId ??
      (await ctx.runMutation(internal.creatorsDb.createAccount, {
        userId,
        stripeAccountId: (
          await stripe.accounts.create(
            {
              type: "express",
              capabilities: { transfers: { requested: true } },
              metadata: { userId },
            },
            { idempotencyKey: `creator-account-${userId}` },
          )
        ).id,
      }));

    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: returnUrl(),
      return_url: returnUrl(),
    });
    return { url: link.url };
  },
});

/** Stripe's own dashboard for a creator who has finished onboarding: balance,
 * payouts and bank details, which are Stripe's to show and not ours. */
export const dashboardLink = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const userId = await requireUserId(ctx);
    const account = await ctx.runQuery(internal.creatorsDb.accountForUser, { userId });
    if (!account) throw new Error("Set up payouts first.");
    const link = await stripeClient().accounts.createLoginLink(account.stripeAccountId);
    return { url: link.url };
  },
});

/** Copy what Stripe says about an account into our records, and pay out anything
 * that was waiting on it. */
async function syncAccount(
  ctx: ActionCtx,
  stripe: Stripe,
  stripeAccountId: string,
): Promise<{ payoutsEnabled: boolean; detailsSubmitted: boolean }> {
  const account = await stripe.accounts.retrieve(stripeAccountId);
  const creatorId = await ctx.runMutation(internal.creatorsDb.setAccountFlags, {
    stripeAccountId,
    chargesEnabled: !!account.charges_enabled,
    payoutsEnabled: !!account.payouts_enabled,
    detailsSubmitted: !!account.details_submitted,
  });
  if (creatorId && account.payouts_enabled) {
    await ctx.runAction(internal.creators.releaseForCreator, { creatorId });
  }
  return { payoutsEnabled: !!account.payouts_enabled, detailsSubmitted: !!account.details_submitted };
}

/** "I've finished on Stripe's page" — ask Stripe rather than take their word. */
export const refreshAccount = action({
  args: {},
  handler: async (ctx): Promise<{ payoutsEnabled: boolean; detailsSubmitted: boolean }> => {
    const userId = await requireUserId(ctx);
    const account = await ctx.runQuery(internal.creatorsDb.accountForUser, { userId });
    if (!account) return { payoutsEnabled: false, detailsSubmitted: false };
    return syncAccount(ctx, stripeClient(), account.stripeAccountId);
  },
});

/** For the `account.updated` webhook. */
export const syncFromWebhook = internalAction({
  args: { stripeAccountId: v.string() },
  handler: async (ctx, { stripeAccountId }): Promise<void> => {
    await syncAccount(ctx, stripeClient(), stripeAccountId);
  },
});

/** The charge behind an order, so a transfer can be tied to it: Stripe then
 * holds the transfer until those funds are available instead of failing it. */
async function chargeFor(stripe: Stripe, paymentIntentId: string | undefined) {
  if (!paymentIntentId) return undefined;
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  return typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
}

/**
 * Pay the creator their share of one paid order.
 *
 * With no payout account ready the share is recorded as *held* rather than
 * dropped, and `releaseForCreator` pays it as soon as they finish onboarding.
 */
export const transferForOrder = internalAction({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.runQuery(internal.store.orderById, { orderId });
    if (!order || order.status !== "paid") return { status: "ignored" as const };
    const detail = await ctx.runQuery(internal.creatorsDb.creatorForOrder, { orderId });
    if (!detail) return { status: "no_creator" as const };

    const existing = await ctx.runQuery(internal.creatorsDb.earningForOrder, { orderId });
    if (existing && (existing.status === "transferred" || existing.status === "refunded")) {
      return { status: "already" as const };
    }

    const shareBps = Math.max(0, Math.min(9500, detail.creatorShareBps ?? 8000));
    const creatorCents = Math.floor((order.amountCents * shareBps) / 10000);
    if (creatorCents < 1) return { status: "nothing_to_pay" as const };

    const base = {
      orderId,
      creatorId: detail.creatorId,
      skuId: order.skuId,
      grossCents: order.amountCents,
      platformFeeCents: order.amountCents - creatorCents,
      creatorCents,
      currency: order.currency,
    };

    if (!detail.account?.payoutsEnabled) {
      await ctx.runMutation(internal.creatorsDb.recordEarning, {
        ...base,
        status: "held",
        note: "Waiting for the creator to finish setting up payouts.",
      });
      return { status: "held" as const };
    }

    try {
      const stripe = stripeClient();
      const transfer = await stripe.transfers.create(
        {
          amount: creatorCents,
          currency: order.currency,
          destination: detail.account.stripeAccountId,
          source_transaction: await chargeFor(stripe, order.stripePaymentIntentId),
          metadata: { orderId, skuId: order.skuId },
        },
        { idempotencyKey: `creator-transfer-${orderId}` },
      );
      await ctx.runMutation(internal.creatorsDb.recordEarning, {
        ...base,
        status: "transferred",
        stripeTransferId: transfer.id,
      });
      return { status: "transferred" as const };
    } catch (error) {
      // Recorded rather than thrown: a failed payout is a row finance can see
      // and retry, not a log line nobody reads.
      await ctx.runMutation(internal.creatorsDb.recordEarning, {
        ...base,
        status: "pending",
        note: (error instanceof Error ? error.message : "Transfer failed.").slice(0, 300),
      });
      return { status: "failed" as const };
    }
  },
});

/** Pay everything a creator was owed while they could not be paid. */
export const releaseForCreator = internalAction({
  args: { creatorId: v.id("users") },
  handler: async (ctx, { creatorId }): Promise<number> => {
    const orderIds = await ctx.runQuery(internal.creatorsDb.unpaidForCreator, { creatorId });
    for (const orderId of orderIds) {
      await ctx.runAction(internal.creators.transferForOrder, { orderId });
    }
    return orderIds.length;
  },
});

/**
 * A refunded order takes the creator's share back.
 *
 * Reversed in full whenever the order was refunded in full, so a refund can't
 * leave the platform out of pocket for a sale it no longer has. A share that was
 * never paid just stops being owed.
 */
export const reverseForOrder = internalAction({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }) => {
    const earning = await ctx.runQuery(internal.creatorsDb.earningForOrder, { orderId });
    if (!earning || earning.status === "refunded") return { status: "none" as const };
    const base = {
      orderId,
      creatorId: earning.creatorId,
      skuId: earning.skuId,
      grossCents: earning.grossCents,
      platformFeeCents: earning.platformFeeCents,
      creatorCents: earning.creatorCents,
      currency: earning.currency,
      status: "refunded" as const,
    };
    if (earning.status !== "transferred" || !earning.stripeTransferId) {
      await ctx.runMutation(internal.creatorsDb.recordEarning, {
        ...base,
        note: "Refunded before it was paid out.",
      });
      return { status: "cancelled" as const };
    }
    try {
      const reversal = await stripeClient().transfers.createReversal(
        earning.stripeTransferId,
        { amount: earning.creatorCents, metadata: { orderId } },
        { idempotencyKey: `creator-reversal-${orderId}` },
      );
      await ctx.runMutation(internal.creatorsDb.recordEarning, {
        ...base,
        stripeReversalId: reversal.id,
        note: "Reversed after a refund.",
      });
      return { status: "reversed" as const };
    } catch (error) {
      // The refund has happened; the reversal is the part that needs a person.
      console.error("Creator transfer reversal failed", orderId, error);
      await ctx.runMutation(internal.creatorsDb.recordEarning, {
        ...base,
        status: "transferred",
        stripeTransferId: earning.stripeTransferId,
        note: `Needs a manual reversal: ${error instanceof Error ? error.message : "unknown error"}`.slice(0, 300),
      });
      return { status: "failed" as const };
    }
  },
});

/** Retry a payout that failed, or that was held for something now fixed.
 * Finance only — checked from the caller's staff row, here. */
export const retryPayout = action({
  args: { orderId: v.id("orders") },
  handler: async (ctx, { orderId }): Promise<{ status: string }> => {
    const staff = await ctx.runQuery(api.staff.me, {});
    if (!staff?.permissions.includes("finance.payout")) throw new Error("Not allowed.");
    const result = await ctx.runAction(internal.creators.transferForOrder, { orderId });
    await ctx.runMutation(internal.store.logFinanceAction, {
      actorId: staff.userId,
      action: "finance.payout.retry",
      targetId: orderId,
      summary: `retry → ${result.status}`,
    });
    return { status: result.status };
  },
});

# Stripe setup

Stripe is configured through deployment secrets, never committed. Use **test-mode** keys until the whole flow has been walked through end to end.

## 1. Keys

On the Convex deployment (dev and prod are separate — set each):

```sh
npx convex env set STRIPE_SECRET_KEY sk_test_...
npx convex env set STRIPE_WEBHOOK_SECRET whsec_...            # the platform endpoint, below
npx convex env set STRIPE_CONNECT_WEBHOOK_SECRET whsec_...    # the Connect endpoint, below
npx convex env set NEXT_PUBLIC_APP_URL https://usecrystal.app # where creators return to after Stripe onboarding
```

In the environment the renderer is built in (`.env.local` for dev, the `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` GitHub secret for releases):

```sh
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

Without the publishable key the shop loads but says payments aren't set up; without the secret key nothing can be bought.

## 2. Webhooks

Both endpoints point at the same URL — the Convex HTTP route in `convex/http.ts`:

```
https://<deployment>.convex.site/stripe/webhook
```

Create **two** endpoints in Stripe's Workbench, because Stripe signs each with its own secret:

| Endpoint | Listens to | Secret goes in |
| --- | --- | --- |
| **Your account** | `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded` | `STRIPE_WEBHOOK_SECRET` |
| **Connected accounts** | `account.updated` | `STRIPE_CONNECT_WEBHOOK_SECRET` |

For local development, `stripe listen --forward-to <deployment>.convex.site/stripe/webhook` prints a signing secret to use as `STRIPE_WEBHOOK_SECRET`. The app also asks Stripe directly after a payment (`payments.confirmOrder`), so a purchase unlocks even before the webhook arrives — the webhook is what covers renewals, refunds made in the dashboard, and a closed window.

## 3. Creators (Stripe Connect)

Enable **Connect** and allow **Express** accounts with the `transfers` capability. Creators set up payouts from *Settings → Creator*; Stripe's page returns them to `NEXT_PUBLIC_APP_URL/creator-return`.

- A sale of a creator's item is charged on the platform. Their share (80% unless staff set otherwise when approving) is then **transferred**, tied to the charge so Stripe holds it until the funds are available.
- A sale made before the creator can be paid is recorded as *held* and paid out automatically once Stripe reports their account ready.
- A **full refund reverses the transfer**. If the reversal itself fails, the payout is flagged in *Finance → Creator payouts* for someone to settle by hand.
- Stripe's processing fees come out of the platform's share.

## 4. First staff member

Staff access is a table, not an environment variable. Make the first owner by hand, once:

```sh
npx convex run staff:bootstrap '{"username":"<their username>"}'
```

The owner can then add everyone else from the console (*Staff & roles*). **Finance is a separate role:** being an owner does not include it, and it has to be granted on purpose.

To fill an empty shop with a starting catalogue, open the console → *Catalogue* → *Add the starter catalogue*.

## How money is kept honest

- The price of anything is read from the catalogue on the server when the order is made — never from the browser.
- An order is paid because Stripe says so (the webhook, or `confirmOrder` asking Stripe) and for the amount the order recorded; a payment for less gives nothing.
- Webhook events are recorded as they're handled, so a duplicate delivery is a no-op, and a failed one is released so Stripe's retry is handled.
- Every console action that changes something is in the audit log; entries about money are visible only to the finance role.
- Only the finance role can refund, export orders or retry payouts, and the server checks that on every call.

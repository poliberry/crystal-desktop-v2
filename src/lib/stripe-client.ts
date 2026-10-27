import { loadStripe, type Appearance, type Stripe } from "@stripe/stripe-js";

/**
 * Stripe in the renderer.
 *
 * Only the *publishable* key lives here — it is meant to be public. The secret
 * key never leaves the Convex deployment, and card details go from Stripe's own
 * fields straight to Stripe: nothing typed into a card field passes through
 * Crystal's code or servers.
 */
const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";

/** Whether this build can take payments at all. */
export const paymentsConfigured = publishableKey.length > 0;

let stripe: Promise<Stripe | null> | null = null;

/** Loaded on first use, not at start-up: most sessions never open a payment form. */
export function getStripe(): Promise<Stripe | null> {
  if (!paymentsConfigured) return Promise.resolve(null);
  stripe ??= loadStripe(publishableKey);
  return stripe;
}

/** Stripe's fields, dressed to match whichever theme the app is in. */
export function stripeAppearance(): Appearance {
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  return {
    theme: dark ? "night" : "stripe",
    variables: {
      borderRadius: "8px",
      fontFamily: "inherit",
      colorPrimary: dark ? "#a5b4fc" : "#4f46e5",
    },
  };
}

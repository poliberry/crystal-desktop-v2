"use client";

import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Loader2 } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { getStripe, paymentsConfigured, stripeAppearance } from "@/lib/stripe-client";

/**
 * Saving a card without buying anything.
 *
 * Asks the server for a SetupIntent (which is tied to the signed-in user's own
 * Stripe customer) and hands Stripe's card fields the secret. The card goes to
 * Stripe directly.
 */
function Fields({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const checked = await elements.submit();
    if (checked.error) {
      setError(checked.error.message ?? "Check your card details.");
      setBusy(false);
      return;
    }
    const result = await stripe.confirmSetup({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });
    if (result.error) {
      setError(result.error.message ?? "That card couldn't be saved.");
      setBusy(false);
      return;
    }
    onDone();
  };

  return (
    <div className="space-y-4">
      <PaymentElement options={{ layout: "tabs" }} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={!stripe || busy}>
          {busy && <Loader2 className="animate-spin" />}
          Save payment method
        </Button>
      </div>
    </div>
  );
}

export function PaymentMethodForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const createSetupIntent = useAction(api.payments.createSetupIntent);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!paymentsConfigured) return;
    let cancelled = false;
    createSetupIntent({})
      .then((result) => !cancelled && setSecret(result.clientSecret))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't start that."));
    return () => {
      cancelled = true;
    };
  }, [createSetupIntent]);

  if (!paymentsConfigured) {
    return <p className="text-sm text-muted-foreground">Payments aren&apos;t set up in this build of Crystal.</p>;
  }
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!secret) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  return (
    <Elements stripe={getStripe()} options={{ clientSecret: secret, appearance: stripeAppearance() }}>
      <Fields onDone={onDone} onCancel={onCancel} />
    </Elements>
  );
}

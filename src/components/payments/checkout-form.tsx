"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Loader2, Lock } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { getStripe, stripeAppearance } from "@/lib/stripe-client";

export interface PendingPayment {
  orderId: Id<"orders">;
  clientSecret: string;
  amountCents: number;
  currency: string;
}

/**
 * Taking the payment for an order the server has already priced.
 *
 * "Paid" is never concluded here: after Stripe confirms, the server is asked to
 * look the payment up itself (`confirmOrder`), and only its answer unlocks the
 * item. A forged success in this component would unlock nothing.
 */
function Fields({
  payment,
  recurring,
  onPaid,
  onBack,
}: {
  payment: PendingPayment;
  recurring?: string;
  onPaid: () => void;
  onBack: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const confirmOrder = useAction(api.payments.confirmOrder);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const checked = await elements.submit();
    if (checked.error) {
      setError(checked.error.message ?? "Check your payment details.");
      setBusy(false);
      return;
    }
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });
    if (result.error) {
      setError(result.error.message ?? "The payment didn't go through.");
      setBusy(false);
      return;
    }
    try {
      const answer = await confirmOrder({ orderId: payment.orderId });
      if (answer.status === "paid") {
        onPaid();
        return;
      }
      // Stripe has the money but hasn't told us yet (a bank step, usually). The
      // webhook will unlock the item when it arrives.
      setError("Your payment is processing. The item will appear in your collection as soon as it clears.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't confirm that payment.");
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <PaymentElement options={{ layout: "tabs" }} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button onClick={() => void pay()} disabled={!stripe || busy} className="min-w-40">
          {busy ? <Loader2 className="animate-spin" /> : <Lock />}
          Pay {formatMoney(payment.amountCents, payment.currency)}
          {recurring ? ` / ${recurring}` : ""}
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Payments are handled by Stripe. Crystal never sees your card number.
      </p>
    </div>
  );
}

export function CheckoutForm(props: {
  payment: PendingPayment;
  recurring?: string;
  onPaid: () => void;
  onBack: () => void;
}) {
  return (
    <Elements
      stripe={getStripe()}
      options={{ clientSecret: props.payment.clientSecret, appearance: stripeAppearance() }}
    >
      <Fields {...props} />
    </Elements>
  );
}

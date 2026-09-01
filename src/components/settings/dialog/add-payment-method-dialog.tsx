"use client";

import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { Appearance, loadStripe } from "@stripe/stripe-js";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!,
);

const appearance: Appearance = {
  theme: "night",
  inputs: "spaced",
  labels: "floating",
};

function AnimatedDialogContent({ children }: { children: React.ReactNode }) {
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [height, setHeight] = React.useState<number | null>(null);

  React.useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    const updateHeight = () => {
      setHeight(element.scrollHeight);
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="overflow-hidden transition-[height] duration-300 ease-out"
      style={{
        height: height ?? "auto",
      }}
    >
      <div ref={contentRef}>{children}</div>
    </div>
  );
}

function PaymentMethodForm() {
  const stripe = useStripe();
  const elements = useElements();

  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!stripe || !elements) return;

    setLoading(true);

    const { error } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });

    setLoading(false);

    if (error) {
      console.error(error.message);
      return;
    }

    return toast.success("Payment method added", {
      description: "We have added this payment method to your account."
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 flex flex-col">
      <h1 className="font-semibold text-lg">Add Payment Method</h1>
      <PaymentElement />

      <Button
        variant="default"
        className="self-end"
        type="submit"
        disabled={!stripe || loading}
      >
        {loading ? "Saving..." : "Add payment method"}
      </Button>
    </form>
  );
}

export function AddPaymentMethodDialog({ open, onOpenChange }: any) {
  const createSetupIntent = useAction(api.stripe.createSetupIntent);

  const [clientSecret, setClientSecret] = useState<string | null>(null);

  useEffect(() => {
    createSetupIntent().then((result) => {
      if (result.clientSecret) setClientSecret(result.clientSecret);
    });
  }, [createSetupIntent]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <AnimatedDialogContent>
          {clientSecret ? (
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret,
                appearance,
              }}
            >
              <PaymentMethodForm />
            </Elements>
          ) : (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </AnimatedDialogContent>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAction } from "convex/react";
import Image from "next/image";
import { Dices, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import {
  CardBrandIcon,
  brandLabel,
  currencyName,
  formatMoney,
} from "./billing-shared";

type Subscription = {
  id: string;
  name: string;
  description: string | null;
  amount: number | null;
  currency: string | null;
  interval: string | null;
  status: string;
  billingStatus: string;
  cancelAtPeriodEnd: boolean;
  nextPaymentDate: number | null;
  paymentMethod: { brand: string; last4: string } | null;
  paymentMethodId: string | null;
};

type PaymentMethod = {
  id: string;
  brand: string | null;
  last4: string | null;
};

const HIDDEN_STATUSES = new Set([
  "canceled",
  "incomplete",
  "incomplete_expired",
]);

function Spinner() {
  return (
    <div className="flex items-center justify-center py-10 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

function formatDate(unix: number | null): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function capitalize(value: string | null): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function SubscriptionsTab() {
  const getSubscriptions = useAction(api.stripe.getSubscriptions);
  const getPaymentMethods = useAction(api.stripe.getPaymentMethods);
  const updateSubscriptionPaymentMethod = useAction(
    api.stripe.updateSubscriptionPaymentMethod,
  );
  const cancelSubscription = useAction(api.stripe.cancelSubscription);
  const resumeSubscription = useAction(api.stripe.resumeSubscription);

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [subs, pm] = await Promise.all([
      getSubscriptions(),
      getPaymentMethods(),
    ]);
    setSubscriptions(subs as Subscription[]);
    setPaymentMethods(pm.methods);
  }, [getSubscriptions, getPaymentMethods]);

  useEffect(() => {
    load()
      .catch(() => toast.error("Couldn't load your subscriptions."))
      .finally(() => setLoading(false));
  }, [load]);

  const active = useMemo(
    () => subscriptions.filter((s) => !HIDDEN_STATUSES.has(s.status)),
    [subscriptions],
  );
  const primary = active[0];

  async function handleCancel(id: string, cancel: boolean) {
    setBusy(true);
    try {
      if (cancel) {
        await cancelSubscription({ subscriptionId: id });
        toast.success("Subscription will cancel at the end of the period.");
      } else {
        await resumeSubscription({ subscriptionId: id });
        toast.success("Subscription resumed.");
      }
      await load();
    } catch {
      toast.error("Couldn't update the subscription.");
    } finally {
      setBusy(false);
    }
  }

  async function handleChangePaymentMethod(id: string, paymentMethodId: string) {
    setBusy(true);
    try {
      await updateSubscriptionPaymentMethod({
        subscriptionId: id,
        paymentMethodId,
      });
      await load();
      toast.success("Payment method updated.");
    } catch {
      toast.error("Couldn't update the payment method.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-8">
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Your Subscriptions</h2>
          <p className="text-sm text-muted-foreground">
            These are your current subscriptions. They will be billed on the same
            billing cycle. You can update any subscription at any time.
          </p>
        </div>

        {loading ? (
          <Spinner />
        ) : active.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            You don&apos;t have any active subscriptions.
          </div>
        ) : (
          active.map((sub) => (
            <div
              key={sub.id}
              className="relative overflow-hidden rounded-xl bg-linear-to-r from-indigo-500 via-purple-500 to-fuchsia-500 p-5 text-white shadow-md"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Image
                    src="/logo-mark.svg"
                    width={44}
                    height={44}
                    alt=""
                    className="drop-shadow-md"
                  />
                  <span className="text-2xl font-black uppercase tracking-tight">
                    {sub.name}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      handleCancel(sub.id, !sub.cancelAtPeriodEnd)
                    }
                    className="text-sm font-medium text-white/90 hover:text-white hover:underline disabled:opacity-60"
                  >
                    {sub.cancelAtPeriodEnd ? "Resume" : "Cancel"}
                  </button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-white text-black hover:bg-white/90"
                  >
                    Switch Plans
                  </Button>
                </div>
              </div>

              <p className="mt-3 text-sm text-white/90">
                {sub.description
                  ? `${sub.description} for `
                  : "You have premium access for "}
                <span className="font-semibold">
                  {formatMoney(sub.amount, sub.currency)} /{" "}
                  {capitalize(sub.interval)}
                </span>
              </p>

              {sub.cancelAtPeriodEnd && (
                <p className="mt-1 text-xs text-white/80">
                  Cancels on {formatDate(sub.nextPaymentDate)}
                </p>
              )}
            </div>
          ))
        )}
      </section>

      {!loading && primary && (
        <section className="space-y-4">
          <h3 className="text-base font-semibold">Payment</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border bg-card p-4">
              <h4 className="text-sm font-semibold">Billing Information</h4>
              <p className="mt-2 text-sm text-muted-foreground">
                Your subscriptions will automatically renew on{" "}
                <span className="font-medium text-foreground">
                  {formatDate(primary.nextPaymentDate)}
                </span>{" "}
                and you&apos;ll be charged{" "}
                <span className="font-medium text-foreground">
                  {formatMoney(primary.amount, primary.currency)}
                </span>
                .
              </p>
            </div>

            <div className="space-y-4 rounded-xl border bg-card p-4">
              <div className="space-y-1.5">
                <h4 className="text-sm font-semibold">Payment method</h4>
                <Select
                  value={primary.paymentMethodId ?? undefined}
                  disabled={busy || paymentMethods.length === 0}
                  onValueChange={(value) =>
                    handleChangePaymentMethod(primary.id, value)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a card" />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentMethods.map((pm) => (
                      <SelectItem key={pm.id} value={pm.id}>
                        <CardBrandIcon brand={pm.brand} className="size-4" />
                        {brandLabel(pm.brand)} ending in {pm.last4}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <h4 className="text-sm font-semibold">Paying in</h4>
                <Select value={primary.currency ?? undefined} disabled>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {primary.currency && (
                      <SelectItem value={primary.currency}>
                        {primary.currency.toUpperCase()} —{" "}
                        {currencyName(primary.currency)}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </section>
      )}

      <Toaster position="bottom-center" />
    </div>
  );
}

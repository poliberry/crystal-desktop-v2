"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { toast } from "sonner";
import { CalendarClock, Check, Gem, Loader2, RotateCcw } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { cardSummary } from "@/components/payments/card-brand";
import { planPerks } from "@/components/marketplace/sku-dialog";
import type { ShopSku } from "@/components/marketplace/sku-kinds";
import { useOpenMarketplace } from "@/components/pages/page-context";
import { SettingRow, SettingsCard, SettingsGroup } from "@/components/settings/settings-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatMoney } from "@/lib/money";
import { paymentsConfigured } from "@/lib/stripe-client";

type Subscription = Awaited<ReturnType<ReturnType<typeof useAction<typeof api.payments.listSubscriptions>>>>[number];

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Payment failed",
  unpaid: "Unpaid",
  incomplete: "Waiting for payment",
};

function SubscriptionCard({
  sub,
  busy,
  onCancel,
  onResume,
}: {
  sub: Subscription;
  busy: boolean;
  onCancel: () => void;
  onResume: () => void;
}) {
  const perCycle = sub.interval === "year" ? "year" : "month";
  const trouble = sub.status === "past_due" || sub.status === "unpaid";
  return (
    <SettingsCard className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-sky-400 text-white">
            <Gem className="size-5" />
          </div>
          <div>
            <p className="font-semibold">{sub.name}</p>
            <p className="text-sm text-muted-foreground">
              {formatMoney(sub.amountCents, sub.currency)} / {perCycle}
            </p>
          </div>
        </div>
        <Badge variant={trouble ? "destructive" : sub.cancelAtPeriodEnd ? "outline" : "secondary"}>
          {sub.cancelAtPeriodEnd ? "Ending" : (STATUS_LABEL[sub.status] ?? sub.status)}
        </Badge>
      </div>

      <div className="space-y-1.5 text-sm">
        {sub.currentPeriodEnd && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <CalendarClock className="size-4" />
            {sub.cancelAtPeriodEnd
              ? `Ends on ${formatDate(sub.currentPeriodEnd)}. You keep everything until then.`
              : `Renews on ${formatDate(sub.currentPeriodEnd)}.`}
          </p>
        )}
        {sub.card && <p className="pl-6 text-muted-foreground">Paid with {cardSummary(sub.card)}</p>}
        {trouble && (
          <p className="rounded-lg bg-destructive/10 p-2 text-destructive">
            The last payment failed. Update your card in Billing so your plan doesn&apos;t lapse.
          </p>
        )}
      </div>

      <div className="flex justify-end">
        {sub.cancelAtPeriodEnd ? (
          <Button variant="outline" disabled={busy} onClick={onResume}>
            {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} Keep my subscription
          </Button>
        ) : (
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Cancel subscription
          </Button>
        )}
      </div>
    </SettingsCard>
  );
}

export function SubscriptionsTab() {
  const list = useAction(api.payments.listSubscriptions);
  const cancel = useAction(api.payments.cancelSubscription);
  const resume = useAction(api.payments.resumeSubscription);
  const plan = useQuery(api.marketplace.myPlan);
  const catalog = useQuery(api.catalog.list, {}) as ShopSku[] | undefined;
  const openShop = useOpenMarketplace();

  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [confirming, setConfirming] = useState<Subscription | null>(null);
  const [busy, setBusy] = useState<Id<"orders"> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSubs(await list({}));
    } catch (e) {
      setSubs([]);
      toast.error(errorMessage(e, "Couldn't load your subscriptions."));
    }
  }, [list]);

  useEffect(() => {
    if (paymentsConfigured) void refresh();
    else setSubs([]);
  }, [refresh]);

  const act = async (orderId: Id<"orders">, work: () => Promise<unknown>, done: string) => {
    setBusy(orderId);
    try {
      await work();
      toast.success(done);
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const plans = (catalog ?? []).filter((s) => s.type === "subscription");
  const perks = plan
    ? planPerks(JSON.stringify(plan))
    : [];

  return (
    <div className="space-y-8">
      <SettingsGroup title="Your subscriptions">
        {subs === null ? (
          <SettingsCard className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </SettingsCard>
        ) : subs.length === 0 ? (
          <SettingsCard className="px-4 py-5 text-sm text-muted-foreground">
            You&apos;re not subscribed to anything.
          </SettingsCard>
        ) : (
          subs.map((sub) => (
            <SubscriptionCard
              key={sub.orderId}
              sub={sub}
              busy={busy === sub.orderId}
              onCancel={() => setConfirming(sub)}
              onResume={() => void act(sub.orderId, () => resume({ orderId: sub.orderId }), "Your subscription will keep renewing.")}
            />
          ))
        )}
      </SettingsGroup>

      {perks.length > 0 && (
        <SettingsGroup title="What your plan gives you">
          <SettingsCard className="space-y-1.5 p-4">
            {perks.map((perk) => (
              <p key={perk} className="flex items-center gap-2 text-sm">
                <Check className="size-4 text-emerald-500" /> {perk}
              </p>
            ))}
          </SettingsCard>
        </SettingsGroup>
      )}

      {subs !== null && subs.length === 0 && plans.length > 0 && (
        <SettingsGroup title="Crystal plans">
          {plans.map((p) => (
            <SettingRow
              key={p.id}
              icon={Gem}
              title={`${p.name} — ${formatMoney(p.priceCents, p.currency)}/${p.interval === "year" ? "yr" : "mo"}`}
              description={p.grants.flatMap((g) => (g.kind === "plan" ? planPerks(g.payload) : [])).slice(0, 3).join(" · ")}
            >
              <Button size="sm" onClick={() => openShop("plans")}>
                View
              </Button>
            </SettingRow>
          ))}
        </SettingsGroup>
      )}

      <Dialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {confirming?.name}?</DialogTitle>
            <DialogDescription>
              {confirming?.currentPeriodEnd
                ? `You'll keep your plan until ${formatDate(confirming.currentPeriodEnd)}, and you won't be charged again. You can change your mind before then.`
                : "You won't be charged again."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const sub = confirming;
                setConfirming(null);
                if (sub) void act(sub.orderId, () => cancel({ orderId: sub.orderId }), "Cancelled. It runs until the end of the period.");
              }}
            >
              Cancel subscription
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

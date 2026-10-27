"use client";

import { openStudio } from "@/studio/open-studio";
import { useCallback, useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, Loader2, Palette, RefreshCw, Wallet } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import { useOpenMarketplace } from "@/components/pages/page-context";
import { SettingRow, SettingsCard, SettingsGroup } from "@/components/settings/settings-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatMoney } from "@/lib/money";
import { paymentsConfigured } from "@/lib/stripe-client";

const EARNING_LABEL: Record<string, string> = {
  transferred: "Paid",
  held: "Waiting for payouts",
  pending: "Retrying",
  refunded: "Refunded",
};

/**
 * Selling on Crystal: getting paid, and what has been earned.
 *
 * Creating things lives in the shop (My creations); this is the money side, so it
 * sits with the rest of the account's billing. Whether payouts work is Stripe's
 * answer — this page asks for it again whenever it is looked at, and never
 * records a creator's own say-so.
 */
export function CreatorTab() {
  const account = useQuery(api.creatorsDb.myAccount);
  const earnings = useQuery(api.creatorsDb.myEarnings);
  const start = useAction(api.creators.startOnboarding);
  const refresh = useAction(api.creators.refreshAccount);
  const dashboard = useAction(api.creators.dashboardLink);
  const openShop = useOpenMarketplace();
  const [busy, setBusy] = useState<"start" | "refresh" | "dashboard" | null>(null);

  const sync = useCallback(
    async (quiet: boolean) => {
      setBusy("refresh");
      try {
        const result = await refresh({});
        if (!quiet) toast.success(result.payoutsEnabled ? "Payouts are on." : "Stripe still needs a few details.");
      } catch (e) {
        if (!quiet) toast.error(errorMessage(e));
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  // Coming back from Stripe's page: look again as soon as the window is focused.
  useEffect(() => {
    if (!account?.connected || account.payoutsEnabled) return;
    const onFocus = () => void sync(true);
    window.addEventListener("focus", onFocus);
    void sync(true);
    return () => window.removeEventListener("focus", onFocus);
  }, [account?.connected, account?.payoutsEnabled, sync]);

  const open = async (kind: "start" | "dashboard") => {
    setBusy(kind);
    try {
      const { url } = await (kind === "start" ? start({}) : dashboard({}));
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const ready = account?.connected && account.payoutsEnabled;

  return (
    <div className="space-y-8">
      <SettingsGroup title="Payouts">
        {account == null ? null : !paymentsConfigured ? (
          <SettingsCard className="px-4 py-5 text-sm text-muted-foreground">
            Payments aren&apos;t set up in this build of Crystal.
          </SettingsCard>
        ) : ready ? (
          <SettingRow
            icon={CheckCircle2}
            title="Payouts are on"
            description="Your share of each sale is sent to your Stripe account automatically."
          >
            <Button size="sm" variant="outline" disabled={busy === "dashboard"} onClick={() => void open("dashboard")}>
              {busy === "dashboard" ? <Loader2 className="animate-spin" /> : <ExternalLink />} Stripe dashboard
            </Button>
          </SettingRow>
        ) : account.connected ? (
          <SettingRow
            icon={Wallet}
            title="Finish setting up payouts"
            description="Stripe needs a few more details before it can pay you. Anything you've earned is held safely until then."
          >
            <Button size="sm" variant="ghost" disabled={busy === "refresh"} onClick={() => void sync(false)}>
              {busy === "refresh" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Check
            </Button>
            <Button size="sm" disabled={busy === "start"} onClick={() => void open("start")}>
              {busy === "start" && <Loader2 className="animate-spin" />} Continue
            </Button>
          </SettingRow>
        ) : (
          <SettingRow
            icon={Wallet}
            title="Get paid for what you make"
            description="Connect a bank account through Stripe to sell paid items — you keep 80% of each sale unless agreed otherwise. Free items need no payout account."
          >
            <Button size="sm" disabled={busy === "start"} onClick={() => void open("start")}>
              {busy === "start" && <Loader2 className="animate-spin" />} Set up payouts
            </Button>
          </SettingRow>
        )}
      </SettingsGroup>

      <SettingsGroup title="Earnings">
        {earnings && earnings.totals.length > 0 ? (
          <div className="grid gap-1.5 sm:grid-cols-3">
            {earnings.totals.map((t) => (
              <SettingsCard key={t.currency} className="space-y-3 p-4">
                <p className="text-xs font-medium text-muted-foreground uppercase">{t.currency}</p>
                <div>
                  <p className="text-2xl font-semibold">{formatMoney(t.paid, t.currency, { free: false })}</p>
                  <p className="text-xs text-muted-foreground">paid out</p>
                </div>
                {t.waiting > 0 && (
                  <p className="text-xs text-amber-500">
                    {formatMoney(t.waiting, t.currency, { free: false })} waiting for payouts
                  </p>
                )}
              </SettingsCard>
            ))}
          </div>
        ) : (
          <SettingsCard className="px-4 py-5 text-sm text-muted-foreground">
            Nothing earned yet. When something you made sells, it shows up here.
          </SettingsCard>
        )}

        {earnings?.recent.map((row) => (
          <SettingsCard key={row.id} className="flex items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{row.skuName}</p>
              <p className="text-xs text-muted-foreground">{formatDate(row.createdAt)}</p>
            </div>
            <Badge variant={row.status === "pending" ? "destructive" : "outline"}>
              {EARNING_LABEL[row.status] ?? row.status}
            </Badge>
            <span className="w-20 text-right text-sm font-medium tabular-nums">
              {formatMoney(row.creatorCents, row.currency, { free: false })}
            </span>
          </SettingsCard>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Create">
        <SettingRow
          icon={Palette}
          title="Make something to sell"
          description="Decorations, stickers, effects, nameplates, lounge scenes and theme packs — free or paid."
        >
          <Button size="sm" variant="outline" onClick={() => openShop("creations")}>
            My creations
          </Button>
          <Button size="sm" onClick={openStudio}>
            Open Crystal Studio
          </Button>
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}

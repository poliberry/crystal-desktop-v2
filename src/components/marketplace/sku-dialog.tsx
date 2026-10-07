"use client";

import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Check, CreditCard, Gem, Loader2, PartyPopper, ShieldCheck, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CheckoutForm, type PendingPayment } from "@/components/payments/checkout-form";
import { GRANT_KIND_META, primaryKind, type GrantKind, type ShopSku } from "@/components/marketplace/sku-kinds";
import { PriceTag } from "@/components/marketplace/sku-card";
import { SkuPreview } from "@/components/marketplace/sku-preview";
import { priceFor, useShop } from "@/components/marketplace/use-shop";
import { useOpenSettings } from "@/components/pages/page-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { paymentsConfigured } from "@/lib/stripe-client";

/** Kinds that are put on, as opposed to simply being in force while owned. */
const WEARABLE: GrantKind[] = ["avatarDecoration", "profileSticker", "profileEffect", "nameplate"];

type Step = { name: "details" } | { name: "payment"; payment: PendingPayment } | { name: "done"; free: boolean };

/**
 * One item in full: a large preview on you, what it is, and the way to buy it.
 *
 * Buying happens in this dialog and stays in it — details, then card, then a
 * "you've got it" screen with the option to put it on right away. The price shown
 * is what the server will charge (it computes it again from the item's row);
 * nothing here sets one.
 */
export function SkuDialog({ sku, onClose }: { sku: ShopSku | null; onClose: () => void }) {
  return (
    <Dialog open={!!sku} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-4xl"
        showCloseButton
        aria-describedby={undefined}
      >
        {sku && <Body key={sku.id} sku={sku} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({ sku, onClose }: { sku: ShopSku; onClose: () => void }) {
  const { owns, entitlements, discountBps, plan } = useShop();
  const startPurchase = useAction(api.payments.startPurchase);
  const equip = useMutation(api.marketplace.equip);
  const communities = useQuery(api.communities.listMine);
  const openSettings = useOpenSettings();

  const [step, setStep] = useState<Step>({ name: "details" });
  const [communityId, setCommunityId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kind = primaryKind(sku);
  const isCommunity = sku.type === "community";
  const isSubscription = sku.type === "subscription";
  const price = priceFor(sku, discountBps);
  const recurring = sku.interval === "month" ? "month" : sku.interval === "year" ? "year" : undefined;

  // Community items are owned per community, so "owned" depends on the pick.
  const owned = useMemo(() => {
    if (!owns(sku.id)) return false;
    if (!isCommunity) return true;
    return entitlements.some((e) => e.skuId === sku.id && e.communityId === communityId);
  }, [owns, sku.id, isCommunity, entitlements, communityId]);

  const mine = entitlements.filter((e) => e.skuId === sku.id);
  const sortedCommunities = useMemo(
    () => [...(communities ?? [])].sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name)),
    [communities],
  );

  const begin = async () => {
    setError(null);
    if (isCommunity && !communityId) {
      setError("Pick which community this is for.");
      return;
    }
    if (price > 0 && !paymentsConfigured) {
      setError("Payments aren't set up in this build of Crystal yet.");
      return;
    }
    setBusy(true);
    try {
      const result = await startPurchase({
        skuId: sku.id,
        communityId: isCommunity ? (communityId as Id<"communities">) : undefined,
      });
      if (result.kind === "free") setStep({ name: "done", free: true });
      else setStep({ name: "payment", payment: result });
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "") : "That purchase couldn't be started.");
    } finally {
      setBusy(false);
    }
  };

  const wear = async (entitlementId: Id<"entitlements">) => {
    try {
      await equip({ entitlementId });
      toast.success("Equipped. It's on your profile now.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "") : "Couldn't equip that.");
    }
  };

  const wearable = mine.filter((e) => WEARABLE.includes(e.kind as GrantKind) || e.kind === "communityTheme");

  return (
    <div className="grid max-h-[92vh] md:grid-cols-[1.15fr_1fr]">
      <SkuPreview grants={sku.grants} size="lg" className="min-h-72 md:min-h-[30rem]" />

      <div className="flex min-h-0 flex-col overflow-y-auto p-6">
        {step.name === "details" && (
          <>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {sku.type === "bundle" ? "Bundle" : GRANT_KIND_META[kind].label}
            </p>
            <DialogTitle className="mt-1 text-2xl leading-tight">{sku.name}</DialogTitle>
            {sku.creator && (
              <p className="mt-1 text-sm text-muted-foreground">
                Created by <span className="font-medium text-foreground">@{sku.creator.username}</span>
              </p>
            )}
            <DialogDescription className="mt-3">
              {sku.description ?? GRANT_KIND_META[kind].blurb}
            </DialogDescription>

            {sku.grants.length > 1 || kind === "plan" ? <Includes sku={sku} /> : null}

            {isCommunity && (
              <div className="mt-5 space-y-1.5">
                <label className="text-sm font-medium">For which community?</label>
                <Select value={communityId} onValueChange={setCommunityId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a community" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedCommunities.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">You need to be able to manage the community.</p>
              </div>
            )}

            <div className="mt-auto space-y-3 pt-6">
              {discountBps > 0 && !owned && priceFor(sku, discountBps) !== sku.priceCents && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-500">
                  <Gem className="size-3.5" />
                  {plan?.plan ? "Your Crystal plan" : "Your plan"} saves you {discountBps / 100}% on this.
                </p>
              )}

              {owned ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-500">
                    <Check className="size-4" /> {isSubscription ? "You're subscribed" : "In your collection"}
                  </div>
                  {wearable.map((e) => (
                    <Button key={e.id} className="w-full" onClick={() => void wear(e.id)}>
                      <Wand2 />
                      {e.kind === "communityTheme"
                        ? `Apply theme${e.communityName ? ` to ${e.communityName}` : ""}`
                        : `Equip ${e.label ?? GRANT_KIND_META[e.kind as GrantKind]?.label.toLowerCase() ?? "item"}`}
                    </Button>
                  ))}
                  {isSubscription && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        onClose();
                        openSettings("subscriptions");
                      }}
                    >
                      Manage subscription
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex items-end justify-between">
                    <PriceTag sku={sku} discountBps={discountBps} className="text-2xl" />
                    {isSubscription && (
                      <span className="text-xs text-muted-foreground">Renews every {recurring}. Cancel any time.</span>
                    )}
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <Button size="lg" className="w-full" disabled={busy} onClick={() => void begin()}>
                    {busy ? <Loader2 className="animate-spin" /> : <CreditCard />}
                    {price === 0 ? "Get it free" : isSubscription ? "Subscribe" : "Buy now"}
                  </Button>
                  {price > 0 && (
                    <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                      <ShieldCheck className="size-3.5" /> Secure checkout with Stripe
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {step.name === "payment" && (
          <>
            <DialogTitle className="text-xl">Checkout</DialogTitle>
            <DialogDescription className="mt-1">
              {sku.name} · <PriceTag sku={{ ...sku, priceCents: step.payment.amountCents }} />
            </DialogDescription>
            <div className="mt-5">
              <CheckoutForm
                payment={step.payment}
                recurring={recurring}
                onBack={() => setStep({ name: "details" })}
                onPaid={() => setStep({ name: "done", free: false })}
              />
            </div>
          </>
        )}

        {step.name === "done" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
              <PartyPopper className="size-7" />
            </div>
            <DialogTitle className="text-xl">{step.free ? "It's yours" : "Thank you!"}</DialogTitle>
            <DialogDescription>
              {sku.name} is in your collection{wearable.length ? ". Put it on now?" : "."}
            </DialogDescription>
            <div className="mt-2 w-full space-y-2">
              {wearable.map((e) => (
                <Button key={e.id} className="w-full" onClick={() => void wear(e.id)}>
                  <Wand2 /> Equip now
                </Button>
              ))}
              <Button variant={wearable.length ? "ghost" : "default"} className="w-full" onClick={onClose}>
                {wearable.length ? "Maybe later" : "Done"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** What a bundle or a plan gives, piece by piece. */
function Includes({ sku }: { sku: ShopSku }) {
  const lines = sku.grants.flatMap((grant) => {
    if (grant.kind === "plan") return planPerks(grant.payload);
    return [grant.label ?? GRANT_KIND_META[grant.kind]?.label ?? "Item"];
  });
  if (lines.length === 0) return null;
  return (
    <ul className="mt-4 space-y-1.5">
      {lines.map((line, i) => (
        <li key={`${line}-${i}`} className="flex items-start gap-2 text-sm">
          <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
          {line}
        </li>
      ))}
    </ul>
  );
}

/** A plan's payload, in words. */
export function planPerks(payload: string | undefined): string[] {
  try {
    const p = JSON.parse(payload ?? "") as {
      cosmeticDiscountBps?: number;
      streamResolution?: string;
      streamFrameRate?: number;
      profileEffects?: boolean;
      earlyAccess?: boolean;
      monthlyBadge?: boolean;
    };
    return [
      p.cosmeticDiscountBps ? `${p.cosmeticDiscountBps / 100}% off cosmetics in the shop` : null,
      p.streamResolution ? `Stream up to ${p.streamResolution}${p.streamFrameRate ? ` at ${p.streamFrameRate}fps` : ""}` : null,
      p.profileEffects ? "Premium profile effects" : null,
      p.earlyAccess ? "Early access to new drops" : null,
      p.monthlyBadge ? "A rotating monthly badge" : null,
    ].filter((line): line is string => !!line);
  } catch {
    return [];
  }
}

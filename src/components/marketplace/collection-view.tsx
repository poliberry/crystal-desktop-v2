"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Gem, Loader2, Package, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { GRANT_KIND_META, type GrantKind } from "@/components/marketplace/sku-kinds";
import { SkuPreview } from "@/components/marketplace/sku-preview";
import { useShop } from "@/components/marketplace/use-shop";
import { useOpenSettings } from "@/components/pages/page-context";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/money";

const WEARABLE: string[] = ["avatarDecoration", "profileSticker", "profileEffect", "nameplate", "communityTheme", "themePack"];

/** Everything you own, with a button to put it on. */
export function CollectionView() {
  const { entitlements, loading } = useShop();
  const equip = useMutation(api.marketplace.equip);
  const unequipPack = useMutation(api.marketplace.unequipThemePack);
  const activePack = useQuery(api.marketplace.activeThemePack);
  const openSettings = useOpenSettings();
  const [busy, setBusy] = useState<Id<"entitlements"> | null>(null);

  const wear = async (id: Id<"entitlements">) => {
    setBusy(id);
    try {
      await equip({ entitlementId: id });
      toast.success("Equipped.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "") : "Couldn't equip that.");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return null;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-3xl font-bold tracking-tight">My collection</h2>
        <p className="mt-1 text-sm text-muted-foreground">Everything you own. Equip a piece to wear it.</p>
      </header>

      {entitlements.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-24 text-center text-muted-foreground">
          <Package className="size-10" />
          <p className="text-sm">You don&apos;t own anything yet. Find something you like in the shop.</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
          {entitlements.map((item) => {
            const meta = GRANT_KIND_META[item.kind as GrantKind];
            const canWear = WEARABLE.includes(item.kind);
            return (
              <div
                key={item.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-card/60 backdrop-blur-xl"
              >
                <SkuPreview
                  grants={[{ kind: item.kind, payload: item.payload, label: item.label }]}
                  size="md"
                  className="aspect-[4/3.4] w-full"
                />
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <p className="truncate text-sm font-semibold">{item.skuName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {meta?.label ?? item.kind}
                    {item.communityName ? ` · ${item.communityName}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.source === "staff" ? "Gift from Crystal · " : ""}
                    {item.expiresAt ? `Until ${formatDate(item.expiresAt)}` : formatDate(item.createdAt)}
                  </p>
                  <div className="mt-2">
                    {item.kind === "themePack" && activePack?.entitlementId === item.id ? (
                      <Button size="sm" variant="outline" className="w-full" onClick={() => void unequipPack({})}>
                        <Check /> Applied — remove
                      </Button>
                    ) : canWear ? (
                      <Button size="sm" className="w-full" disabled={busy === item.id} onClick={() => void wear(item.id)}>
                        {busy === item.id ? <Loader2 className="animate-spin" /> : <Wand2 />}
                        {item.kind === "communityTheme" || item.kind === "themePack" ? "Apply" : "Equip"}
                      </Button>
                    ) : item.kind === "loungeScene" ? (
                      <span className="text-xs text-muted-foreground">Pick it in a lounge channel&apos;s settings.</span>
                    ) : item.kind === "plan" ? (
                      <Button size="sm" variant="outline" className="w-full" onClick={() => openSettings("subscriptions")}>
                        <Gem /> Manage
                      </Button>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-emerald-500">
                        <Check className="size-3.5" /> Active
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

"use client";

import { openStudio } from "@/studio/open-studio";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Palette, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CreationDialog } from "@/components/marketplace/creation-dialog";
import { GRANT_KIND_META, type GrantKind } from "@/components/marketplace/sku-kinds";
import { SkuPreview } from "@/components/marketplace/sku-preview";
import { useOpenSettings } from "@/components/pages/page-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/money";

type Creation = NonNullable<ReturnType<typeof useCreations>>[number];

function useCreations() {
  return useQuery(api.marketplace.myCreations);
}

function StatusBadge({ creation }: { creation: Creation }) {
  if (creation.status === "pending") return <Badge variant="outline">In review</Badge>;
  if (creation.status === "rejected") return <Badge variant="destructive">Needs changes</Badge>;
  if (creation.sku?.status === "active") return <Badge className="bg-emerald-500/90 text-white">Live</Badge>;
  return <Badge variant="secondary">Retired</Badge>;
}

/** What you have made, what is waiting for review and how it is selling. */
export function CreationsView() {
  const creations = useCreations();
  const account = useQuery(api.creatorsDb.myAccount);
  const withdraw = useMutation(api.marketplace.withdrawSubmission);
  const retire = useMutation(api.marketplace.retireCreation);
  const openSettings = useOpenSettings();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (id: string, action: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try {
      await action();
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "") : "That didn't work.");
    } finally {
      setBusy(null);
    }
  };

  const payoutsReady = account?.connected && account.payoutsEnabled;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">My creations</h2>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">
            Make decorations, stickers, effects, nameplates, lounge scenes and theme packs, and sell them in the shop — or give them away free. Crystal Studio is the full workspace; a quick creation is for one picture.
            You keep 80% of every sale unless staff agree something different when approving it.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={openStudio}>
            <Palette /> Open Crystal Studio
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus /> Quick creation
          </Button>
        </div>
      </header>

      {account !== undefined && !payoutsReady && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <Wallet className="mt-0.5 size-5 shrink-0 text-amber-500" />
            <div>
              <p className="text-sm font-medium">Set up payouts to get paid</p>
              <p className="text-xs text-muted-foreground">
                You can submit creations now. Earnings are held safely until payouts are set up, then sent.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => openSettings("creator")}>
            Set up payouts
          </Button>
        </div>
      )}

      {creations == null ? null : creations.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
          <Palette className="size-10" />
          <p className="text-sm">You haven&apos;t made anything yet.</p>
          <Button variant="outline" onClick={() => setCreating(true)}>
            <Plus /> Make your first creation
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
          {creations.map((c) => (
            <div key={c.id} className="flex flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-card/60 backdrop-blur-xl">
              <SkuPreview
                grants={[{ kind: c.kind, payload: c.payload, label: c.name }]}
                size="md"
                className="aspect-[4/3.2] w-full"
              />
              <div className="flex flex-1 flex-col gap-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{c.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {GRANT_KIND_META[c.kind as GrantKind]?.label ?? c.kind} · {formatMoney(c.priceCents, c.currency)}
                    </p>
                  </div>
                  <StatusBadge creation={c} />
                </div>
                {c.status === "rejected" && c.reviewNote && (
                  <p className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive">{c.reviewNote}</p>
                )}
                {c.sku && (
                  <p className="text-xs text-muted-foreground">
                    {c.sku.sales} sold · you keep {c.sku.shareBps / 100}%
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Submitted {formatDate(c.createdAt)}</p>
                <div className="mt-auto flex gap-2 pt-1">
                  {c.status === "pending" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      disabled={busy === c.id}
                      onClick={() => void run(c.id, () => withdraw({ submissionId: c.id }), "Withdrawn.")}
                    >
                      {busy === c.id && <Loader2 className="animate-spin" />} Withdraw
                    </Button>
                  )}
                  {c.sku?.status === "active" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      disabled={busy === c.id}
                      onClick={() =>
                        void run(c.id, () => retire({ skuId: c.sku!.id as Id<"skus"> }), "Taken off sale. People who own it keep it.")
                      }
                    >
                      {busy === c.id && <Loader2 className="animate-spin" />} Stop selling
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreationDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

"use client";

import { useQuery } from "convex/react";
import { Check, Clock, ExternalLink, Loader2, X } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { GRANT_KIND_META, type GrantKind } from "@/components/marketplace/sku-kinds";
import { cn } from "@/lib/utils";

const STATUS = {
  pending: { label: "In review", icon: Clock, tone: "bg-amber-500/15 text-amber-500" },
  approved: { label: "Approved", icon: Check, tone: "bg-emerald-500/15 text-emerald-500" },
  rejected: { label: "Turned down", icon: X, tone: "bg-red-500/15 text-red-400" },
} as const;

/** What has been sent, and what came of it — the other end of Submit. */
export function SubmissionsView() {
  const creations = useQuery(api.marketplace.myCreations);
  if (creations === undefined) return <Loader2 className="mx-auto my-16 size-5 animate-spin text-muted-foreground" />;
  if (!creations || creations.length === 0) {
    return <p className="mx-auto max-w-sm p-10 text-center text-sm text-muted-foreground">Nothing submitted yet. Open a project, check the Submit panel, and send it for review.</p>;
  }
  return (
    <div className="mx-auto max-w-3xl space-y-2 p-6">
      <h2 className="pb-2 text-sm font-semibold">Your submissions</h2>
      {creations.map((c) => {
        const s = STATUS[c.status];
        const meta = GRANT_KIND_META[c.kind as GrantKind];
        return (
          <div key={c.id} className="flex items-start gap-3 rounded-xl border border-border p-3">
            {c.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.previewUrl} alt="" className="size-14 shrink-0 rounded-lg bg-card object-cover" />
            ) : (
              <span className="size-14 shrink-0 rounded-lg bg-card" />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate text-sm font-medium">
                {c.name}
                {c.updatesSkuId && <span className="ml-2 rounded bg-sky-500/15 px-1.5 py-0.5 align-middle text-[10px] font-medium text-sky-400">Update</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {meta?.label ?? c.kind} · {c.priceCents === 0 ? "Free" : `$${(c.priceCents / 100).toFixed(2)}`}
                {c.sku && ` · ${c.sku.sales} sold`}
              </p>
              {c.updatesSkuId && c.status === "pending" && <p className="text-xs text-muted-foreground">The store page is unchanged until this is approved.</p>}
              {c.updatesSkuId && c.status === "rejected" && <p className="text-xs text-muted-foreground">The store page is unchanged.</p>}
              {c.reviewNote && <p className="text-xs">{c.reviewNote}</p>}
            </div>
            <Badge variant="secondary" className={cn("shrink-0 gap-1", s.tone)}>
              <s.icon className="size-3" /> {s.label}
            </Badge>
          </div>
        );
      })}
      <p className="flex items-center gap-1 pt-2 text-xs text-muted-foreground">
        <ExternalLink className="size-3" /> Payouts and earnings are in Crystal → Settings → Creator.
      </p>
    </div>
  );
}

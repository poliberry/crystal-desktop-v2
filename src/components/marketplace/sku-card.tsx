"use client";

import { motion } from "framer-motion";
import { Check, Sparkles } from "lucide-react";

import { SkuPreview } from "@/components/marketplace/sku-preview";
import { GRANT_KIND_META, primaryKind, type ShopSku } from "@/components/marketplace/sku-kinds";
import { priceFor } from "@/components/marketplace/use-shop";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** `$4.99`, `$4.99/mo`, `Free`. */
export function PriceTag({
  sku,
  discountBps = 0,
  className,
}: {
  sku: Pick<ShopSku, "priceCents" | "currency" | "type" | "interval">;
  discountBps?: number;
  className?: string;
}) {
  const price = priceFor(sku, discountBps);
  const suffix = sku.interval ? (sku.interval === "month" ? "/mo" : "/yr") : "";
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 font-semibold", className)}>
      {price !== sku.priceCents && (
        <span className="text-xs font-normal text-muted-foreground line-through">
          {formatMoney(sku.priceCents, sku.currency)}
        </span>
      )}
      <span>
        {formatMoney(price, sku.currency)}
        {price > 0 && suffix && <span className="text-xs font-normal text-muted-foreground">{suffix}</span>}
      </span>
    </span>
  );
}

/**
 * One item in the shop: the item on your own avatar or profile, its name, and
 * what it costs. Cards are as big as the grid lets them be — the picture is
 * the point.
 */
export function SkuCard({
  sku,
  owned,
  discountBps,
  onOpen,
  className,
}: {
  sku: ShopSku;
  owned: boolean;
  discountBps: number;
  onOpen: (sku: ShopSku) => void;
  className?: string;
}) {
  const kind = GRANT_KIND_META[primaryKind(sku)];
  return (
    <motion.button
      type="button"
      onClick={() => onOpen(sku)}
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border border-foreground/10 bg-card/60 text-left shadow-sm backdrop-blur-xl transition-shadow hover:shadow-lg hover:shadow-black/20 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
        className,
      )}
    >
      <SkuPreview grants={sku.grants} size="md" className="aspect-[4/3.4] w-full" />

      <div className="absolute top-2 left-2 flex gap-1.5">
        {sku.featured && (
          <Badge className="gap-1 bg-primary/90 text-primary-foreground backdrop-blur">
            <Sparkles className="size-3" /> Featured
          </Badge>
        )}
      </div>
      {owned && (
        <div className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
          <Check className="size-3.5" />
        </div>
      )}

      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="truncate text-sm font-semibold">{sku.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {sku.creator ? `by @${sku.creator.username}` : kind.label}
        </p>
        <div className="mt-1 text-sm">
          {owned ? (
            <span className="text-xs font-medium text-emerald-500">Owned</span>
          ) : (
            <PriceTag sku={sku} discountBps={discountBps} />
          )}
        </div>
      </div>
    </motion.button>
  );
}

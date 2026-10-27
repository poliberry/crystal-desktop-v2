"use client";

import { motion } from "framer-motion";
import { Check, Palette, Sparkles, Type } from "lucide-react";

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

function themePackDetails(payload?: string): { family?: string; colors: [string, string][] } | null {
  try {
    const spec = JSON.parse(payload ?? "") as {
      font?: { family?: string };
      theme?: { colors?: Record<string, string> };
    };
    const colors = Object.entries(spec.theme?.colors ?? {}).filter(([, value]) => typeof value === "string").slice(0, 5) as [string, string][];
    if (!spec.font?.family && colors.length === 0) return null;
    return { family: spec.font?.family, colors };
  } catch {
    return null;
  }
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

      <div className="pointer-events-none absolute top-2 left-2 z-20 flex gap-1.5">
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
          {sku.byCrystal ? "By Crystal" : sku.creator ? `by @${sku.creator.username}` : kind.label}
        </p>
        {primaryKind(sku) === "themePack" && (() => {
          const details = themePackDetails(sku.grants.find((grant) => grant.kind === "themePack")?.payload);
          if (!details) return null;
          return (
            <div className="mt-1 space-y-1.5 text-[10px] text-muted-foreground">
              {details.family && <p className="flex items-center gap-1 truncate"><Type className="size-3 shrink-0" /> <span className="truncate" style={{ fontFamily: details.family }}>{details.family}</span></p>}
              {details.colors.length > 0 && <div className="flex items-center gap-1.5"><Palette className="size-3 shrink-0" /><div className="flex min-w-0 gap-1">{details.colors.map(([token, color]) => <span key={token} title={`${token}: ${color}`} className="size-3 rounded-full border border-white/20" style={{ backgroundColor: color }} />)}</div><span>{details.colors.length} colors</span></div>}
            </div>
          );
        })()}
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

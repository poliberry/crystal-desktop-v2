"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Gem, PackageOpen, Sparkles } from "lucide-react";

import { PriceTag, SkuCard } from "@/components/marketplace/sku-card";
import {
  GRANT_KIND_META,
  PAGE_COPY,
  pageOf,
  primaryKind,
  type ShopPage,
  type ShopSku,
} from "@/components/marketplace/sku-kinds";
import { SkuPreview } from "@/components/marketplace/sku-preview";
import { planPerks } from "@/components/marketplace/sku-dialog";
import { priceFor } from "@/components/marketplace/use-shop";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface ViewProps {
  skus: ShopSku[];
  ownedIds: Set<string>;
  discountBps: number;
  onOpen: (sku: ShopSku) => void;
}

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-4";

// --- The front page ----------------------------------------------------------------

/** The big rotating banner at the top of the shop. */
function Hero({ skus, discountBps, onOpen }: { skus: ShopSku[]; discountBps: number; onOpen: (sku: ShopSku) => void }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = skus.length;

  useEffect(() => {
    if (count < 2 || paused) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), 7000);
    return () => window.clearInterval(timer);
  }, [count, paused]);

  if (count === 0) return null;
  const sku = skus[index % count];
  const kind = GRANT_KIND_META[primaryKind(sku)];

  return (
    <section
      className="relative h-72 overflow-hidden rounded-3xl border border-foreground/10 bg-gradient-to-br from-primary/25 via-primary/10 to-transparent shadow-lg shadow-black/10"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={sku.id}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="absolute inset-0 grid grid-cols-[1fr_auto] items-center gap-6 px-10"
        >
          <div className="max-w-md space-y-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold tracking-widest text-primary uppercase">
              <Sparkles className="size-3.5" /> Featured · {sku.type === "bundle" ? "Bundle" : kind.label}
            </p>
            <h2 className="text-4xl leading-tight font-bold tracking-tight">{sku.name}</h2>
            <p className="line-clamp-2 text-sm text-muted-foreground">{sku.description ?? kind.blurb}</p>
            <div className="flex items-center gap-4 pt-1">
              <Button size="lg" onClick={() => onOpen(sku)}>
                View
              </Button>
              <PriceTag sku={sku} discountBps={discountBps} className="text-lg" />
            </div>
          </div>
          <SkuPreview grants={sku.grants} size="lg" bare className="h-full w-72" />
        </motion.div>
      </AnimatePresence>

      {count > 1 && (
        <>
          <div className="absolute bottom-4 left-10 flex gap-1.5">
            {skus.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Show ${s.name}`}
                onClick={() => setIndex(i)}
                className={cn(
                  "h-1.5 rounded-full bg-foreground/25 transition-all",
                  i === index % count ? "w-6 bg-primary" : "w-1.5 hover:bg-foreground/50",
                )}
              />
            ))}
          </div>
          <div className="absolute right-4 bottom-4 flex gap-1">
            <Button size="icon" variant="ghost" className="size-8" onClick={() => setIndex((i) => (i - 1 + count) % count)}>
              <ChevronLeft />
            </Button>
            <Button size="icon" variant="ghost" className="size-8" onClick={() => setIndex((i) => (i + 1) % count)}>
              <ChevronRight />
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

/** A titled, sideways-scrolling row of cards. */
function Row({
  title,
  blurb,
  skus,
  onSeeAll,
  ...view
}: { title: string; blurb?: string; skus: ShopSku[]; onSeeAll?: () => void } & Omit<ViewProps, "skus">) {
  if (skus.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
          {blurb && <p className="text-xs text-muted-foreground">{blurb}</p>}
        </div>
        {onSeeAll && (
          <Button variant="ghost" size="sm" onClick={onSeeAll}>
            See all <ChevronRight />
          </Button>
        )}
      </div>
      <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pt-1 pb-3">
        {skus.map((sku) => (
          <SkuCard
            key={sku.id}
            sku={sku}
            owned={view.ownedIds.has(sku.id)}
            discountBps={view.discountBps}
            onOpen={view.onOpen}
            className="w-44 shrink-0 snap-start"
          />
        ))}
      </div>
    </section>
  );
}

/** The Crystal plans, shown as plans rather than as cosmetics. */
function PlansBanner({ skus, ownedIds, onOpen, onSeeAll }: ViewProps & { onSeeAll: () => void }) {
  if (skus.length === 0) return null;
  return (
    <section className="relative overflow-hidden rounded-3xl border border-fuchsia-400/20 bg-gradient-to-br from-violet-500/20 via-fuchsia-500/10 to-sky-400/10 p-6">
      <div className="flex items-center gap-2 text-fuchsia-400">
        <Gem className="size-5" />
        <h3 className="text-lg font-semibold tracking-tight text-foreground">Crystal</h3>
      </div>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">
        Better streaming, a share off everything in the shop, and early access to new drops.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {skus.slice(0, 2).map((sku) => (
          <button
            key={sku.id}
            type="button"
            onClick={() => onOpen(sku)}
            className="rounded-2xl border border-foreground/10 bg-background/50 p-4 text-left backdrop-blur-xl transition-colors hover:bg-background/70"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">{sku.name}</span>
              <PriceTag sku={sku} />
            </div>
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
              {sku.grants.flatMap((g) => (g.kind === "plan" ? planPerks(g.payload) : [])).slice(0, 3).map((perk) => (
                <li key={perk}>• {perk}</li>
              ))}
            </ul>
            {ownedIds.has(sku.id) && <p className="mt-2 text-xs font-medium text-emerald-500">Your plan</p>}
          </button>
        ))}
      </div>
      <Button variant="ghost" size="sm" className="mt-3" onClick={onSeeAll}>
        Compare plans <ChevronRight />
      </Button>
    </section>
  );
}

export function ShopHome({ skus, ownedIds, discountBps, onOpen, go }: ViewProps & { go: (page: ShopPage) => void }) {
  const view = { ownedIds, discountBps, onOpen };
  const featured = useMemo(() => {
    const picked = skus.filter((s) => s.featured && s.type !== "subscription");
    return (picked.length ? picked : [...skus].sort((a, b) => b.createdAt - a.createdAt)).slice(0, 5);
  }, [skus]);
  const newest = useMemo(() => [...skus].filter((s) => s.type !== "subscription").sort((a, b) => b.createdAt - a.createdAt).slice(0, 12), [skus]);
  const free = useMemo(() => skus.filter((s) => s.priceCents === 0 && !ownedIds.has(s.id)), [skus, ownedIds]);
  const byPage = (page: ShopPage) => skus.filter((s) => pageOf(s) === page);

  if (skus.length === 0) return <EmptyShop />;

  return (
    <div className="space-y-8">
      <Hero skus={featured} discountBps={discountBps} onOpen={onOpen} />
      <Row title="New arrivals" blurb="The latest additions" skus={newest} {...view} />
      <PlansBanner skus={byPage("plans")} {...view} onSeeAll={() => go("plans")} />
      <Row title="Free to claim" skus={free} {...view} />
      {(["avatarDecoration", "profileSticker", "profileEffect", "nameplate", "community", "bundles"] as const).map((page) => (
        <Row
          key={page}
          title={PAGE_COPY[page].title}
          blurb={PAGE_COPY[page].blurb}
          skus={byPage(page).slice(0, 12)}
          onSeeAll={() => go(page)}
          {...view}
        />
      ))}
    </div>
  );
}

// --- One category ---------------------------------------------------------------------

type Sort = "featured" | "newest" | "low" | "high";
type Filter = "all" | "free" | "paid" | "owned" | "unowned";

export function ShopCategory({
  page,
  skus,
  ownedIds,
  discountBps,
  onOpen,
}: ViewProps & { page: Exclude<ShopPage, "home" | "collection" | "creations"> }) {
  const [sort, setSort] = useState<Sort>("featured");
  const [filter, setFilter] = useState<Filter>("all");
  const copy = PAGE_COPY[page];

  const items = useMemo(() => {
    const pageItems = skus.filter((s) => pageOf(s) === page);
    const filtered = pageItems.filter((s) => {
      if (filter === "free") return s.priceCents === 0;
      if (filter === "paid") return s.priceCents > 0;
      if (filter === "owned") return ownedIds.has(s.id);
      if (filter === "unowned") return !ownedIds.has(s.id);
      return true;
    });
    const price = (s: ShopSku) => priceFor(s, discountBps);
    return filtered.sort((a, b) => {
      if (sort === "newest") return b.createdAt - a.createdAt;
      if (sort === "low") return price(a) - price(b);
      if (sort === "high") return price(b) - price(a);
      return Number(b.featured) - Number(a.featured);
    });
  }, [skus, page, filter, sort, ownedIds, discountBps]);

  const total = skus.filter((s) => pageOf(s) === page).length;

  return (
    <div className="space-y-6">
      <header className="relative overflow-hidden rounded-3xl border border-foreground/10 bg-gradient-to-br from-primary/20 via-primary/5 to-transparent px-8 py-7">
        <h2 className="text-3xl font-bold tracking-tight">{copy.title}</h2>
        <p className="mt-1 max-w-lg text-sm text-muted-foreground">{copy.blurb}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          {total} {total === 1 ? "item" : "items"}
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", "All"],
              ["free", "Free"],
              ["paid", "Paid"],
              ["unowned", "Not owned"],
              ["owned", "Owned"],
            ] as [Filter, string][]
          ).map(([id, label]) => (
            <Button key={id} size="sm" variant={filter === id ? "secondary" : "ghost"} onClick={() => setFilter(id)}>
              {label}
            </Button>
          ))}
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="featured">Featured first</SelectItem>
            <SelectItem value="newest">Newest</SelectItem>
            <SelectItem value="low">Price: low to high</SelectItem>
            <SelectItem value="high">Price: high to low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {items.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {total === 0 ? "Nothing here yet — check back soon." : "Nothing matches those filters."}
        </p>
      ) : (
        <div className={GRID}>
          {items.map((sku) => (
            <SkuCard key={sku.id} sku={sku} owned={ownedIds.has(sku.id)} discountBps={discountBps} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Search -----------------------------------------------------------------------------

export function SearchResults({ query, skus, ownedIds, discountBps, onOpen }: ViewProps & { query: string }) {
  const needle = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      skus.filter(
        (s) =>
          s.name.toLowerCase().includes(needle) ||
          (s.description ?? "").toLowerCase().includes(needle) ||
          (s.creator?.username ?? "").toLowerCase().includes(needle) ||
          GRANT_KIND_META[primaryKind(s)].label.toLowerCase().includes(needle),
      ),
    [skus, needle],
  );
  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold tracking-tight">
        {results.length} {results.length === 1 ? "result" : "results"} for &ldquo;{query}&rdquo;
      </h2>
      {results.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Nothing found. Try a different word.</p>
      ) : (
        <div className={GRID}>
          {results.map((sku) => (
            <SkuCard key={sku.id} sku={sku} owned={ownedIds.has(sku.id)} discountBps={discountBps} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

export function EmptyShop() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center text-muted-foreground">
      <PackageOpen className="size-10" />
      <p className="text-sm">The shop is empty right now. Check back soon.</p>
    </div>
  );
}

"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Clapperboard, Heart, Loader2, Search, Sticker, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { GifIcon } from "@/components/icons/gif-icon";
import { GLASS_BASE, GLASS_DARK } from "@/components/sidebar/glass";
import { Input } from "@/components/ui/input";
import { useKlipyFavourites, useKlipyFeed } from "@/hooks/use-klipy";
import { useSmoothScroll } from "@/hooks/use-smooth-scroll";
import { klipyConfigured } from "@/lib/klipy";
import { cn } from "@/lib/utils";
import { balanceColumns, KLIPY_LABEL, type KlipyItem, type KlipyKind } from "../../convex/lib/klipy";

/** The attribute on the button that opens it, so pressing that button to close it isn't also read as pressing outside. */
export const MEDIA_TRIGGER_ATTRIBUTE = "data-media-trigger";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };

type Tab = "favourites" | KlipyKind;

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "favourites", label: "Favourites", icon: <Heart className="size-3.5" /> },
  { id: "gif", label: KLIPY_LABEL.gif, icon: <GifIcon className="size-4" /> },
  { id: "clip", label: KLIPY_LABEL.clip, icon: <Clapperboard className="size-3.5" /> },
  { id: "sticker", label: KLIPY_LABEL.sticker, icon: <Sticker className="size-3.5" /> },
];

const ALL_KINDS: readonly KlipyKind[] = ["gif", "clip", "sticker"];

/** Stickers are small and square-ish, so they sit three across; GIFs and clips are wider, two across. */
const columnsFor = (tab: Tab) => (tab === "sticker" ? 3 : 2);

/** Waits for typing to pause before a search goes out, so KLIPY isn't asked once per letter. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

function Tile({ item, favourite, onPick, onToggle }: { item: KlipyItem; favourite: boolean; onPick: () => void; onToggle: () => void }) {
  // Painted behind the picture while it loads, so a tile is already the right shape and a soft version of its colours.
  const backdrop = item.blur ? { backgroundImage: `url("${item.blur}")`, backgroundSize: "cover" } : undefined;
  return (
    <div className="group relative mb-1.5 overflow-hidden rounded-lg bg-muted/60" style={{ aspectRatio: `${item.preview.width} / ${item.preview.height}`, ...backdrop }}>
      <button type="button" onClick={onPick} aria-label={item.title ? `Send ${item.title}` : `Send this ${item.kind}`} title={item.title || undefined} className="absolute inset-0 size-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {/* Loaded straight from KLIPY, as its integration rules require: no proxy, no copy. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.preview.url} alt={item.title} loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} className="size-full object-cover" />
      </button>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={favourite}
        aria-label={favourite ? "Remove from favourites" : "Add to favourites"}
        className={cn(
          "absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-opacity hover:bg-black/70 focus-visible:opacity-100",
          favourite ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <Heart className={cn("size-3.5", favourite && "fill-rose-500 text-rose-500")} />
      </button>
    </div>
  );
}

/** Items dealt into columns, each to the shortest, so what is already on screen never moves when a page is added. */
function Masonry({ items, columns, isFavourite, onPick, onToggle }: { items: KlipyItem[]; columns: number; isFavourite: (i: KlipyItem) => boolean; onPick: (i: KlipyItem) => void; onToggle: (i: KlipyItem) => void }) {
  const cols = useMemo(() => balanceColumns(items, columns, (i) => i.preview.height / i.preview.width), [items, columns]);
  return (
    <div className="flex items-start gap-1.5">
      {cols.map((col, c) => (
        <div key={c} className="min-w-0 flex-1">
          {col.map((item) => (
            <Tile key={`${item.kind}:${item.slug}`} item={item} favourite={isFavourite(item)} onPick={() => onPick(item)} onToggle={() => onToggle(item)} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Skeletons({ columns }: { columns: number }) {
  const heights = ["h-24", "h-32", "h-20", "h-28", "h-36", "h-24"];
  return (
    <div className="flex items-start gap-1.5" aria-hidden>
      {Array.from({ length: columns }, (_, c) => (
        <div key={c} className="min-w-0 flex-1 space-y-1.5">
          {heights.map((_, i) => (
            <div key={i} className={cn("animate-pulse rounded-lg bg-muted/60", heights[(i + c * 2) % heights.length])} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Body({ tab, kinds, query, onPick }: { tab: Tab; kinds: readonly KlipyKind[]; query: string; onPick: (item: KlipyItem, query: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  useSmoothScroll(scroller);

  const isFeed = tab !== "favourites";
  const feed = useKlipyFeed(isFeed ? tab : "gif", query, isFeed);
  const favourites = useKlipyFavourites(true);

  // Back to the top for a new tab or a new search.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [tab, query]);

  // The next page is asked for when the end of the list scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !isFeed) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && feed.loadMore(), { root: scroller.current, rootMargin: "240px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isFeed, feed.loadMore, feed.items.length]);

  // Favourites are across every kind; a picker that can't send some kind (the lounge has no video) doesn't offer them.
  const favouriteItems = useMemo(() => favourites.items.filter((i) => kinds.includes(i.kind)), [favourites.items, kinds]);
  const items = isFeed ? feed.items : favouriteItems;
  const loading = isFeed ? feed.loading : favourites.loading;
  const error = isFeed ? feed.error : favourites.error;
  const columns = columnsFor(tab);
  const pick = (item: KlipyItem) => onPick(item, isFeed ? query : "");

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-2">
      {items.length > 0 && <Masonry items={items} columns={columns} isFavourite={favourites.isFavourite} onPick={pick} onToggle={(i) => void favourites.toggle(i)} />}

      {items.length === 0 && loading && <Skeletons columns={columns} />}

      {items.length === 0 && !loading && !error && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          {tab === "favourites" ? (
            <>
              Nothing saved yet. Tap the <Heart className="mx-0.5 inline size-3.5 align-text-bottom" /> on a GIF, clip or sticker to keep it here.
            </>
          ) : query.trim() ? (
            <>Nothing found for “{query.trim()}”.</>
          ) : (
            <>Nothing to show right now.</>
          )}
        </p>
      )}

      {error && (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
          <p>{error}</p>
          {isFeed && (
            <button type="button" onClick={feed.retry} className="rounded-md border border-border px-3 py-1 text-xs text-foreground hover:bg-accent">
              Try again
            </button>
          )}
        </div>
      )}

      {items.length > 0 && loading && (
        <div className="flex justify-center py-3 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      )}
      {isFeed && <div ref={sentinel} aria-hidden className="h-px" />}
    </div>
  );
}

/**
 * The composer's GIF, clip and sticker picker, from KLIPY: a card that grows out of the composer's top-right corner, the
 * same shape and motion as the emoji picker beside it (see `ComposerEmojiPicker`).
 *
 * It is open until it is closed — Escape, a press anywhere outside it and its button, or choosing something, which sends it.
 * Favourites are kept with the account (kind and slug only); everything else is KLIPY's, loaded from KLIPY by this machine.
 */
export function ComposerMediaPicker({
  open,
  onClose,
  onSelect,
  kinds = ALL_KINDS,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (item: KlipyItem, query: string) => void;
  /** Which of KLIPY's kinds this place can show. The lounge's chat has no video, so it offers GIFs and stickers only. */
  kinds?: readonly KlipyKind[];
}) {
  const card = useRef<HTMLDivElement>(null);
  const tabs = useMemo(() => TABS.filter((t) => t.id === "favourites" || kinds.includes(t.id)), [kinds]);
  const [tab, setTab] = useState<Tab>(kinds[0] ?? "gif");
  const [text, setText] = useState("");
  const query = useDebounced(text, 350);
  const configured = klipyConfigured();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || card.current?.contains(target) || target.closest(`[${MEDIA_TRIGGER_ATTRIBUTE}]`)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={card}
          key="media-picker"
          role="dialog"
          aria-label="GIFs, clips and stickers"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={SPRING}
          className={cn(GLASS_BASE, GLASS_DARK, "absolute right-0 bottom-full z-30 rounded-b-none border-b-0", "shadow-[0_-10px_16px_-8px_rgb(0_0_0/0.3)]")}
        >
          <div className="flex h-[26rem] w-[26rem] max-w-[calc(100vw-2rem)] flex-col">
            {configured ? (
              <>
                <div className="flex shrink-0 items-center gap-1 px-2 pt-2" role="tablist">
                  {tabs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={tab === t.id}
                      onClick={() => setTab(t.id)}
                      className={cn(
                        "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                        tab === t.id && "bg-accent text-foreground",
                      )}
                    >
                      {t.icon}
                      {t.label}
                    </button>
                  ))}
                </div>

                {tab !== "favourites" && (
                  <div className="relative shrink-0 p-2">
                    <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    {/* "Search KLIPY" is the placeholder KLIPY's attribution guidelines ask for. */}
                    <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search KLIPY" className="h-8 pl-7 pr-7 text-sm" autoFocus />
                    {text && (
                      <button type="button" onClick={() => setText("")} aria-label="Clear search" className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                )}
                {tab === "favourites" && <div className="h-2 shrink-0" />}

                <Body tab={tab} kinds={kinds} query={query} onPick={onSelect} />

                <p className="shrink-0 border-t border-foreground/10 px-3 py-1.5 text-right text-[10px] tracking-wide text-muted-foreground uppercase">Powered by KLIPY</p>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center text-sm text-muted-foreground">
                <GifIcon className="size-8" />
                <p>GIFs aren&apos;t set up in this build.</p>
                <p className="text-xs">Add a KLIPY API key as <code className="rounded bg-muted px-1">NEXT_PUBLIC_KLIPY_API_KEY</code> and rebuild.</p>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

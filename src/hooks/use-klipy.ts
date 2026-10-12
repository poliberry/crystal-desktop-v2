"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../convex/_generated/api";
import { mergeKlipyPages, type KlipyItem, type KlipyKind } from "../../convex/lib/klipy";
import { fetchKlipyItems, fetchKlipyPage, KlipyError } from "@/lib/klipy";

const messageOf = (err: unknown): string => (err instanceof KlipyError ? err.message : "Something went wrong loading from KLIPY.");

/**
 * One tab of the picker: what is trending, or the results of a search, a page at a time.
 *
 * A new search throws away the old results at once rather than leaving them up under the new words, and a response that
 * arrives after a newer request has gone out is ignored — so quick typing can't land an older search on top of a newer one.
 */
export function useKlipyFeed(kind: KlipyKind, query: string, enabled: boolean) {
  const [items, setItems] = useState<KlipyItem[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef(0);
  const loadingRef = useRef(false);
  /** Bumped by every new search; a response from an older one is dropped. */
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(
    async (page: number, replace: boolean) => {
      const mine = generation.current;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const result = await fetchKlipyPage(kind, query, page, controller.signal);
        if (mine !== generation.current) return;
        pageRef.current = page;
        setItems((prev) => (replace ? result.items : mergeKlipyPages(prev, result.items)));
        setHasNext(result.hasNext);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (mine !== generation.current) return;
        setError(messageOf(err));
        setHasNext(false);
      } finally {
        if (mine === generation.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [kind, query],
  );

  useEffect(() => {
    generation.current += 1;
    abort.current?.abort();
    pageRef.current = 0;
    loadingRef.current = false;
    setItems([]);
    setHasNext(false);
    setError(null);
    if (!enabled) {
      setLoading(false);
      return;
    }
    void load(1, true);
    return () => abort.current?.abort();
  }, [load, enabled]);

  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasNext) return;
    void load(pageRef.current + 1, false);
  }, [hasNext, load]);

  const retry = useCallback(() => {
    generation.current += 1;
    void load(Math.max(1, pageRef.current + (items.length ? 1 : 0)), items.length === 0);
  }, [items.length, load]);

  return { items, hasNext, loading, error, loadMore, retry };
}

/** The look-ups already made this session, so reopening the picker doesn't ask KLIPY for the same favourites again. */
const resolved = new Map<string, KlipyItem | null>();
const keyOf = (kind: KlipyKind, slug: string) => `${kind}:${slug}`;

/**
 * The person's favourites. The server keeps only kind and slug; the pictures are looked up from KLIPY on this machine,
 * newest first. Adding and removing show at once (an optimistic update) and settle when the server confirms.
 */
export function useKlipyFavourites(enabled: boolean) {
  const stored = useQuery(api.klipy.listFavourites);
  const add = useMutation(api.klipy.addFavourite).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.klipy.listFavourites, {});
    if (current === undefined || current.some((f) => f.kind === args.kind && f.slug === args.slug)) return;
    store.setQuery(api.klipy.listFavourites, {}, [{ kind: args.kind, slug: args.slug }, ...current]);
  });
  const remove = useMutation(api.klipy.removeFavourite).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.klipy.listFavourites, {});
    if (current === undefined) return;
    store.setQuery(api.klipy.listFavourites, {}, current.filter((f) => !(f.kind === args.kind && f.slug === args.slug)));
  });

  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch whichever favourites haven't been looked up yet, a kind at a time.
  useEffect(() => {
    if (!enabled || !stored) return;
    const missing: Record<KlipyKind, string[]> = { gif: [], clip: [], sticker: [] };
    for (const f of stored) if (!resolved.has(keyOf(f.kind, f.slug))) missing[f.kind].push(f.slug);
    const kinds = (Object.keys(missing) as KlipyKind[]).filter((k) => missing[k].length > 0);
    if (kinds.length === 0) return;

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void Promise.all(
      kinds.map(async (kind) => {
        const items = await fetchKlipyItems(kind, missing[kind], controller.signal);
        const got = new Set(items.map((i) => i.slug));
        for (const item of items) resolved.set(keyOf(kind, item.slug), item);
        // KLIPY no longer has it: remembered as gone, so it isn't asked for every time.
        for (const slug of missing[kind]) if (!got.has(slug)) resolved.set(keyOf(kind, slug), null);
      }),
    )
      .then(() => setVersion((v) => v + 1))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(messageOf(err));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [enabled, stored]);

  const items = useMemo(() => {
    void version;
    return (stored ?? []).flatMap((f) => {
      const item = resolved.get(keyOf(f.kind, f.slug));
      return item ? [item] : [];
    });
  }, [stored, version]);

  const isFavourite = useCallback((item: Pick<KlipyItem, "kind" | "slug">) => !!stored?.some((f) => f.kind === item.kind && f.slug === item.slug), [stored]);

  const toggle = useCallback(
    (item: KlipyItem) => {
      if (isFavourite(item)) return remove({ kind: item.kind, slug: item.slug });
      // Already in hand, so the Favourites tab can show it without asking KLIPY again.
      resolved.set(keyOf(item.kind, item.slug), item);
      return add({ kind: item.kind, slug: item.slug });
    },
    [add, isFavourite, remove],
  );

  return { items, loading: loading || stored === undefined, error, isFavourite, toggle, count: stored?.length ?? 0 };
}

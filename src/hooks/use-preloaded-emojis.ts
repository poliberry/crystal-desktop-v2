"use client";

import { useEffect } from "react";

import { preloadIntoCache } from "@/lib/image-cache";
import { useAccessibleEmojis } from "@/hooks/use-accessible-emojis";

/**
 * Warm the IndexedDB blob cache for every custom emoji the user can reach,
 * before any of them is rendered.
 *
 * The catalogue (`api.communityEmojis.listAccessible`) is already subscribed by
 * the preloader, so this costs a walk over it and a cache lookup per url — the
 * fetches themselves happen once. Custom emoji are small, repeated across every
 * message list, and `_storage`-addressed, so they're exactly the kind of thing
 * worth having on disk before the first paint.
 */
export function usePreloadedEmojis(): void {
  const { groups } = useAccessibleEmojis();

  useEffect(() => {
    for (const group of groups) {
      for (const emoji of group.emojis) {
        void preloadIntoCache(emoji.imageUrl);
      }
    }
  }, [groups]);
}

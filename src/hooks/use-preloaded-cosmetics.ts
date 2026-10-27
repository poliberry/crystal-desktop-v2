"use client";

import { useEffect } from "react";

import { preloadCosmetics, type CosmeticSource } from "@/lib/image-preload";

/**
 * Fetch the cosmetics of everyone in a list before anybody opens their card.
 *
 * Called wherever people are listed — the member list, the DM sidebar, the
 * friends list — because a list of people is exactly the set of profile cards
 * about to be opened. See src/lib/image-preload.ts for why a request that goes
 * nowhere is enough.
 *
 * The effect re-runs whenever the list identity changes, which for a Convex
 * query is every time it re-resolves. That costs a walk over the list and a
 * set lookup per url; the fetches themselves happen once.
 */
export function usePreloadedCosmetics(
  people: readonly CosmeticSource[] | undefined,
): void {
  useEffect(() => {
    if (!people) return;
    for (const person of people) preloadCosmetics(person);
  }, [people]);
}

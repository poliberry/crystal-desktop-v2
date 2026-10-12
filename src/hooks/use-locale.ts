"use client";

import { useSyncExternalStore } from "react";

import { getHourCycle, getRegion, subscribeLocale } from "@/lib/locale";

const snapshot = () => `${getRegion()}|${getHourCycle()}`;

/**
 * Re-renders a component when the region or the 12/24-hour setting changes (src/lib/locale.ts). The formatting helpers
 * read the setting when they run, so a component that formats dates only needs this to be redrawn when it changes.
 * Returns a string that differs whenever either setting does, which is also a convenient `useMemo` dependency.
 */
export function useLocale(): string {
  return useSyncExternalStore(subscribeLocale, snapshot, () => "auto|auto");
}

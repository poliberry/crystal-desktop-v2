"use client";

import { useSyncExternalStore } from "react";

/**
 * Which of Home's two surfaces is showing: My Crystal (the briefing) or Friends. They are separate
 * destinations, each with its own button in the sidebar. Settings → Appearance → Home page only picks
 * the one that's showing when Crystal first opens (see `applyLaunchSurface`); after that, the last one
 * picked stays until another is.
 */
export type HomeSurface = "my-crystal" | "friends";

let surface: HomeSurface = "my-crystal";
let chosen = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setHomeSurface(next: HomeSurface) {
  chosen = true;
  if (surface === next) return;
  surface = next;
  emit();
}

/** The launch preference, applied until the person picks a surface themselves. */
export function applyLaunchSurface(preferred: HomeSurface) {
  if (chosen || surface === preferred) return;
  surface = preferred;
  emit();
}

export function useHomeSurface(): HomeSurface {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => surface,
    () => "my-crystal",
  );
}

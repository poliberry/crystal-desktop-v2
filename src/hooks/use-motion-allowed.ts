"use client";

import { useSyncExternalStore } from "react";

import { useAccessibility } from "@/components/accessibility-provider";
import { useAppActive } from "@/hooks/use-app-active";

/**
 * Whether anything decorative is allowed to move at all.
 *
 * Three things can say no: Settings → Accessibility → "Reduce motion", the
 * operating system's own preference, and the window not being the one the person
 * is looking at (another app has focus, or it is minimised). The first two are
 * choices — someone who turned it on in their OS has said so for every app, and
 * someone who turned it on here has said so for this one. The third is a pause:
 * everything resumes the moment the window is back.
 *
 * Cosmetics (avatar decorations, nameplates, profile effects and frames) combine
 * this with their own rule for when to play: this is the ceiling, "hover" or
 * "when the profile is open" is what happens underneath it. The CSS rule in
 * globals.css can't do this job, since it shortens CSS animations and has no
 * say over a GIF, a video or a canvas.
 */

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia?.(QUERY);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

const systemPrefersReduced = () => window.matchMedia?.(QUERY).matches ?? false;

/** The server can't know, and assumes the default; the client corrects it on hydration. */
const serverSnapshot = () => false;

export function useMotionAllowed(): boolean {
  const { reducedMotion } = useAccessibility();
  const system = useSyncExternalStore(subscribe, systemPrefersReduced, serverSnapshot);
  const appActive = useAppActive();
  return !reducedMotion && !system && appActive;
}

"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Whether the pointer is over the thing `ref` is decorating.
 *
 * Cosmetics like a nameplate are `pointer-events-none` wallpaper: they overhang
 * or fill the row they sit in, and one that swallowed clicks would break
 * whatever the row is a button for. So they can't be told about their own
 * hover. The row is what's pointed at, and the row is an ancestor.
 *
 * "Ancestor" is the nearest one that can actually receive the pointer — a
 * wrapper that is itself `pointer-events-none` (the dock's mask layer) never
 * gets `pointerenter`, so the walk goes on past it.
 *
 * `enabled = false` listens to nothing and reports `false`.
 */
export function useAncestorHover(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setHovered(false);
      return;
    }
    let host = ref.current?.parentElement ?? null;
    while (host && getComputedStyle(host).pointerEvents === "none") host = host.parentElement;
    if (!host) return;

    const enter = () => setHovered(true);
    const leave = () => setHovered(false);
    host.addEventListener("pointerenter", enter);
    host.addEventListener("pointerleave", leave);
    // Mounted underneath a pointer that is already there: no `pointerenter` is coming.
    setHovered(host.matches(":hover"));
    return () => {
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointerleave", leave);
      setHovered(false);
    };
  }, [ref, enabled]);

  return hovered;
}

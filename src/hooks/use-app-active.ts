"use client";

import { MotionGlobalConfig } from "framer-motion";
import { useSyncExternalStore } from "react";

/**
 * Whether this window is one the person is looking at: visible, and focused.
 *
 * Decorative motion is not worth anything to someone who is in another application, and on a machine that draws in
 * software it is a steady cost that is still there when they come back. So when this goes false the app holds still:
 *
 *  - CSS animations are paused by a class on `<html>` (`app-inactive`, see globals.css), which also covers anything
 *    started while the window is inactive;
 *  - framer-motion is told to jump new animations to their end (`MotionGlobalConfig.skipAnimations`), set directly
 *    rather than through `<MotionConfig>` so that a focus change does not re-render every animated component;
 *  - JS-driven loops (canvas players, GIF/video cosmetics, wallpaper clips) read `useAppActive` / `useMotionAllowed`
 *    and stop. Each owns its own pause and resume; nothing here reaches into `<video>` elements, so a clip a component
 *    has deliberately held still is never restarted behind its back.
 *
 * It is deliberately about *decoration*. Call video, screen shares and audio are not animations and are not touched.
 *
 * "Focused" is `document.hasFocus()`, not the `blur` event alone: `blur` also fires when focus moves into an iframe or
 * another window of the same app, where the page is still being looked at.
 */

let active = true;
let started = false;
const listeners = new Set<() => void>();

function read(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

function update(): void {
  const next = read();
  if (next === active) return;
  active = next;
  document.documentElement.classList.toggle("app-inactive", !next);
  MotionGlobalConfig.skipAnimations = !next;
  for (const listener of listeners) listener();
}

/** Begin tracking. Idempotent; call once from a provider that lives as long as the window. */
export function startAppActivity(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("focus", update);
  window.addEventListener("blur", update);
  document.addEventListener("visibilitychange", update);
  update();
}

export function isAppActive(): boolean {
  return active;
}

export function subscribeAppActive(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const serverSnapshot = () => true;

/** Whether the window is visible and focused. Re-renders its caller only when that changes. */
export function useAppActive(): boolean {
  return useSyncExternalStore(subscribeAppActive, isAppActive, serverSnapshot);
}

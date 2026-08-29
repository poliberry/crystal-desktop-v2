"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * Smooth wheel scrolling.
 *
 * A mouse wheel arrives as a handful of large, discrete jumps — 100px a notch
 * in Chromium, three text lines in Firefox — and the browser applies each one
 * instantly, so a scroller teleports rather than moves. This intercepts those
 * notches and animates to where they add up to, which is the difference
 * between a list that jerks and one that glides.
 *
 * Deliberately narrow, because the alternatives break things:
 *
 *  - **Only the wheel.** Programmatic scrolls stay instant. The message lists
 *    pin themselves to the newest message by assigning `scrollTop` and
 *    measuring straight afterwards (see `use-stick-to-bottom.ts`); a global
 *    `scroll-behavior: smooth` would animate those assignments and the
 *    measurement would read a position the list hasn't reached yet.
 *  - **Only real wheels.** Trackpads and precision mice already emit small,
 *    continuous deltas with their own momentum. Animating those adds latency
 *    to something that was already smooth, so they're passed straight through.
 *  - **Only within range.** At the top or bottom the event isn't consumed, so
 *    a nested scroller still hands off to its parent as it normally would.
 *
 * Reduced motion turns it off entirely — the whole feature is motion for its
 * own sake, which is exactly what that preference is about.
 */

/** Long enough to read as movement, short enough that the list still feels
 * attached to the wheel. Also comfortably inside the 400ms window
 * `use-stick-to-bottom` treats as "the reader is scrolling", so a fling that
 * ends at the bottom still re-pins. */
const DURATION_MS = 280;

/** Firefox reports line deltas; this is what a line is worth in pixels. */
const LINE_HEIGHT_PX = 16;

/**
 * Below this, a vertical delta is a trackpad or a free-spinning wheel rather
 * than a notch. Chromium sends 100 per notch and Firefox 3 lines, so a real
 * notch clears this comfortably while a two-finger drag doesn't.
 */
const NOTCH_THRESHOLD_PX = 40;

/** How far the scroller may drift from where we last put it before we assume
 * something else moved it and stop fighting for control. */
const DRIFT_TOLERANCE_PX = 2;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  // The app's own preference is mirrored onto <html> by the accessibility
  // provider; the media query covers the OS setting for everyone who never
  // opened Settings. Read from the DOM rather than through context so this
  // works in the `ui/` primitives, which are used outside the provider too.
  if (document.documentElement.classList.contains("a11y-reduced-motion")) return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Whether this wheel event is a discrete notch worth animating. */
function notchDeltaPx(event: WheelEvent): number | null {
  // Ctrl+wheel is zoom, Shift+wheel is horizontal scrolling, and a
  // page-at-a-time delta mode is rare enough not to be worth guessing at.
  if (event.ctrlKey || event.shiftKey || event.altKey) return null;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return null;
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return null;

  const pixels =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * LINE_HEIGHT_PX : event.deltaY;
  return Math.abs(pixels) >= NOTCH_THRESHOLD_PX ? pixels : null;
}

/**
 * Attach smooth wheel scrolling to an element. Returns a detach function.
 *
 * Imperative rather than hook-shaped so it can be called from a callback ref,
 * which is the only way to reach elements that mount later than their parent
 * effect — the message lists render a skeleton first.
 */
export function attachSmoothScroll(el: HTMLElement): () => void {
  let frame = 0;
  let from = 0;
  let target = 0;
  let startedAt = 0;
  /** Where we last put the scroller, so drift from anywhere else is visible. */
  let applied = -1;

  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    applied = -1;
  };

  const step = (now: number) => {
    // Something else moved this scroller mid-animation — a jump to the newest
    // message, an anchor, a resize. Whatever it was outranks a wheel gesture.
    if (applied >= 0 && Math.abs(el.scrollTop - applied) > DRIFT_TOLERANCE_PX) {
      stop();
      return;
    }

    // Re-clamped every frame: content can grow or shrink underneath a fling.
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const to = clamp(target, 0, max);
    const progress = Math.min(1, (now - startedAt) / DURATION_MS);

    el.scrollTop = from + (to - from) * easeOutCubic(progress);
    applied = el.scrollTop;

    if (progress < 1) frame = requestAnimationFrame(step);
    else stop();
  };

  const onWheel = (event: WheelEvent) => {
    if (prefersReducedMotion()) return;
    const delta = notchDeltaPx(event);
    if (delta === null) return;

    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    if (max === 0) return;

    // Nothing left in that direction: leave the event alone so it bubbles to
    // whatever scroller is behind this one.
    const current = frame ? target : el.scrollTop;
    if ((delta < 0 && current <= 0) || (delta > 0 && current >= max)) return;

    event.preventDefault();
    from = el.scrollTop;
    target = clamp(current + delta, 0, max);
    startedAt = performance.now();
    if (!frame) frame = requestAnimationFrame(step);
  };

  // Any other way of scrolling wins immediately — a scrollbar drag or a
  // Page Down shouldn't have to fight an animation still playing out.
  const interrupt = () => stop();

  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("pointerdown", interrupt, { passive: true });
  el.addEventListener("keydown", interrupt, { passive: true });
  el.addEventListener("touchstart", interrupt, { passive: true });

  return () => {
    stop();
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("pointerdown", interrupt);
    el.removeEventListener("keydown", interrupt);
    el.removeEventListener("touchstart", interrupt);
  };
}

/** Smooth wheel scrolling for an element held in a ref. */
export function useSmoothScroll(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return attachSmoothScroll(el);
  }, [ref]);
}

/**
 * Smooth wheel scrolling as a callback ref: `<div ref={useSmoothScrollRef()}>`.
 *
 * For scrollers that appear and disappear with their content, where an effect
 * over a ref would run before the node exists.
 */
export function useSmoothScrollRef<T extends HTMLElement>(): (node: T | null) => void {
  const detachRef = useRef<(() => void) | null>(null);

  useEffect(() => () => detachRef.current?.(), []);

  return useCallback((node: T | null) => {
    detachRef.current?.();
    detachRef.current = node ? attachSmoothScroll(node) : null;
  }, []);
}

"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * Smooth wheel scrolling.
 *
 * A mouse wheel arrives as a handful of large, discrete jumps — 100px a notch
 * in Chromium, three text lines in Firefox — and the browser applies each one
 * instantly, so a scroller teleports rather than moves. This intercepts those
 * notches and pays them out over a few frames, which is the difference between
 * a list that jerks and one that glides.
 *
 * ## It owes a distance, it doesn't aim at a position
 *
 * The only state is how far the wheel is still owed, and every frame moves the
 * scroller by a fraction of *that* — `scrollTop += n`, never `scrollTop = n`.
 *
 * This is worth being strict about, because the version that aimed at a
 * position had to keep asking who else had moved the scroller, and the answer
 * was always "several things, legitimately": the message list jumping to a new
 * message, the browser's scroll anchoring holding your place as an image above
 * the viewport loads, a panel resizing. Each of those left the animation
 * holding a coordinate from a layout that no longer existed, and the next
 * frame applied it — which is what a lurch, or a snap back at the end of a
 * fling, actually is. Owing a distance has no coordinate to go stale.
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

/**
 * The fraction of a distance still left one second after it was asked for.
 *
 * Which is the whole shape of the glide: a hundred-millionth left after a
 * second works out as half the distance in 50ms, ninety percent in 130ms and
 * the last pixel around 350ms. Long enough to read as movement, short enough
 * that the list still feels attached to the wheel, and comfortably inside the
 * 400ms window `use-stick-to-bottom` treats as "the reader is scrolling", so a
 * fling that ends at the bottom still re-pins.
 */
const REMAINING_AFTER_A_SECOND = 1e-8;

/** Below this the remainder is applied in one go: chasing a decaying fraction
 * of half a pixel is frames of work for nothing visible. */
const MIN_STEP_PX = 0.5;

/** Firefox reports line deltas; this is what a line is worth in pixels. */
const LINE_HEIGHT_PX = 16;

/**
 * Below this, a vertical delta is a trackpad or a free-spinning wheel rather
 * than a notch. Chromium sends 100 per notch and Firefox 3 lines, so a real
 * notch clears this comfortably while a two-finger drag doesn't.
 */
const NOTCH_THRESHOLD_PX = 40;

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
  let lastAt = 0;
  /**
   * Distance still owed to the wheel, in pixels.
   *
   * The *whole* state of the animation, deliberately: no start position, no
   * target position, no record of where we last put the scroller. Everything
   * this used to keep was a position in a layout that had since changed, and
   * every bug in it was the same bug — a stale coordinate applied to a
   * scroller that had moved on, seen as a lurch or a snap back.
   */
  let pending = 0;

  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pending = 0;
  };

  const step = (now: number) => {
    frame = 0;
    // Per second rather than per frame, so the glide is the same on a 60Hz
    // panel and a 165Hz one.
    const seconds = Math.min(0.05, Math.max(0, now - lastAt) / 1000);
    lastAt = now;

    // Exponential decay: a fixed fraction of what's left, every frame. That's
    // what makes it ease out, and — unlike a duration — what makes a second
    // notch mid-glide simply add to the distance instead of restarting a
    // timeline.
    const move =
      Math.abs(pending) <= MIN_STEP_PX
        ? pending
        : pending * (1 - Math.pow(REMAINING_AFTER_A_SECOND, seconds));

    /**
     * Relative, never absolute. This is the whole design.
     *
     * Anything else may move this scroller between one frame and the next: the
     * message list jumping to a new message, the browser's scroll anchoring
     * holding your place as an image above the viewport loads, a resize. All
     * of them are fine and none of them need detecting, because what gets
     * applied is a *distance* from wherever the scroller now is rather than a
     * position decided before any of that happened.
     */
    el.scrollTop += move;
    pending -= move;

    // Against the end of the range, with distance still owing: it is owed
    // against content that isn't there. Asked of the range rather than of
    // whether the last write moved anything, because a sub-pixel write that
    // rounds to nothing is not the same thing as a list that has run out.
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const stuck = (pending < 0 && el.scrollTop <= 0) || (pending > 0 && el.scrollTop >= max);

    if (!stuck && Math.abs(pending) > MIN_STEP_PX) frame = requestAnimationFrame(step);
    else stop();
  };

  const start = () => {
    if (frame) return;
    lastAt = performance.now();
    frame = requestAnimationFrame(step);
  };

  const onWheel = (event: WheelEvent) => {
    if (prefersReducedMotion()) return;
    const delta = notchDeltaPx(event);
    if (delta === null) return;

    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    if (max === 0) return;

    // Nothing left in that direction: leave the event alone so it bubbles to
    // whatever scroller is behind this one.
    const heading = el.scrollTop + pending;
    if ((delta < 0 && heading <= 0) || (delta > 0 && heading >= max)) return;

    event.preventDefault();
    // Capped at the distance that actually exists in that direction, so a long
    // spin against the end of a list doesn't build up a debt that keeps the
    // scroller moving after the wheel has stopped.
    pending = clamp(pending + delta, -el.scrollTop, max - el.scrollTop);
    start();
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

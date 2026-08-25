"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * How far from the bottom still counts as "reading the end of the
 * conversation". Generous enough to survive sub-pixel layout and a scroll that
 * lands a hair short, small enough that someone who has genuinely scrolled up
 * to read isn't dragged back down.
 */
const PINNED_SLACK_PX = 80;

/**
 * How long after a wheel/touch/key the resulting scroll events still count as
 * that gesture. Momentum scrolling keeps firing events well after the finger
 * or wheel has stopped.
 */
const GESTURE_WINDOW_MS = 400;

/**
 * Gestures that mean "the reader is moving the scroller themselves".
 *
 * `pointerdown` is in here for the scrollbar: dragging it produces scroll
 * events without a wheel, a touch, or a key, and a drag that outlasts the
 * window above would otherwise stop counting as the reader half way through.
 * It's held open until the pointer is released rather than timed.
 */
const GESTURE_EVENTS = ["wheel", "touchmove", "keydown", "pointerdown"] as const;

/**
 * Keep a message list pinned to its newest message.
 *
 * Four things leave people mid-conversation, and scrolling on "the newest id
 * changed" only covers the first:
 *
 *  1. A new message arrives — jump, as long as the reader was at the bottom.
 *  2. A channel/DM is opened — jump unconditionally. Every view is a fresh
 *     mount, so this is what makes opening a conversation land at the end.
 *  3. The reader sends a message — jump, and re-pin. Sending is a request to
 *     be at the end, whatever they were reading a moment ago.
 *  4. The laid-out boxes change size after the jump has already happened — an
 *     image or link embed finishing, a late-loading font, the viewport
 *     shrinking because the unread bar appeared, or a cached page being
 *     replaced by a longer live one. Both boxes are observed, because either
 *     moving the end off screen looks identical to the reader and neither
 *     fires a scroll event or changes the newest message id.
 *
 * ## Why the pin is tracked from gestures, not from scroll events
 *
 * The hard part is telling *our* scrolling from the reader's, and comparing
 * `scrollTop` against the value the last jump left doesn't do it. A jump that
 * doesn't move `scrollTop` — because the list was already at the bottom, or
 * because the content grew without the offset changing — fires no scroll event
 * at all, so the recorded position is never cleared and the next real event is
 * measured against a stale baseline. `updatePinned` then decides the reader
 * scrolled up, unpins, and the resize pass in (4) stops doing anything: the
 * list stays wherever the last successful jump left it, which reads as
 * "opening a channel goes to the bottom of what was cached rather than to the
 * actual end".
 *
 * Gestures don't have that problem. Assigning `scrollTop` never produces a
 * `wheel`, `touchmove` or `keydown`, so anything arriving through those really
 * is the reader, and there is nothing to disambiguate. The pin is recomputed
 * only while one is in flight; every other scroll event is ours and is
 * ignored. Nothing here can get stuck in the unpinned state, because only a
 * deliberate gesture can enter it.
 */
export function useStickToBottom({
  viewKey,
  latestKey,
  latestIsMine = false,
}: {
  /** Identifies the open conversation/channel. A change means "jump". */
  viewKey: string;
  /** Identifies the newest message. A change means "jump if pinned". */
  latestKey: string | undefined;
  /** Whether the newest message is the reader's own. Re-pins. */
  latestIsMine?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const pinnedRef = useRef(true);
  /** When the reader last touched the scroller themselves. */
  const gestureAtRef = useRef(0);
  /** A pointer is down on the scroller — possibly dragging the scrollbar, for
   * as long as it takes. Counts as an ongoing gesture regardless of age. */
  const draggingRef = useRef(false);
  /** The newest id already reacted to, so live data replacing an identical
   * cached page doesn't count as a new message. */
  const seenLatestRef = useRef<string | undefined>(undefined);

  const isAtBottom = (el: HTMLElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight < PINNED_SLACK_PX;

  /** Assigning scrollTop rather than `scrollIntoView` on a sentinel: it can't
   * scroll an unrelated ancestor, and it's a no-op when nothing overflows. */
  const jump = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  /**
   * Jump now, and again on each of the next few frames.
   *
   * One assignment is not enough on the web: rows that just mounted may not
   * have their final height until styles and fonts resolve, so the first jump
   * targets a content box shorter than the real one. Re-running for a handful
   * of frames costs nothing — each is a no-op once the list has actually
   * settled — and covers the gap before the ResizeObserver takes over for the
   * slower arrivals like images.
   */
  const settleToBottom = useCallback(() => {
    let frames = 0;
    let handle = 0;
    const step = () => {
      jump();
      if (++frames < 5) handle = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(handle);
  }, [jump]);

  const updatePinned = useCallback(() => {
    const el = containerRef.current;
    if (!el) return pinnedRef.current;
    const bottom = isAtBottom(el);
    const readerDriven =
      draggingRef.current || Date.now() - gestureAtRef.current <= GESTURE_WINDOW_MS;
    // Ours, not the reader's — the pin is not theirs to lose. Every
    // programmatic scroll in this hook lands here.
    if (!readerDriven) return pinnedRef.current;
    pinnedRef.current = bottom;
    return bottom;
  }, []);

  // Opening a conversation always starts at the end, whatever the reader was
  // doing in the last one.
  useEffect(() => {
    pinnedRef.current = true;
    seenLatestRef.current = undefined;
    return settleToBottom();
  }, [viewKey, settleToBottom]);

  useEffect(() => {
    if (!latestKey || latestKey === seenLatestRef.current) return;
    seenLatestRef.current = latestKey;
    if (latestIsMine) pinnedRef.current = true;
    if (!pinnedRef.current) return;
    return settleToBottom();
  }, [latestKey, latestIsMine, settleToBottom]);

  /**
   * One observer for both boxes, attached through callback refs rather than an
   * effect over `*Ref.current`, because these lists render a skeleton until
   * their first page arrives: by the time the real content exists, a mount
   * effect has long since run against a null ref and would never look again.
   * This attaches whenever a node itself appears — and its first callback is
   * what lands a just-rendered list at the bottom.
   */
  const observe = useCallback(
    (ref: React.RefObject<HTMLDivElement | null>, node: HTMLDivElement | null) => {
      const previous = ref.current;
      ref.current = node;
      if (typeof ResizeObserver === "undefined") return;
      let observer = observerRef.current;
      if (!observer) {
        observer = new ResizeObserver(() => {
          // Only while pinned: someone who scrolled up to read history and
          // then hit "load earlier messages" is also watching the content
          // grow, and must not be thrown to the bottom for it.
          if (pinnedRef.current) jump();
        });
        observerRef.current = observer;
      }
      // Per node rather than `disconnect`: the content element is swapped out
      // when the skeleton gives way to the real list, and dropping every
      // observation for that would silently stop watching the viewport too.
      if (previous) observer.unobserve(previous);
      if (node) observer.observe(node);
    },
    [jump]
  );

  /**
   * Marks the scroller as reader-driven. Attached to the container itself
   * rather than the window so scrolling some other pane can't unpin this one.
   * `keydown` is included for Page Up / arrow keys, which scroll without any
   * pointer involvement.
   */
  const markGesture = useCallback((event: Event) => {
    gestureAtRef.current = Date.now();
    if (event.type === "pointerdown") draggingRef.current = true;
  }, []);

  // On the window, not the container: a scrollbar drag routinely ends with the
  // pointer somewhere else entirely, and a release that never arrives would
  // leave the pin permanently at the reader's mercy.
  useEffect(() => {
    const release = () => {
      draggingRef.current = false;
      gestureAtRef.current = Date.now();
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);

  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      const previous = containerRef.current;
      for (const event of GESTURE_EVENTS) {
        previous?.removeEventListener(event, markGesture);
        node?.addEventListener(event, markGesture, { passive: true });
      }
      observe(containerRef, node);
    },
    [observe, markGesture]
  );

  const setContentRef = useCallback(
    (node: HTMLDivElement | null) => {
      observe(contentRef, node);
    },
    [observe]
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return {
    /** The scrolling element. */
    containerRef: setContainerRef,
    /** The element that holds the messages, watched for growth. */
    contentRef: setContentRef,
    /** Attach to the container's `onScroll`. Returns whether the reader is now
     * at the bottom, for callers that show their own "jump to present" affordance. */
    onScroll: updatePinned,
  };
}

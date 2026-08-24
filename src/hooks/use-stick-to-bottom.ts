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
 * Keep a message list pinned to its newest message.
 *
 * Three separate things were leaving people mid-conversation, and a single
 * `scrollIntoView` on "the last id changed" only covered the first:
 *
 *  1. A new message arrives — jump, as long as the reader was at the bottom.
 *  2. A channel/DM is opened — jump unconditionally. Every view is a fresh
 *     mount (the tab bar renders only the active target), so this is what makes
 *     opening a conversation always land at the end.
 *  3. The laid-out boxes change size after the jump has already happened — an
 *     image or link embed finishing, a late-loading font, or the scroll
 *     viewport itself shrinking because the unread bar or typing indicator
 *     appeared above it. Both boxes are watched, because either one moving the
 *     end off screen looks identical to the reader and neither fires a scroll
 *     event or changes the newest message id.
 *
 * Pinning is tracked from the reader's own scrolling: scroll up and new
 * messages stop yanking the view; scroll back to the bottom and it follows
 * again.
 */
export function useStickToBottom({
  viewKey,
  latestKey,
}: {
  /** Identifies the open conversation/channel. A change means "jump". */
  viewKey: string;
  /** Identifies the newest message. A change means "jump if pinned". */
  latestKey: string | undefined;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const pinnedRef = useRef(true);
  /**
   * Where our own last `jump` left `scrollTop`. Scroll events are dispatched
   * at the start of the next rendering step, so a jump made in one frame is
   * reported *after* any content that arrived in the same frame has been laid
   * out: `updatePinned` would then measure our own already-stale scrollTop
   * against a taller list, conclude the reader had scrolled up, and unpin —
   * which is exactly what stopped the resize pass below from finishing the
   * job and left a freshly-opened channel stranded mid-history.
   */
  const jumpedToRef = useRef<number | null>(null);

  /** Assigning scrollTop rather than `scrollIntoView` on a sentinel: it can't
   * scroll an unrelated ancestor, and it's a no-op when nothing overflows. */
  const jump = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // Read back rather than storing what we asked for: the browser clamps to
    // scrollHeight - clientHeight, and it's the clamped value the scroll event
    // will report.
    jumpedToRef.current = el.scrollTop;
  }, []);

  const updatePinned = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    // Our own scroll, not the reader's — leave the pin alone. Any real
    // scrolling moves off this position and takes the branch below.
    if (jumpedToRef.current !== null && el.scrollTop === jumpedToRef.current) {
      return pinnedRef.current;
    }
    jumpedToRef.current = null;
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < PINNED_SLACK_PX;
    pinnedRef.current = pinned;
    return pinned;
  }, []);

  // Opening a conversation always starts at the end, whatever the reader was
  // doing in the last one. The extra frame covers a first paint that hasn't
  // been laid out yet — at that point scrollHeight is still the empty box.
  useEffect(() => {
    pinnedRef.current = true;
    jump();
    const frame = requestAnimationFrame(jump);
    return () => cancelAnimationFrame(frame);
  }, [viewKey, jump]);

  useEffect(() => {
    if (!latestKey || !pinnedRef.current) return;
    jump();
    const frame = requestAnimationFrame(jump);
    return () => cancelAnimationFrame(frame);
  }, [latestKey, jump]);

  /**
   * One observer for both boxes, attached through callback refs rather than an
   * effect over `*Ref.current`, because these lists render a skeleton until
   * their first page arrives: by the time the real content exists, a mount
   * effect has long since run against a null ref and would never look again.
   * This attaches whenever a node itself appears — and its first callback is
   * what lands a just-rendered list at the bottom.
   */
  const observe = useCallback(
    (
      ref: React.RefObject<HTMLDivElement | null>,
      node: HTMLDivElement | null
    ) => {
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

  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      observe(containerRef, node);
    },
    [observe]
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

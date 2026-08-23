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
 *  3. Content that had already been laid out gets *taller* — an image, a link
 *     embed or a late-loading font — which pushes the end back off screen after
 *     the jump has already happened. A `ResizeObserver` on the content is the
 *     only way to see that, and it's the case a message-id effect can't cover.
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

  /** Assigning scrollTop rather than `scrollIntoView` on a sentinel: it can't
   * scroll an unrelated ancestor, and it's a no-op when nothing overflows. */
  const jump = useCallback(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const updatePinned = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
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
   * A callback ref rather than an effect over `contentRef.current`, because
   * these lists render a skeleton until their first page arrives: by the time
   * the real content exists, a mount effect has long since run against a null
   * ref and would never look again. This attaches the observer whenever the
   * node itself appears — and its first callback is what lands a
   * just-rendered list at the bottom.
   */
  const setContentRef = useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node || typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(() => {
        // Only while pinned: someone who scrolled up to read history and then
        // hit "load earlier messages" is also watching the content grow, and
        // must not be thrown to the bottom for it.
        if (pinnedRef.current) jump();
      });
      observer.observe(node);
      observerRef.current = observer;
    },
    [jump]
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return {
    /** The scrolling element. */
    containerRef,
    /** The element that holds the messages, watched for growth. */
    contentRef: setContentRef,
    /** Attach to the container's `onScroll`. Returns whether the reader is now
     * at the bottom, for callers that show their own "jump to present" affordance. */
    onScroll: updatePinned,
  };
}

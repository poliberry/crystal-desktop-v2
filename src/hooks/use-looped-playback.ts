"use client";

import { useEffect, useMemo, useState } from "react";

import { useStaticFrame } from "@/hooks/use-static-frame";

/**
 * Play an animation once, hold still for a while, then play it again.
 *
 * A profile effect is a few seconds of sparkle or falling light. Left to
 * itself a GIF loops forever with no gap, which is fine for a moment and
 * exhausting for as long as a profile card is open — the card stops being
 * something you read and becomes something moving in the corner of your eye.
 * A long pause between plays keeps the effect a *thing that happens* rather
 * than a state the card is in.
 *
 * There is no way to pause or seek an `<img>` — the format animates itself and
 * CSS has no say in it (see `useStaticFrame`, which exists for the same
 * reason). So this does the only two things that work: it swaps in a still for
 * the pause, and it hands back a `cycle` number to use as a React `key`, since
 * a freshly created `<img>` element starts its animation from the beginning
 * even when the file is already in cache.
 */

/** How long the still is shown between plays. */
export const DEFAULT_PAUSE_MS = 20_000;

/**
 * How long to let an animation run when its real length can't be read.
 *
 * Only GIF durations are knowable cheaply (see below). An animated WebP or
 * APNG falls back to this: long enough for a typical effect to finish, short
 * enough that the pause still arrives.
 */
const FALLBACK_PLAY_MS = 6_000;

/** What browsers substitute for a GIF frame delay of 0 or 1 hundredths. */
const MINIMUM_FRAME_DELAY_MS = 100;

/** Don't hold a play window open longer than this, whatever the file claims —
 * a GIF with a ten-minute frame delay shouldn't wedge the cycle. */
const MAX_PLAY_MS = 30_000;

/** `null` records a source whose duration can't be read, so it isn't fetched
 * again on every render of every card wearing it. */
const durations = new Map<string, number | null>();
const inFlight = new Map<string, Promise<number | null>>();

/**
 * The total run time of one pass of a GIF, in milliseconds.
 *
 * Walks the block structure summing the delays in each Graphic Control
 * Extension. That is the whole of what's needed — the image data itself is
 * skipped over, never decoded — so this is a few hundred bytes of work on a
 * file the browser is about to fetch anyway.
 *
 * Returns null for anything that isn't a GIF, which the caller reads as "use
 * the fallback".
 */
function parseGifDuration(buffer: ArrayBuffer): number | null {
  const bytes = new Uint8Array(buffer);
  const header = String.fromCharCode(...bytes.subarray(0, 3));
  if (header !== "GIF") return null;

  let at = 6; // past "GIF89a"
  if (at + 7 > bytes.length) return null;

  const screenFlags = bytes[at + 4];
  at += 7;
  // Global colour table, when present: 3 bytes per entry, 2^(n+1) entries.
  if (screenFlags & 0x80) at += 3 * (1 << ((screenFlags & 0x07) + 1));

  /** Skip a chain of length-prefixed sub-blocks, ending at a zero length. */
  const skipSubBlocks = () => {
    while (at < bytes.length) {
      const size = bytes[at++];
      if (size === 0) return;
      at += size;
    }
  };

  let total = 0;
  while (at < bytes.length) {
    const marker = bytes[at++];

    if (marker === 0x3b) break; // trailer

    if (marker === 0x21) {
      const label = bytes[at++];
      if (label === 0xf9) {
        // Graphic Control Extension: one byte of block size (always 4), then
        // packed fields, then the delay as two little-endian bytes of
        // hundredths of a second.
        const size = bytes[at++];
        if (size >= 4) {
          const delay = bytes[at + 1] | (bytes[at + 2] << 8);
          total += delay < 2 ? MINIMUM_FRAME_DELAY_MS : delay * 10;
        }
        at += size;
        skipSubBlocks();
      } else {
        skipSubBlocks();
      }
      continue;
    }

    if (marker === 0x2c) {
      // Image descriptor: 9 bytes, the last of which flags a local colour
      // table, then the LZW minimum code size, then the image's sub-blocks.
      const imageFlags = bytes[at + 8];
      at += 9;
      if (imageFlags & 0x80) at += 3 * (1 << ((imageFlags & 0x07) + 1));
      at += 1; // LZW minimum code size
      skipSubBlocks();
      continue;
    }

    // Something unexpected — stop rather than walk off into image data and
    // return a nonsense number.
    break;
  }

  return total > 0 ? Math.min(total, MAX_PLAY_MS) : null;
}

async function durationOf(src: string): Promise<number | null> {
  const existing = inFlight.get(src);
  if (existing) return existing;

  const work = (async () => {
    try {
      const response = await fetch(src);
      if (!response.ok) return null;
      return parseGifDuration(await response.arrayBuffer());
    } catch {
      // Cross-origin refusal, or offline. Either way the fallback window is
      // the right answer — the effect still plays, just on a guessed length.
      return null;
    }
  })().then((result) => {
    durations.set(src, result);
    inFlight.delete(src);
    return result;
  });

  inFlight.set(src, work);
  return work;
}

export interface LoopedPlayback {
  /** What to render right now — the animation, or a still of its first frame
   * during the pause. */
  src: string | undefined;
  /** Changes on every play. Use it as the element's `key` so a new `<img>` is
   * created and the animation restarts from the top. */
  cycle: number;
}

/**
 * @param src The animation to play.
 * @param enabled False holds it on its first frame indefinitely — for the
 *   places showing many cards at once, where nothing should be moving.
 * @param pauseMs How long to hold still between plays.
 */
export function useLoopedPlayback(
  src: string | undefined,
  enabled = true,
  pauseMs = DEFAULT_PAUSE_MS,
): LoopedPlayback {
  const [playing, setPlaying] = useState(true);
  const [cycle, setCycle] = useState(0);
  const [playMs, setPlayMs] = useState<number | null>(null);

  // Only fetched for remote files: our own data-URI artwork is never animated,
  // and a `data:` URL has nothing to learn from a second fetch.
  const measurable = !!src && /^https?:\/\//.test(src) && enabled;

  useEffect(() => {
    if (!measurable || !src) {
      setPlayMs(null);
      return;
    }
    const cached = durations.get(src);
    if (cached !== undefined) {
      setPlayMs(cached);
      return;
    }
    let live = true;
    void durationOf(src).then((result) => {
      if (live) setPlayMs(result);
    });
    return () => {
      live = false;
    };
  }, [src, measurable]);

  /**
   * Whether there's anything to pause.
   *
   * A GIF whose whole run is one frame, and any still image, is left alone:
   * cycling it would swap an identical picture in and out forever for no
   * visible reason.
   */
  const animated = playMs === null || playMs > MINIMUM_FRAME_DELAY_MS;

  const window = playMs ?? FALLBACK_PLAY_MS;

  useEffect(() => {
    if (!enabled || !src || !animated) return;
    const timer = setTimeout(
      () => {
        setPlaying((wasPlaying) => {
          // Coming out of a pause is what starts a new play, so that's where
          // the key changes.
          if (!wasPlaying) setCycle((n) => n + 1);
          return !wasPlaying;
        });
      },
      playing ? window : pauseMs,
    );
    return () => clearTimeout(timer);
  }, [enabled, src, animated, playing, window, pauseMs]);

  // The still is only fetched when it's about to be needed — during a pause,
  // or while the effect is held for being off-screen.
  const frozen = !enabled || (animated && !playing);
  const poster = useStaticFrame(src, frozen);

  return useMemo(
    () => ({ src: frozen ? (poster ?? src) : src, cycle }),
    [frozen, poster, src, cycle],
  );
}

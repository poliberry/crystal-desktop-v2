"use client";

import { useEffect, useState } from "react";

/**
 * A still of the first frame of an image, for holding an animation still.
 *
 * There is no way to pause a GIF (or an APNG, or an animated WebP) in an
 * `<img>`: the format animates itself and CSS has no say in it. The only thing
 * that stops one is not showing it — so anywhere an animation isn't wanted, a
 * one-frame copy drawn to a canvas stands in for it, and the real file is put
 * back when it is.
 *
 * Posters are cached by URL and shared across every avatar on screen: the same
 * decoration worn by twenty people in a member list is decoded once.
 */

/** Longest edge of a poster. Decorations are drawn at avatar size — 24 to 96
 * pixels — so anything beyond this is a bigger data URL for no more detail. */
const MAX_POSTER_EDGE = 192;

/** `null` records a source that can't be posterised, so it isn't retried on
 * every render of every avatar wearing it. Keyed by edge as well as address,
 * since the same file can be wanted at two sizes. */
const posters = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

async function renderFirstFrame(src: string, maxEdge: number): Promise<string | null> {
  try {
    const image = new Image();
    // Without this the canvas is tainted and `toDataURL` throws. Convex storage
    // serves the header; anything that doesn't simply keeps animating.
    image.crossOrigin = "anonymous";
    image.src = src;
    // Resolves once a frame is ready to paint — for an animation, the first.
    await image.decode();

    const longest = Math.max(image.naturalWidth, image.naturalHeight) || 1;
    const scale = Math.min(1, maxEdge / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    // PNG rather than WebP: decorations are transparent, and this is the one
    // format every renderer this app runs in writes losslessly with alpha.
    return canvas.toDataURL("image/png");
  } catch {
    // A cross-origin refusal, a format the renderer won't decode, a file that
    // isn't there any more. All of them mean "no poster", which the caller
    // shows as the original — animated, but present.
    return null;
  }
}

function posterKey(src: string, maxEdge: number): string {
  return `${maxEdge}|${src}`;
}

function posterFor(src: string, maxEdge: number): Promise<string | null> {
  const key = posterKey(src, maxEdge);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const work = renderFirstFrame(src, maxEdge).then((poster) => {
    posters.set(key, poster);
    inFlight.delete(key);
    return poster;
  });
  inFlight.set(key, work);
  return work;
}

/**
 * The still standing in for `src`, or `undefined` when there isn't one to use —
 * which is every case where showing `src` itself is the right answer: it's
 * already static, it's one of our own data URIs, the poster hasn't been drawn
 * yet, or it can't be drawn at all.
 */
export function useStaticFrame(
  src: string | undefined,
  enabled: boolean,
  maxEdge: number = MAX_POSTER_EDGE
): string | undefined {
  const wanted = enabled && !!src && /^https?:\/\//.test(src) ? src : undefined;
  const [poster, setPoster] = useState<string | undefined>(() =>
    wanted ? posters.get(posterKey(wanted, maxEdge)) ?? undefined : undefined
  );

  useEffect(() => {
    if (!wanted) {
      setPoster(undefined);
      return;
    }
    const cached = posters.get(posterKey(wanted, maxEdge));
    if (cached !== undefined) {
      setPoster(cached ?? undefined);
      return;
    }
    let live = true;
    void posterFor(wanted, maxEdge).then((result) => {
      if (live) setPoster(result ?? undefined);
    });
    return () => {
      live = false;
    };
  }, [wanted, maxEdge]);

  return wanted ? poster : undefined;
}

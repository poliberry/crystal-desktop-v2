"use client";

import { useEffect, useRef, useState } from "react";

import { playbackTime, type MotionSpec } from "../../../convex/lib/motion";
import { coverScale, drawCover, loadMotionImages, MotionRenderer } from "@/lib/motion-render";
import { loadMotionSpec } from "@/lib/motion-load";
import { motionImageUrls } from "../../../convex/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Plays a motion design (an animated profile effect or nameplate) on a canvas that fills its parent, covering it
 * the way `object-fit: cover` would.
 *
 * Playing costs the page something every frame, and a member list can hold dozens of these, so:
 *  - one shared loop drives every player, instead of a timer each;
 *  - a player that is off screen, or in a hidden tab, does nothing;
 *  - only a few play at once (the rest show a still frame), and a card the app is showing many of passes
 *    `animate={false}`;
 *  - with "reduce motion" on, nothing moves: a still frame from the middle of the design is shown instead;
 *  - a nameplate, which is faint wallpaper behind a name, is drawn at 24 frames a second and a smaller size.
 */

// --- One loop for all ------------------------------------------------------------------------

interface Sub {
  tick: (now: number) => void;
}
const subs = new Set<Sub>();
let raf = 0;

function loop(now: number) {
  raf = 0;
  for (const s of subs) s.tick(now);
  if (subs.size > 0) raf = requestAnimationFrame(loop);
}
function subscribe(s: Sub): () => void {
  subs.add(s);
  if (!raf) raf = requestAnimationFrame(loop);
  return () => {
    subs.delete(s);
  };
}

/** How many players may animate at the same time; beyond this a player draws one still frame and waits. */
const MAX_PLAYING = 8;
let playing = 0;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The frame to show where nothing moves: a representative moment, not the first (which is often empty). */
export const stillTime = (spec: Pick<MotionSpec, "duration">) => spec.duration * 0.45;

// --- The design --------------------------------------------------------------------------------

/** A design by address (fetched once, shared), or null while loading or if it is unusable. */
export function useMotionSpec(url: string | undefined | null): MotionSpec | null {
  const [spec, setSpec] = useState<{ url: string; spec: MotionSpec | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    void loadMotionSpec(url).then((s) => live && setSpec({ url, spec: s }));
    return () => {
      live = false;
    };
  }, [url]);
  return spec && spec.url === url ? spec.spec : null;
}

export interface MotionPlayerProps {
  /** A published design's address… */
  url?: string | null;
  /** …or the design itself (the editor's preview). */
  spec?: MotionSpec | null;
  /** Pictures already loaded by the caller, if any (the editor has its own copies). */
  animate?: boolean;
  /** Draw this moment instead of playing: for the editor's playhead. */
  time?: number;
  className?: string;
}

export function MotionPlayer({ url, spec: given, animate = true, time, className }: MotionPlayerProps) {
  const fetched = useMotionSpec(given ? null : url);
  const spec = given ?? fetched;
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState<{ spec: MotionSpec; renderer: MotionRenderer } | null>(null);

  // The renderer, once the design's pictures are in.
  useEffect(() => {
    if (!spec) return;
    let live = true;
    void loadMotionImages(motionImageUrls(spec)).then((images) => {
      if (!live) return;
      setReady({ spec, renderer: new MotionRenderer(spec, images, 0.5) });
    });
    return () => {
      live = false;
    };
  }, [spec]);

  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent || !ready) return;
    const { spec: s, renderer } = ready;
    const nameplate = s.kind === "nameplate";
    const frameMs = nameplate ? 1000 / 24 : 1000 / 60;
    let visible = true;
    let size = { w: 0, h: 0 };
    let started = performance.now();
    let last = -Infinity;
    let counted = false;
    let still = true;

    const fit = () => {
      const r = parent.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1) * (nameplate ? 0.75 : 1);
      const w = Math.max(1, Math.round(r.width * dpr));
      const h = Math.max(1, Math.round(r.height * dpr));
      if (w === size.w && h === size.h) return false;
      size = { w, h };
      canvas.width = w;
      canvas.height = h;
      renderer.setScale(coverScale(s.stage, w, h, 2));
      return true;
    };
    const draw = (t: number) => {
      drawCover(canvas, renderer.render(t));
    };

    const wantsMotion = animate && time === undefined && !reducedMotion();
    const release = () => {
      if (counted) {
        playing--;
        counted = false;
      }
    };
    const unsubscribe = subscribe({
      tick: (now) => {
        if (document.hidden || !visible) {
          // Whatever was playing restarts from its beginning when it comes back, as a profile opened afresh does.
          started = now;
          return;
        }
        if (fit()) last = -Infinity;
        if (time !== undefined) {
          if (last === time) return;
          last = time;
          draw(time);
          return;
        }
        if (!wantsMotion) {
          if (still || last === -Infinity) {
            draw(stillTime(s));
            last = 0;
            still = false;
          }
          return;
        }
        if (!counted) {
          if (playing >= MAX_PLAYING) {
            if (last === -Infinity) {
              draw(stillTime(s));
              last = 0;
            }
            return;
          }
          playing++;
          counted = true;
          started = now;
        }
        if (now - last < frameMs - 1) return;
        last = now;
        draw(playbackTime(s, (now - started) / 1000));
      },
    });

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        visible = e.isIntersecting;
        if (!visible) release();
        else last = -Infinity;
      }
    });
    io.observe(parent);
    const ro = new ResizeObserver(() => {
      last = -Infinity;
    });
    ro.observe(parent);
    fit();

    return () => {
      unsubscribe();
      release();
      io.disconnect();
      ro.disconnect();
    };
  }, [ready, animate, time]);

  if (!url && !given) return null;
  return <canvas ref={ref} aria-hidden className={cn("pointer-events-none absolute inset-0 size-full select-none", className)} />;
}

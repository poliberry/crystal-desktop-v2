"use client";

import { useEffect, useRef, useState } from "react";

import { useAccessibility } from "@/components/accessibility-provider";
import { isVideoUrl } from "@/lib/media";
import { cn } from "@/lib/utils";

/** Whether looping motion should be running at all: not in a hidden window, and not
 * for someone who has asked the app (or their system) to hold still. */
function useMotionAllowed(): boolean {
  const { reducedMotion } = useAccessibility();
  const [system, setSystem] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setSystem(q.matches);
    const onQ = (e: MediaQueryListEvent) => setSystem(e.matches);
    q.addEventListener("change", onQ);
    const onVis = () => setHidden(document.hidden);
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      q.removeEventListener("change", onQ);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return !(reducedMotion || system || hidden);
}

/**
 * A scene's background: a picture, or a looping clip.
 *
 * A clip is muted, loops, and plays inline — the only way a browser starts one on
 * its own — and it stops when the window is hidden or when the person has asked
 * for reduced motion, in which case it holds on its first frame like a still. It
 * is wallpaper: nothing in the room waits on it.
 */
export function SceneBackground({ url, video: isVideo, className }: { url: string; /** Say so where the address can't (a local blob has no extension). */ video?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const motion = useMotionAllowed();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (motion) void el.play().catch(() => {});
    else {
      el.pause();
      if (el.currentTime !== 0 && el.readyState > 0) el.currentTime = 0;
    }
  }, [motion, url]);

  if (!(isVideo ?? isVideoUrl(url))) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" draggable={false} className={cn("size-full object-cover", className)} />;
  }
  return (
    <video
      ref={ref}
      src={url}
      muted
      loop
      playsInline
      autoPlay={motion}
      preload="auto"
      aria-hidden
      tabIndex={-1}
      className={cn("pointer-events-none size-full object-cover", className)}
    />
  );
}

/**
 * The room blurred, for the edges of a window that isn't 16:9. A clip is drawn to
 * a canvas once, not played a second time: a second decoder for something that is
 * blurred beyond recognition would be a lot to spend on a margin.
 */
export function SceneBackdrop({ url }: { url: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = isVideoUrl(url);
  useEffect(() => {
    if (!video) return;
    const el = document.createElement("video");
    el.crossOrigin = "anonymous";
    el.muted = true;
    el.preload = "auto";
    el.src = url;
    const draw = () => {
      const c = canvas.current;
      if (!c || !el.videoWidth) return;
      c.width = 160;
      c.height = Math.round((160 * el.videoHeight) / el.videoWidth);
      c.getContext("2d")?.drawImage(el, 0, 0, c.width, c.height);
    };
    el.addEventListener("loadeddata", draw);
    return () => {
      el.removeEventListener("loadeddata", draw);
      el.src = "";
    };
  }, [url, video]);

  return video ? <canvas ref={canvas} className="size-full object-cover" /> : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" draggable={false} className="size-full object-cover" />
  );
}

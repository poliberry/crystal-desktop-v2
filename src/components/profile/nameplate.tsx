"use client";

import { useEffect, useRef } from "react";

import { isMotionUrl } from "../../../convex/lib/motion";
import { MotionPlayer } from "@/components/motion/motion-player";
import { useAncestorHover } from "@/hooks/use-ancestor-hover";
import { useMotionAllowed } from "@/hooks/use-motion-allowed";
import { useStaticFrame } from "@/hooks/use-static-frame";
import { useCachedImageSrc } from "@/lib/image-cache";
import { cn } from "@/lib/utils";

/**
 * The strip behind somebody's name — in a member list, a friend row, the user
 * card, the DM sidebar.
 *
 * A nameplate may be a picture or a short video. The two need different
 * elements, and the difference has to be decided in one place: this used to be
 * an `<img>` copied into six files, so a `.webm` would have rendered as a
 * broken image in all six.
 *
 * ## When it moves
 *
 * A member list is fifty rows and fifty looping nameplates is a room full of
 * moving parts nobody asked to look at. So by default a nameplate holds still
 * until the row it sits in is pointed at, the same rule an avatar decoration
 * follows. Pass `animate` for the places that are *about* one nameplate
 * (the shop preview, the upload dialog).
 *
 * Holding still means a different thing for each kind: a video is paused on its
 * first frame, a Studio design draws one still frame, and a GIF / animated WebP
 * — which can't be paused in an `<img>` — is swapped for a one-frame copy (see
 * `useStaticFrame`).
 *
 * Video nameplates are muted, looping and without controls. That's the only
 * configuration a browser will start on its own, and it's the right one
 * anyway: this is wallpaper behind a name, not something anyone came to
 * watch. `playsInline` keeps iOS from taking it fullscreen.
 */

/** Decided by extension rather than by a stored kind: the URL comes from
 * storage with the original filename's extension intact, and one fewer field
 * is one fewer thing for the two profile tables to disagree about. */
export function isVideoNameplate(url: string | null | undefined): boolean {
  return !!url && /\.(webm|mp4|m4v|mov)(\?.*)?$/i.test(url);
}

/** What a nameplate upload will accept. Shared with the file picker so the
 * dialog and the renderer can't drift apart. */
export const NAMEPLATE_ACCEPT =
  "image/png,image/gif,image/webp,image/jpeg,video/webm,video/mp4";

/** Nameplates are wide strips drawn behind a row, so the still needs more
 * horizontal detail than the 192px a decoration poster is capped at. */
const POSTER_EDGE = 640;

export function Nameplate({
  url,
  className,
  animate = "hover",
}: {
  url?: string;
  /** The positioning and fade the host wants — every site draws this behind a
   * row and masks it towards the text, but the boxes differ. */
  className?: string;
  /**
   * When it may move. `"hover"` — the default — waits for the pointer to be
   * over the row this sits in; `true` plays it always; `false` never does.
   */
  animate?: boolean | "hover";
}) {
  const motion = isMotionUrl(url);
  const isVideo = isVideoNameplate(url);
  const isImage = !isVideo && !motion;

  const host = useRef<HTMLSpanElement>(null);
  const hovered = useAncestorHover(host, animate === "hover" && !!url);
  // "Reduce motion" (the app's setting or the OS's) is a ceiling over `animate`, including `animate` itself.
  const motionAllowed = useMotionAllowed();
  const playing = motionAllowed && (animate === true || (animate === "hover" && hovered));

  // Images only — a nameplate video is tens of times the size of one of these
  // pictures, and it's already a `<video src>` streaming from the network
  // rather than a single fetch to hold as a blob. Called unconditionally
  // (hooks are), with `undefined` for a video or when there's nothing to
  // show, which the hook is happy to do nothing with.
  const cachedUrl = useCachedImageSrc(url && isImage ? url : undefined);
  const poster = useStaticFrame(isImage ? url : undefined, !playing, POSTER_EDGE);

  if (!url) return null;

  // The media sits in a box of its own rather than being the positioned element itself: this has to have a
  // single, always-present element to find its row from, whichever of the three things it turns out to draw.
  return (
    <span
      ref={host}
      aria-hidden
      className={cn(
        "fade-mask-l pointer-events-none absolute inset-0 block h-full w-full overflow-hidden opacity-20",
        className,
      )}
    >
      {motion ? (
        // An animated nameplate made in Crystal Studio is a design played live on a canvas, not a file the browser plays.
        <MotionPlayer url={url} animate={playing} />
      ) : isVideo ? (
        <NameplateVideo url={url} playing={playing} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster ?? cachedUrl ?? url}
          alt=""
          aria-hidden
          draggable={false}
          className="size-full object-cover"
        />
      )}
    </span>
  );
}

/**
 * A video held on its first frame until it is allowed to play.
 *
 * No `autoPlay` attribute: whether it runs is decided here, and the `#t` fragment is what gets a browser that has
 * only loaded metadata to paint a frame to rest on. Pausing goes back to the start so that the next hover begins
 * where the nameplate does, as a freshly opened profile would.
 */
function NameplateVideo({ url, playing }: { url: string; playing: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (playing) {
      // Refused when the tab isn't allowed to start media yet; it will simply stay on its still.
      void video.play().catch(() => {});
    } else if (!video.paused) {
      // Only when it had been running: on first mount there is nothing to rewind, and touching the position
      // would undo the `#t` seek that gave it a frame to show.
      video.pause();
      video.currentTime = 0.001;
    }
  }, [playing, url]);

  return (
    <video
      ref={ref}
      src={url.includes("#") ? url : `${url}#t=0.001`}
      loop
      muted
      playsInline
      preload="metadata"
      // A video element is focusable and draggable by default in a way an
      // `<img>` decoration shouldn't be.
      tabIndex={-1}
      aria-hidden
      className="size-full object-cover"
    />
  );
}

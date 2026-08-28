"use client";

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
 * Video nameplates are muted, looping and autoplaying with no controls. That's
 * the only configuration a browser will start on its own, and it's the right
 * one anyway: this is wallpaper behind a name, not something anyone came to
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

export function Nameplate({
  url,
  className,
}: {
  url?: string;
  /** The positioning and fade the host wants — every site draws this behind a
   * row and masks it towards the text, but the boxes differ. */
  className?: string;
}) {
  if (!url) return null;

  const shared = cn(
    "fade-mask-l pointer-events-none absolute inset-0 h-full w-full object-cover opacity-20",
    className,
  );

  if (isVideoNameplate(url)) {
    return (
      <video
        src={url}
        autoPlay
        loop
        muted
        playsInline
        // A video element is focusable and draggable by default in a way an
        // `<img>` decoration shouldn't be.
        tabIndex={-1}
        aria-hidden
        className={shared}
      />
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" aria-hidden draggable={false} className={shared} />;
}

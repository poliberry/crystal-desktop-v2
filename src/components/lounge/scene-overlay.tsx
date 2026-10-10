"use client";

import type { SceneOverlay } from "../../../convex/lib/creationSpecs";

/**
 * Artwork a creator drew on a room: pictures placed over the background, in percent of the room, so
 * they follow it at any size. Drawn above the background and below everything that happens in the
 * room (the screen, props, people), so a drawn lamp or rug sits *in* the room, not on top of the
 * people in it. Never takes the pointer: clicks go through to the floor.
 */
export function SceneOverlayArt({ overlay }: { overlay?: readonly SceneOverlay[] }) {
  if (!overlay?.length) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {overlay.map((o, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={o.url}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          className="absolute max-w-none select-none"
          style={{ left: `${o.x}%`, top: `${o.y}%`, width: `${o.w}%`, height: `${o.h}%`, opacity: o.opacity }}
        />
      ))}
    </div>
  );
}

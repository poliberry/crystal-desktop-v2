"use client";

import { useEffect, useState } from "react";
import type { IconType } from "react-icons";

import { useCachedImageSrc } from "@/lib/image-cache";
import { cachedReactIcon, loadReactIcon } from "@/lib/react-icons";
import { cn } from "@/lib/utils";

/**
 * A badge, drawn as whichever of its two forms it was defined with.
 *
 * `imageUrl` wins where both are set: a badge that went to the trouble of
 * having a picture made means to be shown as one, and an icon left over from
 * before that is a fallback, not a competitor.
 *
 * The icon resolves asynchronously — the pack it lives in is fetched on demand
 * (see src/lib/react-icons.ts) — so this renders nothing until it lands rather
 * than a placeholder that would pop. Nothing is also what an unresolvable name
 * gets, which is how a badge from a newer build degrades on an older one.
 */
export function BadgeIcon({
  icon,
  imageUrl,
  label,
  className,
}: {
  icon?: string;
  imageUrl?: string;
  label: string;
  className?: string;
}) {
  const [Glyph, setGlyph] = useState<IconType | null>(() =>
    icon ? (cachedReactIcon(icon) ?? null) : null
  );
  const cachedImageUrl = useCachedImageSrc(imageUrl);

  useEffect(() => {
    if (!icon || imageUrl) return;
    let live = true;
    void loadReactIcon(icon).then((resolved) => {
      if (live) setGlyph(() => resolved);
    });
    return () => {
      live = false;
    };
  }, [icon, imageUrl]);

  if (imageUrl) {
    return (
      <img
        src={cachedImageUrl ?? imageUrl}
        alt={label}
        title={label}
        draggable={false}
        // `object-contain`, because a badge picture is a glyph on its own
        // canvas and cropping one to a square would clip the thing itself.
        className={cn("size-4 shrink-0 select-none object-contain", className)}
      />
    );
  }

  if (!Glyph) return null;
  return <Glyph aria-label={label} className={cn("size-4 shrink-0", className)} />;
}

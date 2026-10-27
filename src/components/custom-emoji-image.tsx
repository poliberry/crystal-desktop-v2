"use client";

import { useCachedImageSrc } from "@/lib/image-cache";

/**
 * One custom emoji's picture, served from the IndexedDB blob cache once it's
 * there (see src/lib/image-cache.ts).
 *
 * Every custom-emoji `<img>` in the app — message text, reactions, the picker,
 * the composer autocomplete — goes through here so the same handful of tiny,
 * heavily-repeated files are fetched once and kept, rather than re-requested on
 * every list that mentions them.
 *
 * `className` carries the per-site sizing (`size-4`, `size-6 align-middle`, …);
 * the default is the message-text size.
 */
export function CustomEmojiImage({
  src,
  name,
  className = "inline-block size-6 align-middle object-contain",
}: {
  src: string;
  name: string;
  className?: string;
}) {
  const cached = useCachedImageSrc(src);
  return (
    <img
      src={cached ?? src}
      alt={`:${name}:`}
      title={`:${name}:`}
      className={className}
      draggable={false}
    />
  );
}

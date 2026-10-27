"use client";

import { useCachedBackgroundImage } from "@/lib/image-cache";

/**
 * A `<div>` whose `background-image` is served from the IndexedDB blob cache
 * once it's there (see src/lib/image-cache.ts), and the plain url until then.
 *
 * The `useCachedBackgroundImage` hook can't be called conditionally, so the
 * pattern at every call site is `{url && <CachedBackground url={url} … />}` —
 * this component only mounts when there's actually a picture to draw, and costs
 * nothing when there isn't.
 */
export function CachedBackground({
  url,
  style,
  ...rest
}: { url: string } & React.HTMLAttributes<HTMLDivElement>) {
  const backgroundImage = useCachedBackgroundImage(url);
  return <div style={{ ...style, backgroundImage }} {...rest} />;
}

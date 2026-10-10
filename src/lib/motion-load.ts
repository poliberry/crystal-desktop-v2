import { MOTION_LIMITS, motionImageUrls, normalizeMotionSpec, type MotionSpec } from "../../convex/lib/motion";

/**
 * Fetching a published motion design.
 *
 * The file was checked when it was published and is named after its own hash, but the app does not rely on that:
 * whatever arrives is normalised again, and a picture is only accepted from the same address the file came from, so
 * a design can never make the app load something from somewhere else.
 */

const cache = new Map<string, Promise<MotionSpec | null>>();

/** The design at `url`, or null if it can't be fetched or isn't a valid design. Fetched once per address. */
export function loadMotionSpec(url: string): Promise<MotionSpec | null> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(url, { credentials: "omit" });
        if (!res.ok) return null;
        const text = await res.text();
        // A design bigger than anything that could have been published is not one.
        if (text.length > 400_000) return null;
        const origin = new URL(url).origin;
        return normalizeMotionSpec(JSON.parse(text), (u) => {
          if (!u.startsWith(`${origin}/`) || u.length > 500) throw new Error("A picture in this design is from somewhere else.");
          return u;
        });
      } catch {
        return null;
      }
    })();
    cache.set(url, p);
    // A failure is not remembered for long: the network may come back.
    void p.then((v) => {
      if (!v) setTimeout(() => cache.delete(url), 30_000);
    });
    if (cache.size > 64) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

export { MOTION_LIMITS, motionImageUrls };

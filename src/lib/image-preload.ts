import { decorationLayers, decorationSrc } from "@/lib/avatar-decorations";
import { preloadIntoCache } from "@/lib/image-cache";
import { frameLayersFrom } from "@/lib/profile-cosmetics";
import type { CosmeticLayer } from "@/lib/cosmetic-layers";

/**
 * Warming the caches for artwork that isn't on screen yet — the browser's,
 * and our own IndexedDB one (see src/lib/image-cache.ts).
 *
 * Cosmetics are the one kind of image in this app that arrives at the worst
 * possible moment. A decoration, a frame and an effect are all fetched when a
 * profile card opens — so the card paints, and then a frame appears around it a
 * beat later, and something drifts across it a beat after that. Every one of
 * those files is already known before the card is opened: they come down with
 * the member list.
 *
 * So they are fetched early. The `<img>` warm-up's response goes nowhere but
 * the HTTP cache — no bookkeeping, no cache of our own, and nothing to
 * invalidate. The IndexedDB one is fetched properly and kept, which is what
 * makes it (unlike the HTTP cache) still there the next time the app opens.
 */

/**
 * Everything asked for so far.
 *
 * The whole point of this module is that it can be called from a render pass
 * over a list of two hundred members without doing two hundred things. A url
 * asked for twice is asked for once; a url already in either cache costs a
 * lookup that would have happened anyway.
 */
const requested = new Set<string>();

/** Ask for one file, at most once per session. */
export function preloadImage(url: string | undefined | null): void {
  if (!url || typeof window === "undefined" || requested.has(url)) return;
  requested.add(url);
  const image = new Image();
  // Nothing is waiting on this, so it should never be in front of anything
  // that is — decoding off the main thread, and at the browser's convenience.
  image.decoding = "async";
  image.fetchPriority = "low";
  image.src = url;
  void preloadIntoCache(url);
}

/** What a profile is wearing, in whichever of the fields it happens to carry
 * them — the same shape a member row and a profile card both have. */
export interface CosmeticSource {
  avatarDecoration?: string;
  profileEffect?: string;
  profileFrame?: string;
  profileFrameFit?: string;
  profileFrameAnchor?: string;
  profileFrameScale?: number;
  profileFrameOffsetY?: number;
  profileFrameLayers?: CosmeticLayer[];
}

/** Every file one profile's cosmetics will need, resolved to something a
 * browser can fetch — a decoration's artwork may be a preset key rather than
 * a url, and a frame may be either a list of layers or one image. */
export function cosmeticUrls(source: CosmeticSource): string[] {
  const urls: string[] = [];
  if (source.profileEffect) urls.push(source.profileEffect);
  for (const layer of frameLayersFrom(source)) urls.push(layer.url);
  for (const layer of decorationLayers(source.avatarDecoration)) {
    urls.push(decorationSrc(layer.url) ?? layer.url);
  }
  return urls;
}

/** Warm one profile's worth. */
export function preloadCosmetics(source: CosmeticSource | null | undefined): void {
  if (!source) return;
  for (const url of cosmeticUrls(source)) preloadImage(url);
}

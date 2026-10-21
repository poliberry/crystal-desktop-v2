import { useSyncExternalStore } from "react";

import { isVideoUrl } from "@/lib/media";

/**
 * A cosmetic video's address carries what a player needs to know about it in its fragment, which never reaches the CDN:
 *
 *   https://cdn…/lofi-rooftop-0123abcd.webm#cosmetic-poster=<url>&cosmetic-loop=1.6&cosmetic-hevc=<url>&cosmetic-stacked=<url>
 *
 *  - `cosmetic-poster`: a transparent still, shown in lists, with reduced motion and until playback starts;
 *  - `cosmetic-loop`: where the idle begins: the file is an intro and one pass of the idle, and a player seeks back here
 *    at the end, so the intro plays once;
 *  - `cosmetic-hevc`: the same video as HEVC with alpha (MP4). VP9's alpha is only composited by Chromium and Firefox;
 *    Safari, and every browser on iOS, needs this one to show the video transparent rather than on black.
 *  - `cosmetic-stacked`: the same video as plain H.264 (MP4) twice the height: the colour (premultiplied by alpha) in the
 *    top half and the alpha as grey in the bottom half. Android's decoders drop VP9's alpha, so the mobile app draws
 *    this one through a shader that puts the two halves back together. Every decoder plays H.264.
 */
const POSTER_TAG = "cosmetic-poster";
const LOOP_TAG = "cosmetic-loop";
const HEVC_TAG = "cosmetic-hevc";
const STACKED_TAG = "cosmetic-stacked";

/** Keep the fallback poster, loop point, Safari file and Android file beside a video URL without changing its CDN key. */
export function withCosmeticPoster(url: string, posterUrl?: string, loopFrom?: number, hevcUrl?: string, stackedUrl?: string): string {
  if (!isVideoUrl(url) || (!posterUrl && loopFrom === undefined && !hevcUrl && !stackedUrl)) return url;
  const tags = [
    posterUrl ? `${POSTER_TAG}=${encodeURIComponent(posterUrl)}` : "",
    loopFrom !== undefined ? `${LOOP_TAG}=${loopFrom}` : "",
    hevcUrl ? `${HEVC_TAG}=${encodeURIComponent(hevcUrl)}` : "",
    stackedUrl ? `${STACKED_TAG}=${encodeURIComponent(stackedUrl)}` : "",
  ].filter(Boolean);
  return `${url.split("#", 1)[0]}#${tags.join("&")}`;
}

export interface CosmeticVideoSource {
  url: string;
  posterUrl?: string;
  loopFrom?: number;
  hevcUrl?: string;
  stackedUrl?: string;
}

/** Extract the CDN video address and its companions from a stored cosmetic URL. */
export function cosmeticVideoSource(value: string): CosmeticVideoSource {
  const [url, fragment] = value.split("#", 2);
  if (!fragment) return { url };
  const params = new URLSearchParams(fragment);
  const loopValue = Number(params.get(LOOP_TAG));
  const loopFrom = params.has(LOOP_TAG) && Number.isFinite(loopValue) && loopValue > 0 ? loopValue : undefined;
  const https = (v: string | null) => (v && /^https:\/\//.test(v) ? v : undefined);
  return { url, posterUrl: https(params.get(POSTER_TAG)), loopFrom, hevcUrl: https(params.get(HEVC_TAG)), stackedUrl: https(params.get(STACKED_TAG)) };
}

/** WebKit, which can't show VP9's alpha: Safari on the Mac, and every browser on iOS and iPadOS. */
function isWebKitOnly(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const safari = /AppleWebKit/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox|Electron/.test(ua);
  return ios || safari;
}
const noSubscribe = () => () => {};

/**
 * The file this browser should play. On the server, and through hydration, it is the WebM; WebKit then switches to the
 * HEVC copy where there is one, so the markup the server sent always matches the first render.
 */
export function useCosmeticVideoUrl(source: CosmeticVideoSource | undefined): string | undefined {
  const webkit = useSyncExternalStore(noSubscribe, isWebKitOnly, () => false);
  if (!source) return undefined;
  return webkit && source.hevcUrl ? source.hevcUrl : source.url;
}

/** Continue at the idle segment after a one-time intro has played. */
export function continueCosmeticVideo(video: HTMLVideoElement, loopFrom?: number): void {
  if (loopFrom === undefined) return;
  video.currentTime = loopFrom;
  void video.play().catch(() => {});
}

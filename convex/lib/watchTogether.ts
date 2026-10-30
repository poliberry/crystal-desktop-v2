/**
 * "Watch together": one video the whole voice channel follows.
 *
 * The state is a tiny clock — `playing`, `positionMs` as of `updatedAt` — that the host changes and
 * everyone else's player is steered to. No video frames ever pass through the server; each person's
 * player loads the video itself. Pure (no database, no DOM), so the server and the client use the same
 * rules and they are tested alone (scripts/tests/watch-together.test.mts).
 */

export type WatchSource =
  | { provider: "youtube"; source: string }
  | { provider: "direct"; source: string };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
/** Files a browser's own player can play. Anything else would need a page to embed, which isn't something to trust. */
const DIRECT_EXTENSIONS = /\.(mp4|m4v|webm|mov|ogv|ogg|mp3|m4a|wav|opus)$/i;

/** The video id in a YouTube link in any of its shapes, or null. */
export function youtubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be") {
    const id = url.pathname.split("/")[1] ?? "";
    return YOUTUBE_ID.test(id) ? id : null;
  }
  if (!YOUTUBE_HOSTS.has(host)) return null;
  const v = url.searchParams.get("v");
  if (v && YOUTUBE_ID.test(v)) return v;
  const [, kind, id] = url.pathname.split("/");
  if ((kind === "embed" || kind === "shorts" || kind === "live" || kind === "v") && id && YOUTUBE_ID.test(id)) return id;
  return null;
}

/**
 * What a pasted link is, or why it can't be watched. Only https: a plain-http link would be blocked as
 * mixed content, and a `javascript:` or `file:` one must never reach a player at all.
 */
export function parseWatchSource(raw: string): { ok: true; value: WatchSource } | { ok: false; reason: string } {
  const text = raw.trim();
  if (!text) return { ok: false, reason: "Paste a link to a video." };
  if (text.length > 2000) return { ok: false, reason: "That link is too long." };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "That doesn't look like a link." };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "Only https links can be watched." };
  if (url.username || url.password) return { ok: false, reason: "That link can't be watched." };
  const id = youtubeId(url);
  if (id) return { ok: true, value: { provider: "youtube", source: id } };
  if (DIRECT_EXTENSIONS.test(url.pathname)) return { ok: true, value: { provider: "direct", source: url.toString() } };
  return { ok: false, reason: "Use a YouTube link or a direct link to a video file (mp4, webm…)." };
}

export interface WatchClock {
  playing: boolean;
  positionMs: number;
  /** Server time, in ms, that `positionMs` was true at. */
  updatedAt: number;
}

/** Where the video should be at `now`, on the same clock as `updatedAt`. */
export function expectedPositionMs(clock: WatchClock, now: number, durationMs?: number): number {
  const elapsed = clock.playing ? Math.max(0, now - clock.updatedAt) : 0;
  const at = clock.positionMs + elapsed;
  return durationMs !== undefined && durationMs > 0 ? Math.min(at, durationMs) : at;
}

/** A follower this far off the host is moved; closer than this they are left alone, so playback doesn't stutter chasing a few frames. */
export const DRIFT_TOLERANCE_MS = 1500;

/** Whether a follower at `actualMs` has drifted far enough from `expectedMs` to be seeked. */
export function needsSeek(expectedMs: number, actualMs: number, tolerance = DRIFT_TOLERANCE_MS): boolean {
  return Math.abs(expectedMs - actualMs) > tolerance;
}

/**
 * The offset between this device's clock and the server's, from one observation: the server said it was
 * `serverNow` at about the moment this device received that and read its own clock as `localNow`. Subtract it from the
 * local clock to get server time. Good to about a network round trip, which is far inside DRIFT_TOLERANCE_MS.
 */
export const clockSkewMs = (localNow: number, serverNow: number): number => localNow - serverNow;

export type WatchAction = { kind: "play" } | { kind: "pause" } | { kind: "seek"; positionMs: number };

/** The clock after the host does something, with `now` the server's time and `reported` where the host's player actually is. */
export function applyWatchAction(clock: WatchClock, action: WatchAction, now: number, reportedPositionMs?: number): WatchClock {
  const here = reportedPositionMs !== undefined ? Math.max(0, reportedPositionMs) : expectedPositionMs(clock, now);
  switch (action.kind) {
    case "play":
      return { playing: true, positionMs: here, updatedAt: now };
    case "pause":
      return { playing: false, positionMs: here, updatedAt: now };
    case "seek":
      return { playing: clock.playing, positionMs: Math.max(0, action.positionMs), updatedAt: now };
  }
}

/** How a title is stored: one line, bounded. */
export function cleanTitle(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const text = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return text || undefined;
}

/** `m:ss` / `h:mm:ss` for a position. */
export function formatPosition(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Small pure helpers shared by the voice message recorder and player. */

/** `m:ss` for a length in milliseconds, rounding down so a timer never runs ahead of the audio. */
export function formatVoiceTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** How far along a bar area a pointer is, 0–1. A zero-width area (not laid out yet) reads as the start. */
export function seekFraction(clientX: number, left: number, width: number): number {
  if (!(width > 0) || !Number.isFinite(clientX)) return 0;
  return Math.min(1, Math.max(0, (clientX - left) / width));
}

/** Milliseconds left of the cap once recording has run for `elapsedMs`, never negative. */
export function remainingMs(elapsedMs: number, maxMs: number): number {
  return Math.max(0, maxMs - elapsedMs);
}

/** An error's message as a person should read it: Convex's "Uncaught Error:" wrapper and anything after the first line removed. */
export function readableError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const withoutWrapper = raw.replace(/\[CONVEX [^\]]*\]\s*/g, "").replace(/\[Request ID: [^\]]*\]\s*/g, "");
  const lines = withoutWrapper
    .split("\n")
    .map((l) => l.replace(/^\s*(Uncaught\s+)?Error:\s*/i, "").trim())
    .filter(Boolean);
  return lines[0] ?? fallback;
}

/** Which of the playback speeds comes after `current`, wrapping round. */
export const VOICE_SPEEDS = [1, 1.5, 2] as const;
export function nextVoiceSpeed(current: number): number {
  const i = VOICE_SPEEDS.findIndex((s) => s === current);
  return VOICE_SPEEDS[(i + 1) % VOICE_SPEEDS.length];
}

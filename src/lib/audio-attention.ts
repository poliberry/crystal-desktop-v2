/**
 * Audio Attention: while you are watching a stream and other people are talking, the stream's sound is turned down so you
 * can hear them, and brought back up when they stop.
 *
 * Three small parts, none of which touches React or LiveKit, so the behaviour is tested on its own:
 *
 *  - `AttentionTracker` decides what the stream should be at (the *target*): quieter while someone else is speaking and
 *    for a moment after, so it doesn't pump up and down between words.
 *  - `stepGain` moves the actual level towards it: quickly down (you want to hear them now), slowly up (a jump back to full
 *    volume is jarring).
 *  - A tiny store holds the level. Stream tiles read it and set their audio elements' volume directly, so a fade is sixty
 *    volume writes a second and not sixty React renders.
 *
 * It only ever scales the *stream's* audio, by a multiplier between `1 - strength` and 1, on top of whatever volume the
 * person set for that stream. It never touches voices, and never raises anything above the person's own level.
 */

/** How much quieter the stream gets while people talk, as a fraction taken off (0.6 means 60% quieter). */
export const ATTENTION_STRENGTH = { min: 0.2, max: 0.9, default: 0.6 } as const;

export const clampStrength = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(ATTENTION_STRENGTH.max, Math.max(ATTENTION_STRENGTH.min, v)) : ATTENTION_STRENGTH.default;

/** Time constants, in milliseconds. */
export const ATTENTION_TIMING = {
  /** How long the level takes to close most of the way to a lower target. */
  attack: 80,
  /** And to a higher one. */
  release: 650,
  /** Stay ducked this long after the last person stops talking, so a pause between sentences doesn't raise the stream. */
  hold: 700,
} as const;

/**
 * Whether the stream should be ducked right now: you are watching something, and someone other than you is speaking.
 * Your own voice doesn't duck it (you know what you are saying), and nobody speaking leaves it alone.
 */
export function shouldDuck(input: { watching: boolean; othersSpeaking: number }): boolean {
  return input.watching && input.othersSpeaking > 0;
}

/** The multiplier the stream is aiming for. 1 is untouched. */
export const targetGain = (ducked: boolean, strength: number): number => (ducked ? 1 - clampStrength(strength) : 1);

/**
 * One step of the fade: `current` moved towards `target` over `dtMs`, exponentially, so it eases rather than jumping and is
 * independent of how often it is called. Snaps when it is close enough to be inaudible, so the fade ends instead of
 * approaching forever.
 */
export function stepGain(current: number, target: number, dtMs: number): number {
  if (current === target) return current;
  const tau = target < current ? ATTENTION_TIMING.attack : ATTENTION_TIMING.release;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau);
  const next = current + (target - current) * k;
  return Math.abs(next - target) < 0.005 ? target : next;
}

/** Remembers when someone last spoke, to hold the duck through short pauses. */
export class AttentionTracker {
  private lastSpoke = -Infinity;

  /** Whether the stream should be ducked at time `now` (ms), given who is speaking now. */
  update(now: number, input: { watching: boolean; othersSpeaking: number }): boolean {
    if (!input.watching) {
      this.lastSpoke = -Infinity;
      return false;
    }
    if (input.othersSpeaking > 0) this.lastSpoke = now;
    return now - this.lastSpoke < ATTENTION_TIMING.hold;
  }
}

// --- The shared level --------------------------------------------------------------------------------------------------

let gain = 1;
const gainListeners = new Set<() => void>();

/** The multiplier a ducked stream is at right now. */
export const getAttentionGain = (): number => gain;

export function setAttentionGain(next: number): void {
  const g = Math.min(1, Math.max(0, next));
  if (g === gain) return;
  gain = g;
  for (const l of gainListeners) l();
}

/** Called whenever the level changes, many times a second during a fade. Return value unsubscribes. */
export function subscribeAttentionGain(listener: () => void): () => void {
  gainListeners.add(listener);
  return () => void gainListeners.delete(listener);
}

// --- Per-stream choices --------------------------------------------------------------------------------------------------

/** The right-click choice for a stream, by the streamer's identity: absent means "follow the setting". Kept for the session. */
const overrides = new Map<string, boolean>();
const overrideListeners = new Set<() => void>();
let overrideVersion = 0;

export const getAttentionOverride = (identity: string): boolean | undefined => overrides.get(identity);

export function setAttentionOverride(identity: string, on: boolean | undefined): void {
  if (on === undefined) overrides.delete(identity);
  else overrides.set(identity, on);
  overrideVersion++;
  for (const l of overrideListeners) l();
}

export const attentionOverrideVersion = (): number => overrideVersion;

export function subscribeAttentionOverrides(listener: () => void): () => void {
  overrideListeners.add(listener);
  return () => void overrideListeners.delete(listener);
}

/** Whether a stream is subject to ducking: its own choice if it has one, otherwise the setting. */
export const attentionApplies = (identity: string, setting: boolean): boolean => overrides.get(identity) ?? setting;

/** The volume to give a stream's audio element: the person's level, times the duck if it applies. */
export function streamVolume(base: number, muted: boolean, identity: string, setting: boolean): number {
  if (muted) return 0;
  return Math.min(1, Math.max(0, base)) * (attentionApplies(identity, setting) ? gain : 1);
}

/** Forgets everything: the fade level and every choice. For when a call ends. */
export function resetAttention(): void {
  overrides.clear();
  overrideVersion++;
  for (const l of overrideListeners) l();
  setAttentionGain(1);
}

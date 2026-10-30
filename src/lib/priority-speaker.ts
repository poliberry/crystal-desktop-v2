/**
 * Priority speaker: while someone with the Priority Speaker permission is talking, everyone else's voice is
 * turned down for the people listening, and comes back up when they stop.
 *
 * Who has priority is read from the `priority` participant attribute, which the server signs into the person's
 * LiveKit token (convex/lib/voiceGrant.ts) and the room can't be told otherwise by a client — never from
 * anything a participant sent. This file is the same shape as audio-attention.ts: a tracker that decides
 * whether to duck (with a hold, so a pause between sentences doesn't pump the level), a step that eases
 * towards it, and a tiny store the audio elements read, so a fade is volume writes and not React renders.
 *
 * Only voices are turned down. The priority speaker is exempt, and so is anyone with priority themselves.
 */

/** The attribute name, mirrored from the server. */
export const PRIORITY_ATTRIBUTE = "priority";

/** What everyone else is multiplied by while a priority speaker talks. */
export const PRIORITY_DUCK_GAIN = 0.3;

/** Time constants, in milliseconds. */
export const PRIORITY_TIMING = { attack: 90, release: 500, hold: 600 } as const;

export const isPriorityAttributes = (attributes: Record<string, string> | undefined | null): boolean =>
  attributes?.[PRIORITY_ATTRIBUTE] === "1";

/** Whether anyone other than `selfIdentity` who has priority is in `speakers`. */
export function priorityIsSpeaking(
  speakers: { identity: string; attributes?: Record<string, string> }[],
  selfIdentity: string,
): boolean {
  return speakers.some((p) => p.identity !== selfIdentity && isPriorityAttributes(p.attributes));
}

/** The multiplier a given participant's voice is at: 1 for them if they have priority themselves. */
export function voiceGainFor(
  participant: { attributes?: Record<string, string> },
  currentGain: number,
): number {
  return isPriorityAttributes(participant.attributes) ? 1 : currentGain;
}

/** The level being aimed for. */
export const priorityTargetGain = (ducked: boolean): number => (ducked ? PRIORITY_DUCK_GAIN : 1);

/** One step of the fade: quick down, slower up, snapping when inaudibly close. Independent of how often it is called. */
export function stepPriorityGain(current: number, target: number, dtMs: number): number {
  if (current === target) return current;
  const tau = target < current ? PRIORITY_TIMING.attack : PRIORITY_TIMING.release;
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau);
  const next = current + (target - current) * k;
  return Math.abs(next - target) < 0.005 ? target : next;
}

/** Remembers when a priority speaker last spoke, to hold the duck through short pauses. */
export class PriorityTracker {
  private lastSpoke = -Infinity;

  update(now: number, prioritySpeaking: boolean): boolean {
    if (prioritySpeaking) this.lastSpoke = now;
    return now - this.lastSpoke < PRIORITY_TIMING.hold;
  }
}

// --- The shared level ---------------------------------------------------------------------------

let gain = 1;
const listeners = new Set<() => void>();

/** The multiplier non-priority voices are at right now. */
export const getPriorityGain = (): number => gain;

export function setPriorityGain(next: number): void {
  const g = Math.min(1, Math.max(0, next));
  if (g === gain) return;
  gain = g;
  for (const l of listeners) l();
}

/** Called whenever the level changes, many times a second during a fade. The return value unsubscribes. */
export function subscribePriorityGain(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

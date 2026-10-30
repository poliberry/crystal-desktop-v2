import { bitsHas } from "./permissionBits";
import { PERMISSIONS } from "./permissionFlags";

/**
 * Slowmode, as plain functions: how long someone still has to wait, and who never does. The
 * database half (reading and stamping the last send) is in `slowmode.ts`.
 */

/** Longest a channel can ask people to wait: six hours, as on Discord. */
export const MAX_SLOWMODE_SECONDS = 6 * 60 * 60;

/** What a slowmode setting can be set to in the UI, in seconds. Off first. */
export const SLOWMODE_CHOICES = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600] as const;

/** Which clock a send is on: a forum's new posts and its replies don't wait on ordinary messages. */
export type SlowmodeScope = "message" | "post" | "reply";

/** Thrown instead of a plain Error so the Bot API can answer 429 rather than 500. */
export class SlowmodeError extends Error {
  constructor(readonly waitMs: number) {
    super(slowmodeMessage(waitMs));
    this.name = "SlowmodeError";
  }
}

/** A stored or submitted setting as a whole number of seconds from 0 to six hours. Throws otherwise. */
export function cleanSlowmodeSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || !Number.isInteger(seconds) || seconds < 0 || seconds > MAX_SLOWMODE_SECONDS) {
    throw new Error("Slowmode has to be a whole number of seconds, from 0 to 6 hours.");
  }
  return seconds;
}

/**
 * Whether slowmode never applies to someone with these permissions in a channel. Bypass Slowmode is
 * the permission made for it; Manage Messages and Manage Channels are exempt as they are on Discord,
 * since moderators have to be able to answer in a room they have slowed. Administrator (and the
 * owner, whose set is all ones) covers everything.
 */
export function isSlowmodeExempt(perms: number): boolean {
  return (
    bitsHas(perms, PERMISSIONS.ADMINISTRATOR) ||
    bitsHas(perms, PERMISSIONS.BYPASS_SLOWMODE) ||
    bitsHas(perms, PERMISSIONS.MANAGE_MESSAGES) ||
    bitsHas(perms, PERMISSIONS.MANAGE_CHANNELS)
  );
}

/** Milliseconds until the next send is allowed; 0 if it is allowed now. */
export function slowmodeWaitMs(seconds: number | undefined, lastSentAt: number | undefined, now: number): number {
  if (!seconds || seconds <= 0 || lastSentAt === undefined) return 0;
  return Math.max(0, lastSentAt + seconds * 1000 - now);
}

/** "12 seconds", "1 minute 5 seconds" — the wait rounded up to a whole second. */
export function describeWait(ms: number): string {
  const total = Math.max(1, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  return [h && part(h, "hour"), m && part(m, "minute"), s && part(s, "second")].filter(Boolean).join(" ");
}

export function slowmodeMessage(waitMs: number): string {
  return `Slowmode is on in this channel. You can send again in ${describeWait(waitMs)}.`;
}

/** The label for a slowmode setting in a menu. */
export function slowmodeLabel(seconds: number): string {
  if (seconds <= 0) return "Off";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${seconds / 60}m`;
  return `${seconds / 3600}h`;
}

/**
 * "Clear after…" choices, shared by the custom status and the custom activity
 * so the two offer the same vocabulary.
 *
 * `ms` absent is "until I clear it" — the mutations read a missing duration as
 * "no deadline", which is also what an older client sending nothing means.
 */
export interface DurationOption {
  key: string;
  label: string;
  ms?: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const DURATION_OPTIONS: DurationOption[] = [
  { key: "never", label: "Until I clear it" },
  { key: "30m", label: "30 minutes", ms: 30 * MINUTE },
  { key: "1h", label: "1 hour", ms: HOUR },
  { key: "2h", label: "2 hours", ms: 2 * HOUR },
  { key: "4h", label: "4 hours", ms: 4 * HOUR },
  { key: "1d", label: "1 day", ms: 24 * HOUR },
];

/** How much longer a deadline has to run, phrased for a hint line. */
export function formatRemaining(expiresAt: number, now: number = Date.now()): string | null {
  const remaining = expiresAt - now;
  if (remaining <= 0) return null;
  const minutes = Math.round(remaining / MINUTE);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

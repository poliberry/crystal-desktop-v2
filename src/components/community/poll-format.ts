/**
 * The plain-function parts of a poll in the message list: how long is left, how the percentages
 * round, what a click does to the selection. Kept free of React so it can be tested on its own.
 */

/** "3h 12m", "2d 4h", "12m", "40s"; null once the time has passed. Zero units are left out ("1h", not "1h 0m"). */
export function timeLeftText(expiresAt: number, now: number): string | null {
  const ms = expiresAt - now;
  if (ms <= 0) return null;
  // Whole seconds, rounded up, so the last second reads "1s" rather than flashing "0s".
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return join(hours, "h", minutes % 60, "m");
  return join(Math.floor(hours / 24), "d", hours % 24, "h");
}

function join(big: number, bigUnit: string, small: number, smallUnit: string): string {
  return small > 0 ? `${big}${bigUnit} ${small}${smallUnit}` : `${big}${bigUnit}`;
}

/** How long to wait before the countdown next changes on screen: each second under a minute, every 30s otherwise. */
export function tickDelayMs(msLeft: number): number {
  return msLeft < 60_000 ? 1000 : 30_000;
}

/** "1 vote", "12 votes". */
export function votesText(voters: number): string {
  return `${voters} ${voters === 1 ? "vote" : "votes"}`;
}

/**
 * Whole-number percentages for each option, in the order given. A single-answer poll splits one
 * pool of votes, so the rows are rounded by largest remainder to add up to exactly 100. A
 * multi-answer poll shows how many of the voters picked each option, which can add up to more than
 * 100, so each is simply rounded on its own.
 */
export function percentages(counts: number[], multi: boolean, voters: number): number[] {
  if (multi) {
    if (voters <= 0) return counts.map(() => 0);
    return counts.map((c) => Math.min(100, Math.round((c / voters) * 100)));
  }
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return counts.map(() => 0);
  const exact = counts.map((c) => (c / total) * 100);
  const result = exact.map(Math.floor);
  let left = 100 - result.reduce((a, b) => a + b, 0);
  // Hand the leftover points to the biggest fractional parts; earlier options win a tie.
  const order = exact.map((x, i) => ({ i, rest: x - Math.floor(x) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    result[i]++;
    left--;
  }
  return result;
}

/**
 * The selection after clicking `optionId`. A single-answer poll holds one choice and clicking it
 * again clears it; a multi-answer poll adds or removes just that option. Always sorted, no repeats.
 */
export function nextSelection(current: number[], optionId: number, multi: boolean): number[] {
  const has = current.includes(optionId);
  if (!multi) return has ? [] : [optionId];
  const next = has ? current.filter((id) => id !== optionId) : [...current, optionId];
  return [...new Set(next)].sort((a, b) => a - b);
}

/** Whether two selections hold the same options, whatever the order. */
export function sameSelection(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** An error's message with Convex's wrapper text ("[CONVEX M(...)] ... Uncaught Error:") stripped, first line only. */
export function errorText(e: unknown, fallback: string): string {
  if (!(e instanceof Error)) return fallback;
  const text = e.message.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0].trim();
  return text || fallback;
}

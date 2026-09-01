/**
 * How message timestamps and day dividers are worded, shared by the channel
 * and DM message lists.
 *
 * All locale-aware: the reader's own `Intl` formatting decides whether "older"
 * dates read as `29/08/2026` or `08/29/2026` and whether a divider says
 * `31 August 2026` or `August 31, 2026`.
 */

/** Whether two instants fall on the same calendar day in local time. */
export function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** Whole calendar days `then` is before `now` (0 = today, 1 = yesterday). */
function calendarDaysAgo(then: number, now: number): number {
  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  return Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
}

function timeOfDay(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The timestamp shown next to a message author's name.
 *
 *  - today            → `8:12 AM`
 *  - yesterday        → `Yesterday at 4:18 PM`
 *  - anything earlier → `29/08/2026 11:57 PM`
 */
export function formatMessageTimestamp(ts: number, now: number = Date.now()): string {
  const days = calendarDaysAgo(ts, now);
  if (days <= 0) return timeOfDay(ts);
  if (days === 1) return `Yesterday at ${timeOfDay(ts)}`;
  const date = new Date(ts).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return `${date} ${timeOfDay(ts)}`;
}

/** The label on the divider between two days of messages — e.g. `31 August 2026`. */
export function formatDaySeparator(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

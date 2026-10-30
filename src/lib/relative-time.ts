/**
 * "5 minutes ago", "in 2 hours": relative times worded for the reader's region (src/lib/locale.ts), on `Intl` alone.
 *
 * This replaced `moment().fromNow()`, which dragged ~140 locale files into the startup bundle for a handful of
 * labels. The thresholds are moment's own (under 45 seconds is "a few seconds", under 45 minutes is minutes, under 22
 * hours is hours, under 26 days is days, under 11 months is months), so a given timestamp still lands on the same unit.
 *
 * Plain TypeScript with no React in it. A component that shows these should call `useLocale()` so it redraws when the
 * region changes.
 */

import { activeLocale } from "@/lib/locale";

type Unit = "second" | "minute" | "hour" | "day" | "month" | "year";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const MONTH = 30.436875 * DAY;
const YEAR = 365.2425 * DAY;

/** How many of which unit `ms` (an absolute span) is, using moment's cut-offs. `value` 0 means "a few seconds". */
function pick(ms: number): { unit: Unit; value: number } {
  const seconds = Math.round(ms / 1000);
  if (seconds < 45) return { unit: "second", value: 0 };
  const minutes = Math.round(ms / MINUTE);
  if (minutes <= 1) return { unit: "minute", value: 1 };
  if (minutes < 45) return { unit: "minute", value: minutes };
  const hours = Math.round(ms / HOUR);
  if (hours <= 1) return { unit: "hour", value: 1 };
  if (hours < 22) return { unit: "hour", value: hours };
  const days = Math.round(ms / DAY);
  if (days <= 1) return { unit: "day", value: 1 };
  if (days < 26) return { unit: "day", value: days };
  const months = Math.round(ms / MONTH);
  if (months <= 1) return { unit: "month", value: 1 };
  if (months < 11) return { unit: "month", value: months };
  const years = Math.round(ms / YEAR);
  return years <= 1 ? { unit: "year", value: 1 } : { unit: "year", value: years };
}

/** English reads "a minute" and "an hour" for one, not "1 minute". */
const ONE: Record<Unit, string> = {
  second: "a few seconds",
  minute: "a minute",
  hour: "an hour",
  day: "a day",
  month: "a month",
  year: "a year",
};

/**
 * `at` relative to `now`: "5 minutes ago", "in 3 days", "a few seconds ago". With `withoutSuffix`, just the span
 * ("5 minutes", "an hour"), for a spot that is already labelled.
 */
export function formatRelative(at: number | Date, options: { now?: number; withoutSuffix?: boolean } = {}): string {
  const diff = new Date(at).getTime() - (options.now ?? Date.now());
  const { unit, value } = pick(Math.abs(diff));
  const future = diff > 0;
  const locale = activeLocale();

  if (value <= 1) {
    const span = ONE[unit];
    if (options.withoutSuffix) return span;
    return future ? `in ${span}` : `${span} ago`;
  }
  try {
    if (!options.withoutSuffix) {
      return new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(future ? value : -value, unit);
    }
    return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(value);
  } catch {
    const span = `${value} ${unit}s`;
    return options.withoutSuffix ? span : future ? `in ${span}` : `${span} ago`;
  }
}

/** A local calendar day as `YYYY-MM-DD`, the key the overview calendar's events use. */
export function localDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A `YYYY-MM-DD` key as the local date it names (not UTC midnight, which is the day before in the Americas). */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

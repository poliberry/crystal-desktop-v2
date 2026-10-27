/**
 * The region the person reads dates, times, numbers and money in (Settings → Appearance → Language & region).
 *
 * English only, but English is written differently around the world: `08/29/2026` in the United States, `29/08/2026` in
 * Britain and Australia, `2026-08-29` in Canada; 12-hour clocks here, 24-hour ones there. This is the one place that
 * decides, and every date, time, number and price the app draws goes through the helpers below instead of calling
 * `toLocale*String` with whatever the machine's own locale happens to be.
 *
 * Plain TypeScript with no React in it, so formatting helpers (money.ts, message-time.ts) can use it from anywhere and
 * tests can run it in Node.
 */

export const REGIONS = [
  { id: "en-US", label: "United States" },
  { id: "en-GB", label: "United Kingdom" },
  { id: "en-AU", label: "Australia" },
  { id: "en-CA", label: "Canada" },
  { id: "en-NZ", label: "New Zealand" },
  { id: "en-IE", label: "Ireland" },
  { id: "en-IN", label: "India" },
  { id: "en-ZA", label: "South Africa" },
] as const;

export type RegionId = (typeof REGIONS)[number]["id"];
/** `auto` is the machine's own setting, which is what the app used before there was a choice. */
export type Region = RegionId | "auto";
export type HourCycle = "auto" | "12" | "24";

export const isRegion = (v: unknown): v is Region => v === "auto" || REGIONS.some((r) => r.id === v);
export const isHourCycle = (v: unknown): v is HourCycle => v === "auto" || v === "12" || v === "24";

const REGION_KEY = "crystal-region";
const HOUR_KEY = "crystal-hour-cycle";

let region: Region = "auto";
let hourCycle: HourCycle = "auto";
let loaded = false;
const listeners = new Set<() => void>();

let watching = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  if (typeof localStorage === "undefined") return;
  // Another window of the app (the pop-out, a second Studio) changed the setting: follow it, as the theme does.
  if (!watching && typeof window !== "undefined") {
    watching = true;
    window.addEventListener("storage", (e) => {
      if (e.key === REGION_KEY || e.key === HOUR_KEY) reloadLocaleFromStorage();
    });
  }
  try {
    const r = localStorage.getItem(REGION_KEY);
    const h = localStorage.getItem(HOUR_KEY);
    if (isRegion(r)) region = r;
    if (isHourCycle(h)) hourCycle = h;
  } catch {
    /* storage unavailable: the defaults stand */
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* kept for this session only */
  }
}

function notify(): void {
  for (const l of listeners) l();
}

export function getRegion(): Region {
  load();
  return region;
}
export function getHourCycle(): HourCycle {
  load();
  return hourCycle;
}

export function setRegion(next: Region): void {
  load();
  if (next === region) return;
  region = next;
  save(REGION_KEY, next);
  notify();
}
export function setHourCycle(next: HourCycle): void {
  load();
  if (next === hourCycle) return;
  hourCycle = next;
  save(HOUR_KEY, next);
  notify();
}

/** For `useSyncExternalStore`: called when either setting changes. */
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Another window (Settings used to be one) changed a setting: pick it up. */
export function reloadLocaleFromStorage(): void {
  loaded = false;
  const before = `${region}|${hourCycle}`;
  load();
  if (`${region}|${hourCycle}` !== before) notify();
}

/** The locale to hand to `Intl`: the chosen region, or `undefined` for the machine's own. */
export function activeLocale(): string | undefined {
  load();
  return region === "auto" ? undefined : region;
}

/** `options` with the 12/24-hour choice applied, where a time is being shown at all. */
export function withHourCycle(options: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormatOptions {
  load();
  if (hourCycle === "auto") return options;
  return { ...options, hourCycle: hourCycle === "12" ? "h12" : "h23" };
}

/** A date and time, as the options say (everything the machine knows, if they don't). */
export function formatDateTime(at: number | Date, options?: Intl.DateTimeFormatOptions): string {
  return new Date(at).toLocaleString(activeLocale(), withHourCycle(options));
}
/** A date alone. */
export function formatDateOnly(at: number | Date, options?: Intl.DateTimeFormatOptions): string {
  return new Date(at).toLocaleDateString(activeLocale(), options);
}
/** A time of day alone. */
export function formatTimeOnly(at: number | Date, options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" }): string {
  return new Date(at).toLocaleTimeString(activeLocale(), withHourCycle(options));
}
/** A plain number: `1,234` or `12,34,567`, by region. */
export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(activeLocale(), options).format(n);
}

/**
 * The day a week starts on in this region, as `Date#getDay` numbers it (0 is Sunday). From the locale's own data where the
 * runtime has it, and from a short table where it doesn't (older Electron/Chromium builds lack `Intl.Locale#weekInfo`).
 */
export function firstDayOfWeek(): number {
  const tag = activeLocale() ?? (typeof navigator !== "undefined" ? navigator.language : "en-US");
  try {
    const loc = new Intl.Locale(tag) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    // Intl numbers days 1 (Monday) to 7 (Sunday); Date#getDay has Sunday as 0.
    if (info) return info.firstDay % 7;
  } catch {
    /* fall through to the table */
  }
  return SUNDAY_FIRST.has(tag.split("-")[1]?.toUpperCase() ?? "US") ? 0 : 1;
}

/** English-speaking regions whose weeks start on Sunday; the rest (the UK, Ireland, Australia, New Zealand) start on Monday. */
const SUNDAY_FIRST = new Set(["US", "CA", "IN", "ZA"]);

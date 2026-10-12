// localStorage and window stand-ins: the module reads and writes the setting through them.
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
const handlers: ((e: { key: string }) => void)[] = [];
(globalThis as any).window = { addEventListener: (_: string, h: (e: { key: string }) => void) => handlers.push(h) };

const L = await import("../../src/lib/locale");
const { formatMessageTimestamp, formatDaySeparator } = await import("../../src/lib/message-time");
const { formatMoney, formatDate } = await import("../../src/lib/money");

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const eq = (n: string, got: unknown, want: unknown) => ok(n, JSON.stringify(got) === JSON.stringify(want), { got, want });

// 29 August 2026, 14:05 UTC; the zone is pinned so the hour is the same wherever this runs.
process.env.TZ = "UTC";
const AT = Date.UTC(2026, 7, 29, 14, 5);
const short = { day: "2-digit", month: "2-digit", year: "numeric" } as const;

L.setRegion("en-US");
eq("US short date is month first", L.formatDateOnly(AT, short), "08/29/2026");
eq("US time is 12-hour", L.formatTimeOnly(AT), "2:05 PM");
eq("US number", L.formatNumber(1234567.89), "1,234,567.89");

L.setRegion("en-GB");
eq("UK short date is day first", L.formatDateOnly(AT, short), "29/08/2026");
eq("UK time is 24-hour", L.formatTimeOnly(AT), "14:05");

L.setRegion("en-AU");
eq("Australia short date is day first", L.formatDateOnly(AT, short), "29/08/2026");

L.setRegion("en-CA");
eq("Canada writes the year first in ISO form", L.formatDateOnly(AT, short), "2026-08-29");

L.setRegion("en-IN");
eq("India groups digits in lakhs", L.formatNumber(1234567), "12,34,567");

L.setRegion("en-ZA");
ok("South Africa formats a number", L.formatNumber(1234567.89).replace(/\s/g, "").length > 0);

// ---- The 12/24-hour override beats the region either way ------------------------------------------------------------------
L.setRegion("en-GB");
L.setHourCycle("12");
ok("12-hour on a 24-hour region", /2:05\s?pm/i.test(L.formatTimeOnly(AT)), L.formatTimeOnly(AT));
L.setRegion("en-US");
L.setHourCycle("24");
eq("24-hour on a 12-hour region", L.formatTimeOnly(AT), "14:05");
ok("the override reaches message timestamps", formatMessageTimestamp(AT, AT).includes("14:05"));
L.setHourCycle("auto");
eq("auto follows the region again", L.formatTimeOnly(AT), "2:05 PM");

// ---- The shared helpers follow the region ---------------------------------------------------------------------------------
L.setRegion("en-GB");
eq("day divider, UK", formatDaySeparator(AT), "29 August 2026");
L.setRegion("en-US");
eq("day divider, US", formatDaySeparator(AT), "August 29, 2026");
ok("an older message's timestamp is dated in the region's order", formatMessageTimestamp(AT, AT + 3 * 86_400_000).startsWith("08/29/2026"));
L.setRegion("en-GB");
ok("and in the UK's", formatMessageTimestamp(AT, AT + 3 * 86_400_000).startsWith("29/08/2026"));
eq("prices carry the region's grouping", formatMoney(123456, "gbp", { free: false }), "£1,234.56");
L.setRegion("en-US");
eq("a whole-dollar price drops the cents", formatMoney(500, "usd"), "$5");
eq("free is free", formatMoney(0, "usd"), "Free");
ok("a date with a time", formatDate(AT, true).includes("2:05"));

// ---- Weeks start where the region says ---------------------------------------------------------------------------------------
const first = (r: Parameters<typeof L.setRegion>[0]) => (L.setRegion(r), L.firstDayOfWeek());
eq("US weeks start on Sunday", first("en-US"), 0);
eq("Canada's too", first("en-CA"), 0);
eq("India's too", first("en-IN"), 0);
eq("UK weeks start on Monday", first("en-GB"), 1);
eq("Ireland's too", first("en-IE"), 1);
eq("Australia's too", first("en-AU"), 1);
eq("New Zealand's too", first("en-NZ"), 1);

// ---- Persistence and change notification --------------------------------------------------------------------------------------
L.setRegion("en-US");
let ticks = 0;
const off = L.subscribeLocale(() => ticks++);
L.setRegion("en-NZ");
eq("a change notifies subscribers once", ticks, 1);
L.setRegion("en-NZ");
eq("setting the same value again doesn't", ticks, 1);
L.setHourCycle("24");
eq("the clock setting notifies too", ticks, 2);
off();
L.setRegion("en-US");
eq("an unsubscribed listener is left alone", ticks, 2);
L.setRegion("en-IE");
eq("the region is saved", store.get("crystal-region"), "en-IE");
L.setHourCycle("12");
eq("the clock is saved", store.get("crystal-hour-cycle"), "12");
eq("automatic means no locale is passed on", (L.setRegion("auto"), L.activeLocale()), undefined);
ok("only known regions are accepted", L.isRegion("en-GB") && L.isRegion("auto") && !L.isRegion("fr-FR") && !L.isRegion("") && !L.isRegion(5));
ok("only known clocks are accepted", L.isHourCycle("24") && !L.isHourCycle("25"));

// A change made in another window arrives as a storage event and is picked up.
store.set("crystal-region", "en-AU");
let seen = 0;
const off2 = L.subscribeLocale(() => seen++);
handlers.forEach((h) => h({ key: "crystal-region" }));
eq("another window's change is followed", [L.getRegion(), seen], ["en-AU", 1]);
handlers.forEach((h) => h({ key: "something-else" }));
eq("unrelated keys are ignored", seen, 1);
store.set("crystal-region", "klingon");
handlers.forEach((h) => h({ key: "crystal-region" }));
eq("a junk value is not adopted", L.getRegion(), "en-AU");
off2();

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);

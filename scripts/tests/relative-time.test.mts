// Run: npx tsx scripts/tests/relative-time.test.mts
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
(globalThis as any).window = { addEventListener: () => {} };

const { formatRelative, localDateKey, parseDateKey } = await import("../../src/lib/relative-time");

let f = 0, p = 0;
const eq = (n: string, got: unknown, want: unknown) => { JSON.stringify(got) === JSON.stringify(want) ? p++ : (f++, console.log("FAIL", n, { got, want })); };

const now = Date.UTC(2026, 9, 30, 12, 0, 0);
const ago = (ms: number) => formatRelative(now - ms, { now });
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

eq("seconds", ago(10 * S), "a few seconds ago");
eq("44s is still seconds", ago(44 * S), "a few seconds ago");
eq("45s is a minute", ago(45 * S), "a minute ago");
eq("5 minutes", ago(5 * M), "5 minutes ago");
eq("44 minutes", ago(44 * M), "44 minutes ago");
eq("45 minutes is an hour", ago(45 * M), "an hour ago");
eq("3 hours", ago(3 * H), "3 hours ago");
eq("21 hours", ago(21 * H), "21 hours ago");
eq("22 hours is a day", ago(22 * H), "a day ago");
eq("3 days", ago(3 * D), "3 days ago");
eq("25 days", ago(25 * D), "25 days ago");
eq("26 days is a month", ago(26 * D), "a month ago");
eq("3 months", ago(95 * D), "3 months ago");
eq("11 months is a year", ago(340 * D), "a year ago");
eq("2 years", ago(800 * D), "2 years ago");
eq("future", formatRelative(now + 2 * H, { now }), "in 2 hours");
eq("future a few seconds", formatRelative(now + 5 * S, { now }), "in a few seconds");
eq("no suffix", formatRelative(now - 5 * M, { now, withoutSuffix: true }), "5 minutes");
eq("no suffix, one", formatRelative(now - 60 * M, { now, withoutSuffix: true }), "an hour");

eq("date key", localDateKey(new Date(2026, 2, 5)), "2026-03-05");
eq("date key round trip", localDateKey(parseDateKey("2026-12-31")), "2026-12-31");

console.log(f ? `${f} FAILED` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);

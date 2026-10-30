// Run: bun scripts/tests/poll-ui.test.mts
import { errorText, nextSelection, percentages, sameSelection, tickDelayMs, timeLeftText, votesText } from "../../src/components/community/poll-format";

let fails = 0, passes = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? passes++ : fails++; if (!c) console.log("FAIL", n, JSON.stringify(d)); };
const eq = (n: string, a: unknown, b: unknown) => ok(n, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });

// ---- time left
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;
eq("time: passed is null", timeLeftText(1000, 1000), null);
eq("time: long past is null", timeLeftText(1000, 99999), null);
eq("time: 40s", timeLeftText(40 * S, 0), "40s");
eq("time: partial second rounds up", timeLeftText(1, 0), "1s");
eq("time: 59.5s rolls over to 1m", timeLeftText(59_500, 0), "1m");
eq("time: exactly a minute", timeLeftText(M, 0), "1m");
eq("time: 12m drops seconds", timeLeftText(12 * M + 30 * S, 0), "12m");
eq("time: 3h 12m", timeLeftText(3 * H + 12 * M, 0), "3h 12m");
eq("time: 1h leaves out 0m", timeLeftText(H, 0), "1h");
eq("time: 2d 4h", timeLeftText(2 * D + 4 * H + 5 * M, 0), "2d 4h");
eq("time: 14d", timeLeftText(14 * D, 0), "14d");
eq("time: uses now", timeLeftText(10 * S + 5000, 5000), "10s");
eq("tick: second under a minute", tickDelayMs(59_999), 1000);
eq("tick: 30s from a minute", tickDelayMs(60_000), 30_000);
eq("tick: 30s for long", tickDelayMs(5 * D), 30_000);

// ---- votes text
eq("votes: 0", votesText(0), "0 votes");
eq("votes: 1", votesText(1), "1 vote");
eq("votes: 2", votesText(2), "2 votes");

// ---- percentages
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
eq("pct: nobody voted", percentages([0, 0, 0], false, 0), [0, 0, 0]);
eq("pct: multi nobody voted", percentages([0, 0], true, 0), [0, 0]);
eq("pct: even split of three sums to 100", sum(percentages([1, 1, 1], false, 3)), 100);
eq("pct: even split of three", percentages([1, 1, 1], false, 3), [34, 33, 33]);
eq("pct: all on one", percentages([5, 0], false, 5), [100, 0]);
eq("pct: halves", percentages([1, 1], false, 2), [50, 50]);
eq("pct: 2/3 1/3", percentages([2, 1], false, 3), [67, 33]);
for (const counts of [[1, 2, 3, 4], [7, 7, 7, 7, 7, 7, 7], [1, 0, 0, 0, 0, 0, 0, 0, 0, 99], [13, 17, 19]]) {
  eq(`pct: ${counts} sums to 100`, sum(percentages(counts, false, sum(counts))), 100);
}
ok("pct: a zero stays zero", percentages([3, 0, 7], false, 10)[1] === 0);
eq("pct: multi is share of voters", percentages([3, 2], true, 3), [100, 67]);
eq("pct: multi can exceed 100 in total", sum(percentages([4, 4], true, 4)), 200);
eq("pct: multi never over 100 each", percentages([9], true, 4), [100]);

// ---- selection
eq("select: single picks", nextSelection([], 2, false), [2]);
eq("select: single replaces", nextSelection([1], 2, false), [2]);
eq("select: single clicking own takes it back", nextSelection([2], 2, false), []);
eq("select: multi adds", nextSelection([3], 1, true), [1, 3]);
eq("select: multi removes", nextSelection([1, 3], 1, true), [3]);
eq("select: multi last removed is empty", nextSelection([1], 1, true), []);
eq("select: multi dedupes", nextSelection([1, 1], 4, true), [1, 4]);
const orig = [2, 5];
nextSelection(orig, 3, true);
eq("select: does not mutate", orig, [2, 5]);
ok("same: order does not matter", sameSelection([1, 2], [2, 1]));
ok("same: different", !sameSelection([1], [1, 2]) && !sameSelection([1], [2]));
ok("same: both empty", sameSelection([], []));

// ---- error text
eq("error: strips convex wrapper", errorText(new Error("[CONVEX M(polls:vote)] [Request ID: abc] Server Error\nUncaught Error: This poll has ended.\n    at handler (../convex/polls.ts:55:4)"), "x"), "This poll has ended.");
eq("error: plain message kept", errorText(new Error("Nope.\nmore"), "x"), "Nope.");
eq("error: non-error falls back", errorText("boom", "Couldn't."), "Couldn't.");
eq("error: empty falls back", errorText(new Error(""), "Couldn't."), "Couldn't.");

if (fails) { console.log(`${fails} FAILED, ${passes} passed`); process.exit(1); }
console.log(`ALL PASSED (${passes})`);

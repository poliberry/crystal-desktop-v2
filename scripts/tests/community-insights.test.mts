// Run: npx tsx scripts/tests/community-insights.test.mts
import * as I from "../../convex/lib/communityInsights";
import { tallyTiers, totalEarnings } from "../../convex/lib/creatorMonetization";

let f = 0, p = 0;
const eq = (n: string, got: unknown, want: unknown) => { JSON.stringify(got) === JSON.stringify(want) ? p++ : (f++, console.log("FAIL", n, { got, want })); };

// ---- days are UTC
eq("epoch is day 0", I.dayOf(0), 0);
eq("last ms of a UTC day", I.dayOf(I.DAY_MS - 1), 0);
eq("first ms of the next", I.dayOf(I.DAY_MS), 1);
eq("date of a day", I.dateOfDay(I.dayOf(Date.UTC(2026, 9, 30, 23, 59))), "2026-10-30");

// ---- shards stay in range
eq("shard low", I.pickShard(0), 0);
eq("shard high", I.pickShard(0.999999), I.INSIGHT_SHARDS - 1);
eq("shard out of range is clamped", [I.pickShard(-1), I.pickShard(5)], [0, I.INSIGHT_SHARDS - 1]);

// ---- ranges
eq("offered ranges pass", [7, 30, 90].map(I.clampRange), [7, 30, 90]);
eq("anything else is 30", [0, 1, 365, NaN, -7].map(I.clampRange), [30, 30, 30, 30, 30]);

// ---- series: shards add up, empty days are zeros, rows outside the window are ignored
const today = 100;
const series = I.buildSeries(
  [
    { day: 100, messages: 3, active: 1 },
    { day: 100, messages: 4, active: 2, joined: 1 },
    { day: 98, left: 2, voiceMinutes: 15 },
    { day: 90, messages: 99 },
    { day: 101, messages: 99 },
  ],
  today,
  7,
);
eq("series is one entry per day", series.length, 7);
eq("series runs oldest to newest", [series[0].day, series[6].day], [94, 100]);
eq("shards of a day are added", [series[6].messages, series[6].active, series[6].joined], [7, 3, 1]);
eq("missing fields are zero", [series[4].left, series[4].voiceMinutes, series[4].messages], [2, 15, 0]);
eq("a day with no rows is all zeros", { ...series[0], day: 0, date: "" }, { day: 0, date: "", joined: 0, left: 0, messages: 0, active: 0, voiceMinutes: 0 });
eq("rows outside the window are ignored", series.reduce((n, d) => n + d.messages, 0), 7);

// ---- totals
const t = I.totalsOf(series);
eq("totals", t, { joined: 1, left: 2, net: -1, messages: 7, voiceMinutes: 15, peakActive: 3, avgActive: 0.4 });
eq("totals of nothing", I.totalsOf([]), { joined: 0, left: 0, net: 0, messages: 0, voiceMinutes: 0, peakActive: 0, avgActive: 0 });

// ---- voice minutes by community
const comm: Record<string, string | null> = { a: "c1", b: "c1", c: "c2", gone: null };
const m = I.voiceMinutesByCommunity((id) => comm[id] ?? null, ["a", "a", "b", "c", "gone"]);
eq("each person present gets a tick", [m.get("c1"), m.get("c2"), m.size], [3 * I.VOICE_TICK_MINUTES, I.VOICE_TICK_MINUTES, 2]);
eq("nobody in a call credits nothing", I.voiceMinutesByCommunity(() => "c1", []).size, 0);

// ---- creator monetization
const tiers = [{ key: "1000", name: "Tier 1", rank: 1 }, { key: "3000", name: "Tier 3", rank: 3 }, { key: "2000", name: "Tier 2", rank: 2 }];
const tally = tallyTiers(tiers, [{ tierKey: "1000" }, { tierKey: "1000" }, { tierKey: "3000" }, {}, { tierKey: "gone" }]);
eq("tiers are listed highest first", tally.tiers.map((x) => x.key), ["3000", "2000", "1000", ""]);
eq("counts per tier", tally.tiers.map((x) => x.count), [1, 0, 2, 1]);
eq("untiered members are not subscribers", [tally.untiered, tally.subscribers], [1, 4]);
eq("no members", tallyTiers(tiers, []).subscribers, 0);
eq("earnings by currency", totalEarnings([
  { currency: "usd", creatorCents: 500, status: "transferred" },
  { currency: "usd", creatorCents: 200, status: "held" },
  { currency: "usd", creatorCents: 100, status: "pending" },
  { currency: "usd", creatorCents: 50, status: "refunded" },
  { currency: "eur", creatorCents: 70, status: "transferred" },
]), [{ currency: "usd", paid: 500, waiting: 300, reversed: 50 }, { currency: "eur", paid: 70, waiting: 0, reversed: 0 }]);

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);

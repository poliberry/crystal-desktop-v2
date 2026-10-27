import {
  GEODE_GRACE_MS,
  GEODE_TIERS,
  geodeBadge,
  geodeStanding,
  geodeTenureLabel,
  geodeTierForMonths,
  nextGeodeTier,
  planEarnsBadge,
} from "../../convex/lib/geode";
import { intersectIds } from "../../convex/lib/mutuals";

let f = 0, p = 0;
const eq = (n: string, got: unknown, want: unknown) => {
  JSON.stringify(got) === JSON.stringify(want) ? p++ : (f++, console.log("FAIL", n, { got, want }));
};

const DAY = 24 * 60 * 60 * 1000;
const MONTH = 30.4375 * DAY;
const NOW = Date.UTC(2026, 9, 12);
const PLAN = JSON.stringify({ plan: "crystal-geode", monthlyBadge: true });

/** An entitlement, with only the fields the maths reads. */
const plan = (startMonthsAgo: number, over: Record<string, unknown> = {}) =>
  ({
    kind: "plan",
    payload: PLAN,
    createdAt: NOW - startMonthsAgo * MONTH,
    expiresAt: NOW + 10 * DAY,
    ...over,
  }) as never;

// --- Ladder shape -------------------------------------------------------------
eq("eight tiers", GEODE_TIERS.length, 8);
eq("tiers are ranked 1..n", GEODE_TIERS.map((t) => t.tier), [1, 2, 3, 4, 5, 6, 7, 8]);
eq("thresholds only go up", GEODE_TIERS.every((t, i) => i === 0 || t.months > GEODE_TIERS[i - 1].months), true);
eq("thresholds in months (Quartz is worn from the start)", GEODE_TIERS.map((t) => t.months), [0, 3, 6, 12, 24, 36, 60, 72]);
eq("thresholds as people say them", GEODE_TIERS.map((t) => t.after), ["1 month", "3 months", "6 months", "1 year", "2 years", "3 years", "5 years", "6+ years"]);
eq("keys are unique", new Set(GEODE_TIERS.map((t) => t.key)).size, GEODE_TIERS.length);
eq("names are gems", GEODE_TIERS.map((t) => t.name), ["Quartz", "Amethyst", "Citrine", "Topaz", "Sapphire", "Emerald", "Ruby", "Opal"]);
eq("no clash with the Bug Hunter diamond", GEODE_TIERS.some((t) => t.name === "Diamond"), false);

// --- Months to gem ------------------------------------------------------------
eq("0 months: quartz, from the moment of subscribing", geodeTierForMonths(0).key, "quartz");
eq("1 month: quartz", geodeTierForMonths(1).key, "quartz");
eq("2 months: still quartz", geodeTierForMonths(2).key, "quartz");
eq("3 months: amethyst", geodeTierForMonths(3).key, "amethyst");
eq("5 months: still amethyst", geodeTierForMonths(5).key, "amethyst");
eq("6 months: citrine", geodeTierForMonths(6).key, "citrine");
eq("11 months: still citrine", geodeTierForMonths(11).key, "citrine");
eq("1 year: topaz", geodeTierForMonths(12).key, "topaz");
eq("2 years: sapphire", geodeTierForMonths(24).key, "sapphire");
eq("3 years: emerald", geodeTierForMonths(36).key, "emerald");
eq("4 years: still emerald", geodeTierForMonths(48).key, "emerald");
eq("5 years: ruby", geodeTierForMonths(60).key, "ruby");
eq("71 months: still ruby", geodeTierForMonths(71).key, "ruby");
eq("6 years: opal", geodeTierForMonths(72).key, "opal");
eq("decades later: still opal", geodeTierForMonths(300).key, "opal");
eq("next of quartz", nextGeodeTier(GEODE_TIERS[0])?.key, "amethyst");
eq("nothing after opal", nextGeodeTier(GEODE_TIERS[7]), null);
eq("tenure label: months", geodeTenureLabel(7), "7 months");
eq("tenure label: one month", geodeTenureLabel(1), "1 month");
eq("tenure label: whole years", geodeTenureLabel(24), "2 years");
eq("tenure label: year and months", geodeTenureLabel(15), "1 year, 3 months");

// --- A plan that earns it -----------------------------------------------------
eq("flagged plan earns it", planEarnsBadge(PLAN), true);
eq("unflagged plan does not", planEarnsBadge(JSON.stringify({ plan: "x" })), false);
eq("monthlyBadge:false does not", planEarnsBadge(JSON.stringify({ monthlyBadge: false })), false);
eq("junk payload does not", planEarnsBadge("{not json"), false);
eq("no payload does not", planEarnsBadge(undefined), false);

// --- Standing -----------------------------------------------------------------
eq("no entitlements: no badge", geodeStanding([], NOW), null);
eq("only a cosmetic: no badge", geodeStanding([{ kind: "avatarDecoration", createdAt: NOW - MONTH, payload: PLAN } as never], NOW), null);
eq("a lapsed plan: no badge", geodeStanding([plan(5, { expiresAt: NOW - DAY })], NOW), null);
eq("a revoked plan: no badge", geodeStanding([plan(5, { revokedAt: NOW - DAY })], NOW), null);
eq("a plan without the flag: no badge", geodeStanding([plan(5, { payload: JSON.stringify({ plan: "x" }) })], NOW), null);

eq("a brand-new subscriber is quartz straight away", geodeStanding([plan(0)], NOW)?.tier.key, "quartz");
eq("a few days in is quartz", geodeStanding([plan(0.2)], NOW)?.tier.key, "quartz");
eq("…working towards amethyst", geodeStanding([plan(0.2)], NOW)?.next?.key, "amethyst");
eq("…about three months from the start", Math.round(((geodeStanding([plan(0.2)], NOW)?.nextAt ?? 0) - NOW) / MONTH), 3);
eq("a month in is still quartz", geodeStanding([plan(1.1)], NOW)?.tier.key, "quartz");
eq("a year in is topaz", geodeStanding([plan(12.2)], NOW)?.tier.key, "topaz");
eq("six years in is opal", geodeStanding([plan(72.5)], NOW)?.tier.key, "opal");
eq("months are whole", geodeStanding([plan(7.9)], NOW)?.months, 7);
eq("a comped plan with no expiry counts", geodeStanding([plan(6.5, { expiresAt: undefined })], NOW)?.tier.key, "citrine");

const near = geodeStanding([plan(4)], NOW);
eq("next gem from amethyst is citrine", near?.next?.key, "citrine");
eq("next gem lands about two months out", Math.round(((near?.nextAt ?? 0) - NOW) / MONTH), 2);
eq("opal has nothing next", geodeStanding([plan(80)], NOW)?.nextAt, null);

// --- Streaks ------------------------------------------------------------------
// Resubscribing straight after a lapse carries the history over…
const resub = [
  plan(10, { expiresAt: NOW - 4 * MONTH }),
  plan(4 + 2 / 30, { expiresAt: NOW + DAY }),
];
eq("a short gap keeps the streak", geodeStanding(resub, NOW)?.months, 10);
// …a long one starts again.
const lapsed = [
  plan(20, { expiresAt: NOW - 8 * MONTH }),
  plan(2, { expiresAt: NOW + DAY }),
];
eq("a long gap restarts it", geodeStanding(lapsed, NOW)?.months, 2);
eq("restart lands on the new run's start", geodeStanding(lapsed, NOW)?.since, NOW - 2 * MONTH);
eq("grace is a week", GEODE_GRACE_MS, 7 * DAY);
eq("input order does not matter", geodeStanding([...lapsed].reverse(), NOW)?.months, 2);
eq(
  "an expired plan overlapping the active one doesn't double count",
  geodeStanding([plan(5, { expiresAt: NOW - MONTH }), plan(3)], NOW)?.months,
  5,
);

// --- The badge ----------------------------------------------------------------
const badge = geodeBadge(geodeStanding([plan(6.5)], NOW)!)!;
eq("badge id carries the rank", badge.badgeId, "geode_3");
eq("badge icon is routed to the artwork", badge.icon, "geode:citrine");
eq("badge is a tiered group", [badge.group, badge.tier], ["geode", 3]);
eq("badge label names the gem", badge.label, "Crystal Geode — Citrine");
eq("badge says how long", badge.description, "Crystal Geode member for 6 months.");
const fresh = geodeBadge(geodeStanding([plan(0.1)], NOW)!);
eq("a new subscriber gets the first badge by default", [fresh.icon, fresh.tier], ["geode:quartz", 1]);
eq("a brand-new member isn't given a duration", fresh.description, "Crystal Geode member.");
eq("a single month is singular", geodeBadge(geodeStanding([plan(1.2)], NOW)!).description, "Crystal Geode member for 1 month.");
eq("years are spoken as years", geodeBadge(geodeStanding([plan(30.5)], NOW)!).description, "Crystal Geode member for 2 years, 6 months.");

// --- Mutuals ------------------------------------------------------------------
eq("intersection keeps the first list's order", intersectIds(["c", "a", "b"], ["b", "c", "z"]), ["c", "b"]);
eq("nothing in common", intersectIds(["a"], ["b"]), []);
eq("empty sides", intersectIds([], ["a"]), []);
eq("duplicates collapse", intersectIds(["a", "a", "b"], ["a", "b"]), ["a", "b"]);

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);

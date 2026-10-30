/**
 * What a creator community's Monetization tab adds up. Pure, so the rules are tested on their own
 * (scripts/tests/community-insights.test.mts); the query that reads the rows is
 * `creatorCommunities.monetization`.
 */

export interface TierInfo {
  key: string;
  name: string;
  rank: number;
}

/** Members per platform tier, highest tier first, with the ones on no tier counted apart. */
export function tallyTiers(tiers: TierInfo[], memberships: { tierKey?: string }[]): { tiers: { key: string; name: string; count: number }[]; untiered: number; subscribers: number } {
  const counts = new Map<string, number>();
  let untiered = 0;
  for (const m of memberships) {
    if (!m.tierKey) untiered++;
    else counts.set(m.tierKey, (counts.get(m.tierKey) ?? 0) + 1);
  }
  const known = new Set(tiers.map((t) => t.key));
  const rows = [...tiers]
    .sort((a, b) => b.rank - a.rank)
    .map((t) => ({ key: t.key, name: t.name, count: counts.get(t.key) ?? 0 }));
  // A tier that was removed from the community still has people on it; they are subscribers all the same.
  let orphaned = 0;
  for (const [key, n] of counts) if (!known.has(key)) orphaned += n;
  if (orphaned) rows.push({ key: "", name: "Other tiers", count: orphaned });
  return { tiers: rows, untiered, subscribers: memberships.length - untiered };
}

export interface EarningRow {
  currency: string;
  creatorCents: number;
  status: "pending" | "transferred" | "held" | "refunded";
}

/** Totals by currency: paid out, waiting to be paid, and taken back. */
export function totalEarnings(rows: EarningRow[]): { currency: string; paid: number; waiting: number; reversed: number }[] {
  const totals = new Map<string, { currency: string; paid: number; waiting: number; reversed: number }>();
  for (const row of rows) {
    const entry = totals.get(row.currency) ?? { currency: row.currency, paid: 0, waiting: 0, reversed: 0 };
    if (row.status === "transferred") entry.paid += row.creatorCents;
    else if (row.status === "held" || row.status === "pending") entry.waiting += row.creatorCents;
    else if (row.status === "refunded") entry.reversed += row.creatorCents;
    totals.set(row.currency, entry);
  }
  return [...totals.values()];
}

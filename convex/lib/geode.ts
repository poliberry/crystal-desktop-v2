import type { Doc } from "../_generated/dataModel";
import { isActive } from "./entitlements";

/**
 * The Geode badge: what it is, which gem a subscriber is on, and how long
 * they've earned it.
 *
 * It is *derived* rather than granted. A row in `userBadges` would need
 * something to move it up a tier every month and take it away when a card
 * fails, and every one of those jobs is a way for the badge to disagree with
 * the subscription. Computed from the plan entitlement at read time it cannot:
 * the badge is there while the plan is, and the gem is however long that has
 * been true.
 *
 * Shared by the server (which decides) and the client (which draws the ladder
 * on the Subscriptions page), so the names and thresholds exist once.
 */

export interface GeodeTier {
  /** 1-based rank; also the `tier` the badge is sorted by. */
  tier: number;
  /** Stable key — what the artwork is looked up by and what `icon` carries. */
  key: string;
  name: string;
  /** Whole months of continuous membership needed to reach it. */
  months: number;
  /** The same threshold as people say it — "1 year", "6+ years" — for the
   * ladder shown on the Marketplace and Subscriptions pages. */
  after: string;
}

/**
 * The ladder runs from one month to six years and over: 1 month, 3 months,
 * 6 months, 1 year, 2 years, 3 years, 5 years, 6+ years.
 *
 * The first gem is the "1 month" one, and it is worn from the moment someone
 * subscribes (its threshold is 0, not 1), so a new member's pill is never
 * empty. The seven after it are each a longer commitment than the last, with
 * the gaps widening because a year is a bigger thing to have kept up than a
 * quarter.
 */
export const GEODE_TIERS: readonly GeodeTier[] = [
  { tier: 1, key: "quartz", name: "Quartz", months: 0, after: "1 month" },
  { tier: 2, key: "amethyst", name: "Amethyst", months: 3, after: "3 months" },
  { tier: 3, key: "citrine", name: "Citrine", months: 6, after: "6 months" },
  { tier: 4, key: "topaz", name: "Topaz", months: 12, after: "1 year" },
  { tier: 5, key: "sapphire", name: "Sapphire", months: 24, after: "2 years" },
  { tier: 6, key: "emerald", name: "Emerald", months: 36, after: "3 years" },
  { tier: 7, key: "ruby", name: "Ruby", months: 60, after: "5 years" },
  // Opal rather than diamond: Bug Hunter already ends on a cyan Diamond, and two
  // badges of that name on one profile would read as the same thing twice.
  { tier: 8, key: "opal", name: "Opal", months: 72, after: "6+ years" },
];

/** "7 months", "1 year", "2 years, 3 months" — how long, for a tooltip. */
export function geodeTenureLabel(months: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (months < 12) return plural(Math.max(1, months), "month");
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? plural(years, "year") : `${plural(years, "year")}, ${plural(rest, "month")}`;
}

/** `BadgeView.icon` prefix that tells the client to draw Geode artwork. */
export const GEODE_ICON_PREFIX = "geode:";
export const GEODE_GROUP = "geode";

const MONTH_MS = 30.4375 * 24 * 60 * 60 * 1000;

/**
 * How long a lapse can be before the streak starts over.
 *
 * A declined renewal that is fixed the next morning, or a cancel and re-sub on
 * the same afternoon, should not cost someone a year of progress.
 */
export const GEODE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** The highest tier that `months` of membership has earned. */
export function geodeTierForMonths(months: number): GeodeTier {
  let reached = GEODE_TIERS[0];
  for (const tier of GEODE_TIERS) {
    if (months >= tier.months) reached = tier;
  }
  return reached;
}

export function geodeTierByKey(key: string): GeodeTier | undefined {
  return GEODE_TIERS.find((tier) => tier.key === key);
}

/** The tier after `tier`, or null at the top. */
export function nextGeodeTier(tier: GeodeTier): GeodeTier | null {
  return GEODE_TIERS.find((candidate) => candidate.tier === tier.tier + 1) ?? null;
}

/** Whether a plan's grant payload opts into the badge (`monthlyBadge`, the
 * switch in the SKU editor). A payload that can't be read earns nothing, the
 * same way a malformed one grants no discount in `store.prepareOrder`. */
export function planEarnsBadge(payload: string | undefined): boolean {
  if (!payload) return false;
  try {
    return (JSON.parse(payload) as { monthlyBadge?: unknown }).monthlyBadge === true;
  } catch {
    return false;
  }
}

export interface GeodeStanding {
  tier: GeodeTier;
  /** Whole months of continuous membership. */
  months: number;
  /** When the current unbroken run began. */
  since: number;
  next: GeodeTier | null;
  /** When `next` is reached, if the plan keeps going. */
  nextAt: number | null;
}

/**
 * Where a user stands, or null when they have no plan in force.
 *
 * Every plan entitlement counts, expired ones included — they are the history
 * the streak is made of. Each is a span from when it was granted to when it
 * ended (revoked, expired, or still going); spans closer together than
 * `GEODE_GRACE_MS` are one run, and the run that reaches `now` is the one that
 * is measured.
 *
 * One entitlement covers a whole subscription however many times it renews
 * (renewal moves `expiresAt`, see `setOrderEntitlementExpiry`), so a plain
 * year of monthly payments is one span rather than twelve to stitch.
 */
export function geodeStanding(
  entitlements: readonly Doc<"entitlements">[],
  now = Date.now(),
): GeodeStanding | null {
  const plans = entitlements.filter(
    (entitlement) => entitlement.kind === "plan" && planEarnsBadge(entitlement.payload),
  );
  if (!plans.some((plan) => isActive(plan, now))) return null;

  const spans = plans
    .map((plan) => {
      const stop = plan.revokedAt ?? plan.expiresAt ?? now;
      return { start: plan.createdAt, end: Math.min(stop, now) };
    })
    .filter((span) => span.end >= span.start)
    .sort((a, b) => a.start - b.start);
  if (spans.length === 0) return null;

  // Walk forward, restarting the run whenever the gap is too long. The last run
  // standing is the one containing the active plan, because that plan's span
  // ends at `now`.
  let runStart = spans[0].start;
  let runEnd = spans[0].end;
  for (const span of spans.slice(1)) {
    if (span.start - runEnd > GEODE_GRACE_MS) runStart = span.start;
    runEnd = Math.max(runEnd, span.end);
  }

  const months = Math.max(0, Math.floor((now - runStart) / MONTH_MS));
  const tier = geodeTierForMonths(months);
  const next = nextGeodeTier(tier);
  return {
    tier,
    months,
    since: runStart,
    next,
    nextAt: next ? Math.ceil(runStart + next.months * MONTH_MS) : null,
  };
}

/** The badge a standing is shown as, in the shape `badgesOf` returns. */
export function geodeBadge(standing: GeodeStanding) {
  const { tier, months, since } = standing;
  return {
    badgeId: `geode_${tier.tier}`,
    label: `Crystal Geode — ${tier.name}`,
    description:
      months < 1
        ? "Crystal Geode member."
        : `Crystal Geode member for ${geodeTenureLabel(months)}.`,
    icon: `${GEODE_ICON_PREFIX}${tier.key}`,
    imageUrl: undefined,
    className: undefined,
    group: GEODE_GROUP,
    tier: tier.tier,
    position: 1,
    grantedAt: since,
  };
}

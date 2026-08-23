import { Bug, IdCardLanyard, Sparkles, type LucideIcon } from "lucide-react";

/**
 * What each badge looks like and means.
 *
 * The database stores only an id (see `userBadges` in convex/schema.ts) — what
 * a badge is called and how it's drawn is presentation, and keeping it here
 * means renaming one is a code change rather than a migration. An id with no
 * entry here is skipped rather than rendered as a mystery pill, so a badge
 * granted by a newer build degrades quietly on an older one.
 */
export interface BadgeDefinition {
  label: string;
  /** Shown on hover — the reason someone has it. */
  description: string;
  icon: LucideIcon;
  /** Colour for the glyph. Each badge gets its own so a row of them reads as
   * distinct things rather than a row of the same thing. */
  className: string;
}

/**
 * Bug Hunter, tier 1–5.
 *
 * Tiers are separate badge ids rather than a count on one badge, because
 * `userBadges` stores ids and nothing else — a level field would be a schema
 * change, and this way a promotion is "revoke tier N, grant tier N+1" with no
 * new machinery. `bugHunterTier` below is what keeps only the highest one on
 * screen, so someone who has been through every tier shows one bug, not five.
 *
 * The metals are picked to survive the dark UI they're drawn on: real bronze
 * and silver are too close to the muted foreground to read as anything, so
 * these lean warm and cool respectively, and platinum/diamond separate by
 * going cyan rather than by getting lighter still.
 */
const BUG_HUNTER_TIERS: { id: string; tier: string; className: string }[] = [
  { id: "bug_hunter_1", tier: "Bronze", className: "text-amber-700 dark:text-amber-600" },
  { id: "bug_hunter_2", tier: "Silver", className: "text-slate-400 dark:text-slate-300" },
  { id: "bug_hunter_3", tier: "Gold", className: "text-yellow-500 dark:text-yellow-400" },
  { id: "bug_hunter_4", tier: "Platinum", className: "text-teal-300 dark:text-teal-200" },
  { id: "bug_hunter_5", tier: "Diamond", className: "text-cyan-400 dark:text-cyan-300" },
];

/** `bug_hunter_3` → `3`, and `null` for anything that isn't a Bug Hunter id. */
export function bugHunterTier(badgeId: string): number | null {
  const index = BUG_HUNTER_TIERS.findIndex((t) => t.id === badgeId);
  return index === -1 ? null : index + 1;
}

export const BADGES: Record<string, BadgeDefinition> = {
  poliberry_staff: {
    label: "Poliberry Staff",
    description: "Works on Crystal at Poliberry.",
    icon: IdCardLanyard,
    className: "text-sky-400",
  },
  early_supporter: {
    label: "Early Supporter",
    description: "Here before it was finished.",
    icon: Sparkles,
    className: "text-amber-400",
  },
  ...Object.fromEntries(
    BUG_HUNTER_TIERS.map(({ id, tier, className }, index) => [
      id,
      {
        label: `Bug Hunter — ${tier}`,
        description: `Found and reported bugs in Crystal. Tier ${index + 1} of ${BUG_HUNTER_TIERS.length}.`,
        icon: Bug,
        className,
      } satisfies BadgeDefinition,
    ])
  ),
};

export function badgeDefinition(badgeId: string): BadgeDefinition | undefined {
  return BADGES[badgeId];
}

/**
 * The badge ids to actually draw, given everything a user holds.
 *
 * Only the highest Bug Hunter tier survives. Someone promoted from Bronze to
 * Gold has usually been granted each tier along the way, and a row of three
 * identical bug glyphs says less than one gold one. Everything else passes
 * through untouched, in the order given.
 */
export function visibleBadgeIds(badgeIds: string[]): string[] {
  let bestTier = 0;
  for (const id of badgeIds) {
    const tier = bugHunterTier(id);
    if (tier !== null && tier > bestTier) bestTier = tier;
  }
  const winner = bestTier > 0 ? BUG_HUNTER_TIERS[bestTier - 1]!.id : null;
  return badgeIds.filter((id) => bugHunterTier(id) === null || id === winner);
}

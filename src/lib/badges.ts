import { IdCardLanyard, Sparkles, type LucideIcon } from "lucide-react";

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
};

export function badgeDefinition(badgeId: string): BadgeDefinition | undefined {
  return BADGES[badgeId];
}

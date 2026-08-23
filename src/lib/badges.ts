import { Sparkles, type LucideIcon } from "lucide-react";

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
  /** Tailwind classes for the pill. Each badge gets its own colour so a row
   * of them reads as distinct things rather than a row of the same thing. */
  className: string;
}

export const BADGES: Record<string, BadgeDefinition> = {
  early_supporter: {
    label: "Early Supporter",
    description: "Here before it was finished.",
    icon: Sparkles,
    className: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
};

export function badgeDefinition(badgeId: string): BadgeDefinition | undefined {
  return BADGES[badgeId];
}

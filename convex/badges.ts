import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireStaff } from "./lib/staff";
import { getCurrentUserOrNull } from "./users";

/**
 * The badge catalogue: what each badge is called, what it means, and how it's
 * drawn.
 *
 * It used to be a map in the client bundle. Moving it here is what lets a badge
 * be added without shipping a release — and stops a badge granted by a newer
 * build from rendering as nothing at all on an older one, which is what
 * happened when the *definition* only existed in code.
 *
 * Nothing in here is per-user: `userBadges` holds who has what, and this holds
 * what those ids mean.
 */

/** The shape every reader gets, with the stored document's bookkeeping left
 * behind. */
export interface BadgeView {
  badgeId: string;
  label: string;
  description: string;
  icon?: string;
  imageUrl?: string;
  className?: string;
  group?: string;
  tier?: number;
  position?: number;
}

export function badgeView(badge: Doc<"badges">): BadgeView {
  return {
    badgeId: badge.badgeId,
    label: badge.label,
    description: badge.description,
    icon: badge.icon,
    imageUrl: badge.imageUrl,
    className: badge.className,
    group: badge.group,
    tier: badge.tier,
    position: badge.position,
  };
}

export async function badgeByIdMap(ctx: QueryCtx): Promise<Map<string, Doc<"badges">>> {
  const rows = await ctx.db.query("badges").collect();
  return new Map(rows.map((row) => [row.badgeId, row]));
}

/**
 * Every badge that exists, in the order they'd be drawn.
 *
 * The whole catalogue rather than a page of it: it is a handful of rows that
 * every profile card needs the whole of, and paginating "the list of things a
 * badge can be" would cost more than it saves.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const rows = await ctx.db.query("badges").collect();
    return rows
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.badgeId.localeCompare(b.badgeId))
      .map(badgeView);
  },
});

/**
 * Define a badge, or change one that exists.
 *
 * Internal, and keyed on `badgeId`: badges are granted by id from code paths
 * like `syncStaffBadge`, so the id is the contract and everything else about a
 * badge is editable without touching a single `userBadges` row.
 */
export const upsert = internalMutation({
  args: {
    badgeId: v.string(),
    label: v.string(),
    description: v.string(),
    icon: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    className: v.optional(v.string()),
    group: v.optional(v.string()),
    tier: v.optional(v.number()),
    position: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("badges")
      .withIndex("by_badge_id", (q) => q.eq("badgeId", args.badgeId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return ctx.db.insert("badges", args);
  },
});

/**
 * Delete a definition.
 *
 * The grants are deliberately left alone: `badgesOf` skips an id it can't
 * resolve, so removing a badge from the catalogue hides it everywhere without
 * destroying the record that someone earned it — and putting the definition
 * back brings it straight back.
 */
export const remove = internalMutation({
  args: { badgeId: v.string() },
  handler: async (ctx, { badgeId }) => {
    const existing = await ctx.db
      .query("badges")
      .withIndex("by_badge_id", (q) => q.eq("badgeId", badgeId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

/**
 * The badges this build shipped with, as rows.
 *
 * Run once against a deployment that predates the table
 * (`npx convex run badges:seedDefaults`); idempotent, so running it again just
 * brings the wording and glyphs back in line with what's written here.
 *
 * The Bug Hunter metals are picked to survive the dark UI they're drawn on:
 * real bronze and silver are too close to the muted foreground to read as
 * anything, so these lean warm and cool respectively, and platinum/diamond
 * separate by going cyan rather than by getting lighter still.
 */
const BUG_HUNTER_TIERS = [
  { tier: 1, name: "Bronze", className: "text-amber-700 dark:text-amber-600" },
  { tier: 2, name: "Silver", className: "text-slate-400 dark:text-slate-300" },
  { tier: 3, name: "Gold", className: "text-yellow-500 dark:text-yellow-400" },
  { tier: 4, name: "Platinum", className: "text-teal-300 dark:text-teal-200" },
  { tier: 5, name: "Diamond", className: "text-cyan-400 dark:text-cyan-300" },
];

export const DEFAULT_BADGES: BadgeView[] = [
  {
    badgeId: "official",
    label: "OFFICIAL",
    description: "Official Crystal system account.",
    icon: "BsPatchCheckFill",
    className: "text-sky-400",
    position: -1,
  },
  {
    badgeId: "poliberry_staff",
    label: "Poliberry Staff",
    description: "Works on Crystal at Poliberry.",
    icon: "BsFillPersonBadgeFill",
    className: "text-sky-400",
    position: 0,
  },
  {
    badgeId: "early_supporter",
    label: "Early Supporter",
    description: "Here before it was finished.",
    icon: "BsStars",
    className: "text-amber-400",
    position: 1,
  },
  ...BUG_HUNTER_TIERS.map(({ tier, name, className }) => ({
    badgeId: `bug_hunter_${tier}`,
    label: `Bug Hunter — ${name}`,
    description: `Found and reported bugs in Crystal. Tier ${tier} of ${BUG_HUNTER_TIERS.length}.`,
    icon: "BsBugFill",
    className,
    group: "bug_hunter",
    tier,
    position: 2,
  })),
];;

/**
 * The definition for a badge id, creating it from the built-in set if the catalogue has never been seeded. Only ever fills a
 * gap: a definition someone has edited is never overwritten. Null for an id that is neither in the catalogue nor built in.
 */
export async function ensureBadgeDefinition(ctx: MutationCtx, badgeId: string): Promise<Doc<"badges"> | null> {
  const existing = await ctx.db.query("badges").withIndex("by_badge_id", (q) => q.eq("badgeId", badgeId)).unique();
  if (existing) return existing;
  const builtIn = DEFAULT_BADGES.find((b) => b.badgeId === badgeId);
  if (!builtIn) return null;
  const id = await ctx.db.insert("badges", builtIn);
  return ctx.db.get(id);
}

/**
 * Every badge staff can give: the catalogue, plus any built-in badge it doesn't have a row for yet (so a deployment that
 * never ran `seedDefaults` still offers Poliberry Staff, Early Supporter and the Bug Hunter tiers). `defined` says whether
 * there is a row; granting one that isn't creates it.
 */
export const adminCatalogue = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx, "users.read");
    const rows = (await ctx.db.query("badges").collect()).map((row) => ({ ...badgeView(row), defined: true }));
    const have = new Set(rows.map((r) => r.badgeId));
    const missing = DEFAULT_BADGES.filter((b) => !have.has(b.badgeId)).map((b) => ({ ...b, defined: false }));
    return [...rows, ...missing].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.tier ?? 0) - (b.tier ?? 0) || a.badgeId.localeCompare(b.badgeId));
  },
});

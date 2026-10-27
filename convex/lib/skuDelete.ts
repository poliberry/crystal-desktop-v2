/**
 * Which catalogue items staff may delete outright.
 *
 * Deleting is for cosmetics — artwork, effects, nameplates, scenes, theme packs, and bundles of them. Anything that keeps
 * doing something after it is bought (a plan that renews, a boost a community is running on) is archived instead, so the
 * people relying on it aren't cut off by a delete.
 */

/** Grants that act on an account or community for as long as they are held. */
const ONGOING_KINDS = ["plan", "communityBoost"] as const;

export function deleteBlocker(sku: { type: string; grants: readonly { kind: string }[] }): string | null {
  if (sku.type === "subscription") return "A subscription can't be deleted while people may be paying for it. Archive it instead.";
  if (sku.type === "community") return "A community item can't be deleted: communities are running on it. Archive it instead.";
  if (sku.grants.some((g) => (ONGOING_KINDS as readonly string[]).includes(g.kind))) {
    return "It includes a plan or a community boost, which people rely on. Archive it instead.";
  }
  return null;
}

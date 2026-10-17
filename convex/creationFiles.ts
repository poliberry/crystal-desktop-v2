import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";

/**
 * Deleting marketplace artwork once nobody can use it any more.
 *
 * A creator's uploads live in `marketplace/creations/<creator>/`, which the everyday clean-up paths
 * never touch (`lib/r2.ts PROTECTED_PREFIX`): one file there is shared by everyone who bought the
 * item. So these files go only through here, and only after checking that no listing, no open or
 * approved submission and no buyer's entitlement still refers to them. A purchase keeps its artwork
 * even after the item is retired or deleted from the shop.
 *
 * Uploads are content-addressed, so the same artwork submitted twice is one file. That's why the
 * check covers the creator's other items too, not just the one being removed.
 */

const KEY_RE = /marketplace\/creations\/[^"'\s)\\]+/g;

/** Every creation file mentioned in some strings (URLs, or JSON payloads that contain URLs). */
export function creationKeysIn(...texts: (string | null | undefined)[]): string[] {
  const keys = new Set<string>();
  for (const text of texts) for (const match of text?.match(KEY_RE) ?? []) keys.add(match);
  return [...keys];
}

/** The files a listing or submission uses: its grants' payloads and its pictures. */
export function filesOf(row: { grants: { payload?: string }[]; imageUrl?: string; previewUrl?: string }): string[] {
  return creationKeysIn(row.imageUrl, row.previewUrl, ...row.grants.map((g) => g.payload));
}

/**
 * Schedule a check-then-delete for some creation files. `skuIds` are items whose buyers must be
 * checked even if the item itself is already gone (a staff delete); the creator's own items are always
 * checked.
 */
export async function releaseCreationFiles(
  ctx: Pick<MutationCtx, "scheduler">,
  creatorId: Id<"users"> | undefined,
  keys: string[],
  skuIds: Id<"skus">[] = []
): Promise<void> {
  if (!creatorId || keys.length === 0) return;
  await ctx.scheduler.runAfter(0, internal.creationFiles.releaseIfUnused, { creatorId, keys, skuIds });
}

export const releaseIfUnused = internalMutation({
  args: { creatorId: v.id("users"), keys: v.array(v.string()), skuIds: v.array(v.id("skus")) },
  handler: async (ctx, { creatorId, keys, skuIds }) => {
    // Everything that could refer to this creator's files, as text to search.
    const haystack: string[] = [];
    const skus = (await ctx.db.query("skus").collect()).filter((s) => s.creatorId === creatorId);
    for (const sku of skus) haystack.push(JSON.stringify([sku.grants, sku.imageUrl]));
    for (const status of ["pending", "approved"] as const) {
      const rows = (await ctx.db.query("marketplaceSubmissions").withIndex("by_creator", (q) => q.eq("creatorId", creatorId)).collect()).filter((r) => r.status === status);
      for (const row of rows) haystack.push(JSON.stringify([row.grants, row.previewUrl]));
    }
    // Buyers keep what they bought, even from items no longer for sale (or deleted outright).
    const allSkuIds = new Set<Id<"skus">>([...skus.map((s) => s._id), ...skuIds]);
    for (const skuId of allSkuIds) {
      for (const e of await ctx.db.query("entitlements").withIndex("by_sku", (q) => q.eq("skuId", skuId)).collect()) {
        if (e.payload) haystack.push(e.payload);
      }
    }
    const text = haystack.join("\n");
    for (const key of keys) {
      if (!key.startsWith("marketplace/creations/") || text.includes(key)) continue;
      await ctx.scheduler.runAfter(0, internal.cdnInternal.deleteCreationObject, { key });
      const asset = await ctx.db.query("r2Assets").withIndex("by_key", (q) => q.eq("key", key)).unique();
      if (asset) await ctx.db.delete(asset._id);
    }
  },
});

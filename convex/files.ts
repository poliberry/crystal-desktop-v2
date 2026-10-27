import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";

/**
 * The second half of `lib/files.ts releaseFile`: runs after the mutation that removed a file's row has
 * committed, checks nothing else still uses the file, then deletes it.
 */

async function keyInUse(ctx: MutationCtx, cdnKey: string): Promise<boolean> {
  return !!(
    (await ctx.db.query("messageAttachments").withIndex("by_cdn_key", (q) => q.eq("cdnKey", cdnKey)).first()) ||
    (await ctx.db.query("channelMessageAttachments").withIndex("by_cdn_key", (q) => q.eq("cdnKey", cdnKey)).first()) ||
    (await ctx.db.query("loungeMessages").withIndex("by_image_key", (q) => q.eq("image.cdnKey", cdnKey)).first()) ||
    (await ctx.db.query("fileHolds").withIndex("by_cdn_key", (q) => q.eq("cdnKey", cdnKey)).first())
  );
}

async function storageInUse(ctx: MutationCtx, storageId: Id<"_storage">): Promise<boolean> {
  return !!(
    (await ctx.db.query("messageAttachments").withIndex("by_storage", (q) => q.eq("storageId", storageId)).first()) ||
    (await ctx.db.query("channelMessageAttachments").withIndex("by_storage", (q) => q.eq("storageId", storageId)).first()) ||
    (await ctx.db.query("loungeMessages").withIndex("by_image_storage", (q) => q.eq("image.storageId", storageId)).first()) ||
    (await ctx.db.query("fileHolds").withIndex("by_storage", (q) => q.eq("storageId", storageId)).first())
  );
}

export const releaseIfUnused = internalMutation({
  args: { cdnKey: v.optional(v.string()), storageId: v.optional(v.id("_storage")) },
  handler: async (ctx, { cdnKey, storageId }) => {
    if (storageId && !(await storageInUse(ctx, storageId))) {
      await ctx.storage.delete(storageId).catch(() => {});
    }
    if (cdnKey && !(await keyInUse(ctx, cdnKey))) {
      await ctx.scheduler.runAfter(0, internal.cdnInternal.deleteR2Object, { key: cdnKey });
      const asset = await ctx.db.query("r2Assets").withIndex("by_key", (q) => q.eq("key", cdnKey)).unique();
      if (asset) await ctx.db.delete(asset._id);
    }
  },
});

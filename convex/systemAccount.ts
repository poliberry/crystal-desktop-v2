import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireStaff } from "./lib/staff";

const SYSTEM_CLERK_ID = "system:crystal";

async function account(ctx: any) {
  const user = await ctx.db.query("users").withIndex("by_clerk_id", (q: any) => q.eq("clerkId", SYSTEM_CLERK_ID)).unique();
  if (!user) throw new Error("Provision the Crystal system account before editing it.");
  return user;
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx, "system.manage");
    const user = await account(ctx);
    return { id: user._id, name: user.name, username: user.username, bio: user.bio ?? "", imageUrl: user.imageUrl, bannerUrl: user.bannerUrl };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx, "system.manage");
    await account(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const update = mutation({
  args: { bio: v.optional(v.string()), avatarStorageId: v.optional(v.id("_storage")), bannerStorageId: v.optional(v.id("_storage")) },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx, "system.manage");
    const user = await account(ctx);
    const patch: { bio?: string; imageUrl?: string; avatarStorageId?: Id<"_storage">; bannerUrl?: string; bannerStorageId?: Id<"_storage"> } = {};
    if (args.bio !== undefined) patch.bio = args.bio.trim().slice(0, 300);
    if (args.avatarStorageId) {
      const url = await ctx.storage.getUrl(args.avatarStorageId);
      if (!url) throw new Error("Avatar upload could not be resolved.");
      patch.imageUrl = url; patch.avatarStorageId = args.avatarStorageId;
    }
    if (args.bannerStorageId) {
      const url = await ctx.storage.getUrl(args.bannerStorageId);
      if (!url) throw new Error("Banner upload could not be resolved.");
      patch.bannerUrl = url; patch.bannerStorageId = args.bannerStorageId;
    }
    if (Object.keys(patch).length) await ctx.db.patch(user._id, patch);
    await ctx.db.insert("staffAuditLog", { actorId: staff.user._id, action: "system_account.update", targetType: "user", targetId: user._id, summary: Object.keys(patch).join(", "), createdAt: Date.now() });
    return { ...user, ...patch };
  },
});

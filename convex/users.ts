import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";

export async function getCurrentUserOrNull(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
}

export async function getCurrentUserOrThrow(ctx: QueryCtx): Promise<Doc<"users">> {
  const user = await getCurrentUserOrNull(ctx);
  if (!user) throw new Error("Not authenticated, or user has not been bootstrapped yet.");
  return user;
}

function deriveUsername(identity: { nickname?: string; email?: string; givenName?: string }): string {
  const base = identity.nickname ?? identity.email?.split("@")[0] ?? identity.givenName ?? "user";
  return base.toLowerCase().replace(/[^a-z0-9_.]/g, "");
}

export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated.");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    const name = identity.name ?? identity.nickname ?? identity.email ?? "New user";
    const imageUrl = typeof identity.pictureUrl === "string" ? identity.pictureUrl : undefined;

    if (existing) {
      if (existing.name !== name || existing.imageUrl !== imageUrl) {
        await ctx.db.patch(existing._id, { name, imageUrl });
      }
      return existing._id;
    }

    let username = deriveUsername(identity) || "user";
    let suffix = 0;
    while (
      await ctx.db
        .query("users")
        .withIndex("by_username", (q) => q.eq("username", username))
        .unique()
    ) {
      suffix += 1;
      username = `${deriveUsername(identity) || "user"}${suffix}`;
    }

    return ctx.db.insert("users", { clerkId: identity.subject, name, username, imageUrl });
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => getCurrentUserOrNull(ctx),
});

export const searchByUsername = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const me = await getCurrentUserOrNull(ctx);
    const normalized = username.trim().toLowerCase();
    if (!normalized || !me) return null;
    const match = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", normalized))
      .unique();
    if (!match || match._id === me._id) return null;
    return { id: match._id, name: match.name, username: match.username, imageUrl: match.imageUrl };
  },
});

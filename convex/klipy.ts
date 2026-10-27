import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { isValidKlipySlug, MAX_KLIPY_FAVOURITES } from "./lib/klipy";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

/**
 * A person's favourite KLIPY GIFs, clips and stickers.
 *
 * This is the whole of the server's part in the integration. KLIPY's rules have the person's own client make every API
 * request and load the media itself, so nothing here talks to KLIPY or holds any media: a favourite is a kind and a
 * slug, and the picker turns slugs back into pictures through KLIPY's items endpoint (see src/lib/klipy.ts).
 */

const kind = v.union(v.literal("gif"), v.literal("clip"), v.literal("sticker"));

/** Newest first. Empty when signed out, so the picker can mount before the session is ready. */
export const listFavourites = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const rows = await ctx.db
      .query("klipyFavourites")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .order("desc")
      .take(MAX_KLIPY_FAVOURITES);
    return rows.map((row) => ({ kind: row.kind, slug: row.slug }));
  },
});

/** Idempotent: favouriting something already favourited changes nothing. */
export const addFavourite = mutation({
  args: { kind, slug: v.string() },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    if (!isValidKlipySlug(args.slug)) throw new Error("That isn't something that can be saved.");

    const existing = await ctx.db
      .query("klipyFavourites")
      .withIndex("by_user_item", (q) => q.eq("userId", me._id).eq("kind", args.kind).eq("slug", args.slug))
      .first();
    if (existing) return;

    const all = await ctx.db
      .query("klipyFavourites")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .take(MAX_KLIPY_FAVOURITES);
    if (all.length >= MAX_KLIPY_FAVOURITES) {
      throw new Error(`You can keep up to ${MAX_KLIPY_FAVOURITES} favourites. Remove one to make room.`);
    }

    await ctx.db.insert("klipyFavourites", { userId: me._id, kind: args.kind, slug: args.slug, createdAt: Date.now() });
  },
});

/** Idempotent: removing something that isn't a favourite changes nothing. */
export const removeFavourite = mutation({
  args: { kind, slug: v.string() },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const rows = await ctx.db
      .query("klipyFavourites")
      .withIndex("by_user_item", (q) => q.eq("userId", me._id).eq("kind", args.kind).eq("slug", args.slug))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
  },
});

import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation, query } from "./_generated/server";

export const get = query({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    return ctx.db
      .query("linkPreviews")
      .withIndex("by_url", (q) => q.eq("url", url))
      .unique();
  },
});

export const upsert = internalMutation({
  args: {
    url: v.string(),
    status: v.union(v.literal("ok"), v.literal("error")),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    image: v.optional(v.string()),
    siteName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("linkPreviews")
      .withIndex("by_url", (q) => q.eq("url", args.url))
      .unique();
    const doc = { ...args, fetchedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
    } else {
      await ctx.db.insert("linkPreviews", doc);
    }
  },
});

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractMeta(html: string, property: string): string | undefined {
  // <meta> attributes can appear in either order, so try both.
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeEntities(match[1]);
  }
  return undefined;
}

export const fetchAndCache = action({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Unsupported protocol.");
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let response: Response;
      try {
        response = await fetch(url, { signal: controller.signal, redirect: "follow" });
      } finally {
        clearTimeout(timeout);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.includes("text/html")) {
        throw new Error("Not an HTML page.");
      }

      const html = (await response.text()).slice(0, 200_000);
      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      const title = extractMeta(html, "og:title") ?? (titleMatch ? decodeEntities(titleMatch[1]) : undefined);

      await ctx.runMutation(internal.linkPreviews.upsert, {
        url,
        status: "ok",
        title,
        description: extractMeta(html, "og:description"),
        image: extractMeta(html, "og:image"),
        siteName: extractMeta(html, "og:site_name"),
      });
    } catch {
      await ctx.runMutation(internal.linkPreviews.upsert, { url, status: "error" });
    }
  },
});

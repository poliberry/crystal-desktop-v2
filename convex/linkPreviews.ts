import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, internalMutation, query } from "./_generated/server";
import { fetchOEmbed, matchProvider } from "./lib/richEmbeds";

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
    provider: v.optional(v.string()),
    kind: v.optional(v.union(v.literal("link"), v.literal("video"), v.literal("audio"))),
    authorName: v.optional(v.string()),
    authorUrl: v.optional(v.string()),
    embedUrl: v.optional(v.string()),
    embedAspect: v.optional(v.number()),
    embedHeight: v.optional(v.number()),
    themeColor: v.optional(v.string()),
    faviconUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("linkPreviews")
      .withIndex("by_url", (q) => q.eq("url", args.url))
      .unique();
    const doc = { ...args, fetchedAt: Date.now() };
    if (existing) {
      // `replace`, not `patch`: a re-fetch that no longer finds (say) an
      // author or a player must clear the old one rather than leave it
      // behind. `_id`/`_creationTime` are supplied by Convex.
      await ctx.db.replace(existing._id, doc);
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

/** First of several meta tags to be present — OpenGraph if the site has it,
 * Twitter cards if it only has those, plain `<meta name>` as a last resort. */
function firstMeta(html: string, ...properties: string[]): string | undefined {
  for (const property of properties) {
    const value = extractMeta(html, property);
    if (value) return value;
  }
  return undefined;
}

/** `#rrggbb` / `#rgb` only. A theme colour goes straight into a style
 * attribute, so anything we can't recognise is dropped rather than passed
 * through. */
function safeColour(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed) ? trimmed : undefined;
}

/** Resolve a possibly-relative asset path (favicons especially) against the
 * page it came from, dropping anything that isn't http(s). */
function absoluteUrl(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const resolved = new URL(value, base);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function extractFavicon(html: string, base: string): string | undefined {
  const match = html.match(
    /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/i
  );
  return absoluteUrl(match?.[1] ?? "/favicon.ico", base);
}

/**
 * Unfurl a URL once and cache the result for everyone.
 *
 * Two sources, in order of trust: a recognised provider's oEmbed document
 * (canonical title, uploader, thumbnail — see lib/richEmbeds.ts), then the
 * page's own OpenGraph/Twitter-card tags. They're combined rather than being
 * either/or, because oEmbed carries no description and OpenGraph carries no
 * author.
 *
 * Failures are cached too, as `status: "error"`: a link that can't be
 * unfurled shouldn't be re-fetched by every client that renders the message.
 */
export const fetchAndCache = action({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Unsupported protocol.");
      }

      const match = matchProvider(url);
      const oEmbedData = match?.oEmbedUrl ? await fetchOEmbed(match.oEmbedUrl) : null;

      // Scrape the page as well: oEmbed never carries a description, and a
      // provider we recognise can still fail to answer.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let html = "";
      try {
        const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
        const contentType = response.headers.get("content-type") ?? "";
        if (response.ok && contentType.includes("text/html")) {
          html = (await response.text()).slice(0, 200_000);
        }
      } catch {
        // A page that won't load is fine as long as oEmbed answered.
      } finally {
        clearTimeout(timeout);
      }

      if (!html && !oEmbedData) throw new Error("Nothing to unfurl.");

      const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      const title =
        oEmbedData?.title ??
        firstMeta(html, "og:title", "twitter:title") ??
        (titleTag ? decodeEntities(titleTag[1]) : undefined);

      await ctx.runMutation(internal.linkPreviews.upsert, {
        url,
        status: "ok",
        title,
        description: firstMeta(html, "og:description", "twitter:description", "description"),
        image:
          oEmbedData?.thumbnail_url ??
          absoluteUrl(firstMeta(html, "og:image", "og:image:url", "twitter:image"), url),
        siteName:
          firstMeta(html, "og:site_name") ?? oEmbedData?.provider_name ?? parsed.hostname.replace(/^www\./, ""),
        provider: match?.provider,
        kind: match?.kind ?? "link",
        authorName: oEmbedData?.author_name,
        authorUrl: oEmbedData?.author_url,
        embedUrl: match?.embedUrl,
        embedAspect: match?.embedAspect,
        embedHeight: match?.embedHeight,
        themeColor: safeColour(firstMeta(html, "theme-color", "msapplication-TileColor")),
        faviconUrl: html ? extractFavicon(html, url) : undefined,
      });
    } catch (err) {
      // Logged, not silent: an unfurl that fails is invisible in the UI by
      // design (no card), which makes a systematic failure — a provider
      // blocking us, a schema mismatch — impossible to tell apart from a link
      // that genuinely has no metadata.
      console.warn(`Link unfurl failed for ${url}:`, err);
      await ctx.runMutation(internal.linkPreviews.upsert, { url, status: "error" });
    }
  },
});

import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { r2PublicUrlForKey } from "./lib/r2";

/**
 * Original Crystal cosmetics inspired by broad collectible moods (fantasy,
 * cyberpunk, seasonal, arcade, galaxy and food), not copied archive artwork.
 * The source is deliberately deterministic: publishing again replaces the
 * same protected CDN objects and updates the same SKU rows.
 */
const PUBLISH_FOLDER = "marketplace/crystal-archive-inspired/v1";

type Kind = "nameplate" | "profileEffect" | "profileSticker" | "avatarDecoration";
type Design = { slug: string; name: string; kind: Kind; palette: [string, string, string]; motif: string; description: string };

const groups: [Kind, string[]][] = [
  ["nameplate", ["Prism Parade"]],
  ["profileEffect", ["Prism Parade"]],
  ["profileSticker", ["Prism Parade"]],
  ["avatarDecoration", ["Prism Parade"]],
];

const retiredNames = ["Moonlit Ribbon", "Velvet Comet", "Midnight Arcade", "Copper Current", "Frosted Signal", "Solar Picnic", "Neon Orchard", "Tidal Glyph", "Ember Postcard", "Cloud Nine", "Pixel Bazaar", "Astral Ticket", "Mossy Quest", "Bubblegum Static"];
const retiredSlugs = new Set(groups.flatMap(([kind]) => retiredNames.map((name) => `${kind}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`)));

const designs: Design[] = groups.flatMap(([kind, names]) => names.map((name) => {
  const slug = `${kind}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const [a, b, c] = ["#7c3aed", "#22d3ee", "#120d24"];
  return { slug, name, kind, palette: [a, b, c], motif: "gradient", description: "A clean Prism Parade gradient for a bright, polished profile." };
}));

const designValidator = v.object({
  slug: v.string(), name: v.string(), kind: v.union(v.literal("nameplate"), v.literal("profileEffect"), v.literal("profileSticker"), v.literal("avatarDecoration")),
  palette: v.array(v.string()), motif: v.string(), description: v.string(), artworkUrl: v.string(),
});

function svgFor(d: Design): string {
  const [a, b, c] = d.palette;
  const square = d.kind === "avatarDecoration" || d.kind === "profileSticker";
  const width = square ? 400 : 960;
  const height = square ? 400 : 176;
  const radius = square ? 82 : 34;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a}"/><stop offset=".52" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs><rect width="${width}" height="${height}" rx="${radius}" fill="url(#g)"/></svg>`;
}

export const publish = internalAction({
  args: {},
  handler: async (ctx) => {
    const accountId = process.env.R2_ACCOUNT_ID;
    const bucket = process.env.R2_BUCKET;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !bucket || !accessKeyId || !secretAccessKey || !r2PublicUrlForKey("x")) throw new Error("The dev deployment has no CDN configuration.");
    const { AwsClient } = await import("aws4fetch");
    const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
    const base = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
    const records = designs.map((design) => ({ ...design, artworkUrl: r2PublicUrlForKey(`${PUBLISH_FOLDER}/${design.slug}.svg`) }));
    for (const slug of retiredSlugs) {
      await client.fetch(`${base}/${PUBLISH_FOLDER}/${slug}.svg`, { method: "DELETE" });
    }
    for (const design of designs) {
      const key = `${PUBLISH_FOLDER}/${design.slug}.svg`;
      const response = await client.fetch(`${base}/${key}`, { method: "PUT", body: svgFor(design), headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=31536000, immutable" } });
      if (!response.ok) throw new Error(`Couldn't publish ${design.slug} (${response.status}).`);
    }
    await ctx.runMutation(internal.discordInspiredPublish.upsert, { records });
    return { published: records.length, folder: PUBLISH_FOLDER };
  },
});

export const upsert = internalMutation({
  args: { records: v.array(designValidator) },
  handler: async (ctx, { records }) => {
    const crystal = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", "crystal")).unique();
    if (!crystal) throw new Error("Crystal system user is missing.");
    const categories = new Map<string, Id<"skuCategories">>();
    for (const slug of ["avatar-decorations", "profile-style"]) {
      const row = await ctx.db.query("skuCategories").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
      if (row) categories.set(slug, row._id);
    }
    const now = Date.now();
    for (const sku of await ctx.db.query("skus").collect()) {
      if (retiredSlugs.has(sku.slug) && sku.status === "active") {
        await ctx.db.patch(sku._id, { status: "archived", featured: false, updatedAt: now });
      }
    }
    const result: string[] = [];
    for (const [position, design] of records.entries()) {
      const categoryId = categories.get(design.kind === "avatarDecoration" ? "avatar-decorations" : "profile-style");
      if (!categoryId) throw new Error("Starter catalogue categories are missing.");
      const kind = design.kind;
      const payload = kind === "avatarDecoration" || kind === "profileSticker"
        ? JSON.stringify([{ id: "art", url: design.artworkUrl, anchor: kind === "avatarDecoration" ? "center" : "bottom", x: 50, y: kind === "avatarDecoration" ? 0 : -8, width: kind === "avatarDecoration" ? 100 : 54 }])
        : design.artworkUrl;
      const grant = { kind, payload, label: design.name };
      const existing = await ctx.db.query("skus").withIndex("by_slug", (q) => q.eq("slug", design.slug)).unique();
      if (existing) {
        await ctx.db.patch(existing._id, { name: design.name, description: design.description, categoryId, grants: [grant], imageUrl: design.artworkUrl, status: "active", featured: position < 12, updatedAt: now });
        result.push(existing._id);
      } else {
        const id = await ctx.db.insert("skus", { slug: design.slug, name: design.name, description: design.description, categoryId, type: "cosmetic", priceCents: 0, currency: "usd", grants: [grant], imageUrl: design.artworkUrl, status: "active", featured: position < 12, position, createdBy: crystal._id, createdAt: now, updatedAt: now });
        result.push(id);
      }
    }
    return { published: result.length, skuIds: result };
  },
});

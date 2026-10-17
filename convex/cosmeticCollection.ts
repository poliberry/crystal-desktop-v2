import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";
import { COLLECTION_DECORATIONS, COLLECTION_DESIGNS, buildDesign, grantKindOf } from "./lib/cosmeticCollection";
import { normalizeMotionSpec } from "./lib/motion";
import { MAX_MOTION_BYTES, MOTION_FOLDER, canonicalJson, isMotionAddress } from "./lib/motionAddress";
import { isR2Enabled, r2PublicUrlForKey } from "./lib/r2";
import { audit } from "./lib/staff";

/**
 * Puts the Archive collection (convex/lib/cosmeticCollection.ts, src/lib/avatar-decoration-collection.ts) in the shop.
 *
 * Run by an operator, not callable from the app: these are internal functions, so only `npx convex run` (or another function on
 * the server) can start them, against whichever deployment the command names:
 *
 *   npx convex run cosmeticCollection:publish '{"dryRun":true}'     check everything and say what would be written
 *   npx convex run cosmeticCollection:publish                       the dev deployment
 *   npx convex run cosmeticCollection:publish --prod                production
 *
 * What it does:
 *
 *  1. Builds every nameplate and profile effect, runs it through the same `normalizeMotionSpec` that guards a creator's upload,
 *     and refuses the lot if any would be changed by it, has a picture address, or is too large. Nothing is written until all pass.
 *  2. Writes each as `marketplace/motion/<sha256>.json` (the same place and name `motion.publish` uses, so it is content-addressed,
 *     immutable and never deleted by the clean-up paths). The same design is the same address, so running this again is harmless.
 *  3. Creates the SKUs, **as drafts**. A draft is not for sale and is not sent to Stripe; someone with `pricing.write` reviews the
 *     suggested price and publishes it from the console. Running it again refreshes a SKU that is still a draft. The Storm Chaser
 *     effect is the one exception: its rendering was too costly and too dark, so its existing listing and owners receive the updated
 *     design while its price and sale status stay as they are.
 */

const ONE_PRICE_NOTE = "suggested price";

const noPictures = (url: string): string => {
  throw new Error(`a collection design has a picture address (${url}); the collection is made only of generators`);
};

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const itemValidator = v.object({
  slug: v.string(),
  name: v.string(),
  description: v.string(),
  category: v.union(v.literal("avatar-decorations"), v.literal("profile-style")),
  kind: v.union(v.literal("avatarDecoration"), v.literal("profileEffect"), v.literal("nameplate")),
  payload: v.string(),
  priceCents: v.number(),
});

export const publish = internalAction({
  args: { dryRun: v.optional(v.boolean()), only: v.optional(v.array(v.string())), createdBy: v.optional(v.id("users")) },
  handler: async (ctx, { dryRun, only, createdBy }) => {
    const items: (typeof itemValidator.type)[] = [];

    // Avatar decorations are published by `publishDecorations`, which uploads their artwork: they are not `builtin:` keys, because
    // only builds that contain the key's artwork can draw one, and an older build draws nothing.

    const files: { key: string; body: string; slug: string }[] = [];
    {
      if (!dryRun && !isR2Enabled()) throw new Error("This deployment has no CDN configured (R2_* settings), so there is nowhere to publish nameplates and effects. ");
      // Nothing is written until every design has been checked: a bad one can't leave the collection half published.
      const chosen = COLLECTION_DESIGNS.filter((d) => !only || only.includes(d.slug));
      if (only && chosen.length !== only.length) throw new Error(`Unknown design in only: ${only.filter((o) => !COLLECTION_DESIGNS.some((d) => d.slug === o)).join(", ")}.`);
      for (const d of chosen) {
        const spec = JSON.parse(JSON.stringify(buildDesign(d)));
        const checked = normalizeMotionSpec(JSON.parse(JSON.stringify(spec)), noPictures);
        if (canonicalJson(checked.clips) !== canonicalJson(spec.clips)) throw new Error(`${d.slug} isn't what the validator would store, so nothing was published.`);
        if ((checked.loop.from ?? 0) !== d.intro) throw new Error(`${d.slug} has an intro of ${d.intro}s that the validator would not keep, so nothing was published.`);
        const text = canonicalJson(checked);
        const bytes = new TextEncoder().encode(text).byteLength;
        if (bytes > MAX_MOTION_BYTES) throw new Error(`${d.slug} is too large (${Math.ceil(bytes / 1024)} KB; the limit is ${MAX_MOTION_BYTES / 1024} KB).`);
        const key = `${MOTION_FOLDER}${await sha256Hex(text)}.json`;
        files.push({ key, body: text, slug: d.slug });
        const url = r2PublicUrlForKey(key);
        if (!dryRun && !isMotionAddress(url)) throw new Error(`${d.slug} would be published at ${url}, which is not the form of address a motion grant may carry. Check R2_PUBLIC_URL.`);
        items.push({ slug: d.slug, name: d.name, description: d.description, category: "profile-style", kind: grantKindOf(d), payload: url, priceCents: d.priceCents });
      }
    }

    if (dryRun) {
      return {
        dryRun: true,
        motionFiles: files.map((f) => ({ slug: f.slug, key: f.key, kb: Math.round((f.body.length / 1024) * 10) / 10 })),
        skus: items.map((i) => ({ slug: i.slug, kind: i.kind, priceCents: i.priceCents })),
      };
    }

    if (files.length) {
      const { AwsClient } = await import("aws4fetch");
      const client = new AwsClient({ accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!, service: "s3", region: "auto" });
      const base = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET}`;
      for (const f of files) {
        // Bytes with an explicit length: R2 answers a string body sent without a Content-Length with 411.
        const bytes = new TextEncoder().encode(f.body);
        const res = await client.fetch(`${base}/${f.key}`, { method: "PUT", body: bytes, headers: { "Content-Type": "application/json", "Content-Length": String(bytes.byteLength), "Cache-Control": "public, max-age=31536000, immutable" } });
        if (!res.ok) throw new Error(`Couldn't write ${f.key} for ${f.slug} (${res.status}).`);
      }
    }

    const result: { created: number; refreshed: number; left: number } = await ctx.runMutation(internal.cosmeticCollection.seed, { items, createdBy });
    return { published: files.length, ...result, note: `New SKUs are drafts at the ${ONE_PRICE_NOTE}; publish them from the console.` };
  },
});

/** A file that is an SVG and nothing more: it is drawn by an `<img>`, which runs no script, but it is also fetched and re-drawn
 * onto canvases, and what is stored should be only what we meant. The artwork is built-in code, so this is a check on the
 * pipeline (an operator pasting the wrong thing) and not on a stranger. */
export function checkDecorationSvg(svg: string): string | null {
  if (svg.length > 24 * 1024) return "is larger than 24 KB";
  if (!svg.startsWith("<svg ") || !svg.endsWith("</svg>")) return "is not a single SVG document";
  if (/<script|foreignObject|\son[a-z]+\s*=|<image|<style|@import|<!ENTITY|<!DOCTYPE/i.test(svg)) return "contains something an avatar decoration may not";
  if (/(?:href|src)\s*=\s*["'](?!#)/i.test(svg) || /url\(\s*["']?(?!#)/i.test(svg)) return "refers to something outside itself";
  if (!/<animate(Transform|Motion)?\s/.test(svg)) return "has no animation";
  return null;
}

/**
 * Uploads the Archive collection's avatar decorations and points their SKUs at the uploaded files.
 *
 * The artwork is drawn by the app's own code (src/lib/avatar-decoration-collection.ts), so the files are made there and handed in:
 *
 *   bun scripts/publish-decorations.mjs --dry                 (check, write nothing)
 *   bun scripts/publish-decorations.mjs                       (the dev deployment)
 *   bun scripts/publish-decorations.mjs --prod
 *
 * Each file is `marketplace/avatar-decorations/<key>-<hash>.svg`: named after its contents, so a changed design is a new address
 * (and an old build keeps what it had), and cached for ever. A SKU is created as a draft if it doesn't exist; one that does keeps
 * its price and status, and only has its artwork repointed, which `refreshOwners` then carries to everyone who owns it.
 */
export const publishDecorations = internalAction({
  args: { files: v.array(v.object({ key: v.string(), svg: v.string(), refract: v.optional(v.literal("ice")) })), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { files, dryRun }): Promise<unknown> => {
    const known = new Map(COLLECTION_DECORATIONS.map((d) => [d.key, d]));
    // Only the decorations handed in are touched: publishing a new one must never repoint an older one that people may own.
    if (files.length === 0 || files.some((f) => !known.has(f.key)) || new Set(files.map((f) => f.key)).size !== files.length) throw new Error(`Expected one or more distinct collection decorations (${[...known.keys()].join(", ")}).`);
    for (const f of files) {
      const problem = checkDecorationSvg(f.svg);
      if (problem) throw new Error(`${f.key} ${problem}, so nothing was published.`);
    }
    const planned = await Promise.all(files.map(async (f) => ({ ...f, path: `marketplace/avatar-decorations/${f.key}-${(await sha256Hex(f.svg)).slice(0, 16)}.svg` })));
    if (dryRun) return { dryRun: true, files: planned.map((p) => ({ key: p.key, path: p.path, kb: Math.round((p.svg.length / 1024) * 10) / 10 })) };
    if (!isR2Enabled()) throw new Error("This deployment has no CDN configured (R2_* settings), so there is nowhere to publish to.");

    const { AwsClient } = await import("aws4fetch");
    const client = new AwsClient({ accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!, service: "s3", region: "auto" });
    const base = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET}`;
    for (const p of planned) {
      const bytes = new TextEncoder().encode(p.svg);
      const res = await client.fetch(`${base}/${p.path}`, { method: "PUT", body: bytes, headers: { "Content-Type": "image/svg+xml", "Content-Length": String(bytes.byteLength), "Cache-Control": "public, max-age=31536000, immutable" } });
      if (!res.ok) throw new Error(`Couldn't write ${p.path} (${res.status}).`);
    }
    const items = planned.map((p) => {
      const d = known.get(p.key)!;
      // 126 is the width a decoration is laid over an avatar at (see `defaultDecorationLayer`).
      // A fragment names the refraction the app should draw under the artwork (see src/lib/decoration-refraction.ts). It is never
      // sent to the CDN, and an app that does not know it draws the picture as an ordinary image.
      return { key: p.key, name: d.name, description: d.description, priceCents: d.priceCents, url: r2PublicUrlForKey(p.path) + (p.refract ? `#refract=${p.refract}` : "") };
    });
    const result: { created: number; repointed: number } = await ctx.runMutation(internal.cosmeticCollection.seedDecorations, { items });
    return { published: planned.length, ...result };
  },
});

/** Creates the decoration SKUs that are missing and repoints every one at its artwork. Owners are brought up to date in batches. */
export const seedDecorations = internalMutation({
  args: { items: v.array(v.object({ key: v.string(), name: v.string(), description: v.string(), priceCents: v.number(), url: v.string() })) },
  handler: async (ctx, { items }) => {
    const author = (await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", "crystal")).unique())?._id;
    if (!author) throw new Error("There is no `crystal` user to attribute these to.");
    const category = await ctx.db.query("skuCategories").withIndex("by_slug", (q) => q.eq("slug", "avatar-decorations")).unique();
    if (!category) throw new Error("The avatar-decorations category is missing.");
    const now = Date.now();
    let created = 0;
    let repointed = 0;
    for (const [index, item] of items.entries()) {
      if (!/^https:\/\//.test(item.url)) throw new Error(`${item.key} has no CDN address (check R2_PUBLIC_URL).`);
      const grants = [{ kind: "avatarDecoration" as const, payload: JSON.stringify([{ kind: "image", url: item.url, anchor: "center", x: 50, y: 0, width: 126 }]), label: item.name }];
      const existing = await ctx.db.query("skus").withIndex("by_slug", (q) => q.eq("slug", item.key)).unique();
      if (existing) {
        // The text is refreshed with the artwork, so a redrawn decoration is described as it now is. Price and status are not touched.
        await ctx.db.patch(existing._id, { grants, name: item.name, description: item.description, updatedAt: now });
        // People who already own it get the new artwork, the way a creator's approved update reaches them.
        await ctx.scheduler.runAfter(0, internal.marketplace.refreshOwners, { skuId: existing._id, after: null });
        repointed++;
        continue;
      }
      await ctx.db.insert("skus", { slug: item.key, name: item.name, description: item.description, categoryId: category._id, type: "cosmetic", priceCents: item.priceCents, currency: "usd", grants, status: "draft", featured: false, position: 1000 + index, createdBy: author, createdAt: now, updatedAt: now });
      created++;
    }
    await audit(ctx, author, "catalog.seed.collection_decorations", undefined, `Archive decorations: ${created} created, ${repointed} repointed at CDN artwork`);
    return { created, repointed };
  },
});

/**
 * Puts the collection on sale **for free**: every SKU of it that is still a draft becomes active at price 0.
 *
 *   npx convex run cosmeticCollection:activateFree
 *
 * Free SKUs are never sent to Stripe (`publishToStripe` and `payments.syncSku` both return early at price 0), so nothing is
 * created there. Only this collection's own slugs are touched, and only drafts: anything already active or archived is left as
 * it is. To charge for them later, set a price and status from the console (`pricing.write`).
 */
export const activateFree = internalMutation({
  args: { only: v.optional(v.array(v.string())) },
  handler: async (ctx, { only }) => {
    const all = [...COLLECTION_DECORATIONS.map((d) => d.key), ...COLLECTION_DESIGNS.map((d) => d.slug)];
    if (only && only.some((o) => !all.includes(o))) throw new Error(`Unknown slug in only: ${only.filter((o) => !all.includes(o)).join(", ")}.`);
    const slugs = new Set<string>(only ?? all);
    const author = (await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", "crystal")).unique())?._id;
    if (!author) throw new Error("There is no `crystal` user to record this against.");
    const now = Date.now();
    let activated = 0;
    let left = 0;
    for (const slug of slugs) {
      const sku = await ctx.db.query("skus").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
      if (!sku) continue;
      if (sku.status !== "draft") { left++; continue; }
      await ctx.db.patch(sku._id, { priceCents: 0, status: "active", updatedAt: now });
      activated++;
    }
    await audit(ctx, author, "catalog.collection.activate_free", undefined, `Archive collection: ${activated} put on sale for free, ${left} left as they are`);
    return { activated, left, missing: slugs.size - activated - left };
  },
});

/**
 * Takes the collection's profile effects off sale.
 *
 *   npx convex run cosmeticCollection:archiveEffects
 *
 * Archiving keeps a SKU for the people who already own it (they keep it and can still equip it); it just stops being offered.
 * Only this collection's own profile-effect SKUs are touched, and only ones that are on sale or still drafts.
 */
export const archiveEffects = internalMutation({
  args: {},
  handler: async (ctx) => {
    const author = (await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", "crystal")).unique())?._id;
    if (!author) throw new Error("There is no `crystal` user to record this against.");
    const now = Date.now();
    let archived = 0;
    let already = 0;
    for (const d of COLLECTION_DESIGNS.filter((x) => x.kind === "effect")) {
      const sku = await ctx.db.query("skus").withIndex("by_slug", (q) => q.eq("slug", d.slug)).unique();
      if (!sku) continue;
      if (sku.status === "archived") { already++; continue; }
      await ctx.db.patch(sku._id, { status: "archived", featured: false, updatedAt: now });
      archived++;
    }
    await audit(ctx, author, "catalog.collection.archive_effects", undefined, `Archive collection profile effects: ${archived} archived, ${already} already were`);
    return { archived, already };
  },
});

/**
 * Puts the collection's profile effects back on sale, free, as `activateFree` left them: the reverse of `archiveEffects`.
 *
 *   npx convex run cosmeticCollection:restoreEffects
 */
export const restoreEffects = internalMutation({
  args: {},
  handler: async (ctx) => {
    const author = (await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", "crystal")).unique())?._id;
    if (!author) throw new Error("There is no `crystal` user to record this against.");
    const now = Date.now();
    let restored = 0;
    let already = 0;
    for (const d of COLLECTION_DESIGNS.filter((x) => x.kind === "effect")) {
      const sku = await ctx.db.query("skus").withIndex("by_slug", (q) => q.eq("slug", d.slug)).unique();
      if (!sku) continue;
      if (sku.status === "active") { already++; continue; }
      await ctx.db.patch(sku._id, { status: "active", priceCents: 0, updatedAt: now });
      restored++;
    }
    await audit(ctx, author, "catalog.collection.restore_effects", undefined, `Archive collection profile effects: ${restored} put back on sale for free, ${already} already were`);
    return { restored, already };
  },
});

/** Creates or refreshes the SKUs. Separate from the action so the database part is one transaction. */
export const seed = internalMutation({
  args: { items: v.array(itemValidator), createdBy: v.optional(v.id("users")) },
  handler: async (ctx, { items, createdBy }) => {
    // Made by Crystal itself, as the rest of Crystal's own catalogue is.
    let author: Id<"users"> | undefined = createdBy;
    if (!author) author = (await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", "crystal")).unique())?._id;
    if (!author) throw new Error("There is no `crystal` user to attribute these to. Pass createdBy.");

    const categorySpecs = {
      "avatar-decorations": { name: "Avatar decorations", description: "Built-in rings, ornaments and frames.", position: 0 },
      "profile-style": { name: "Profile style", description: "Cosmetics for your profile card.", position: 1 },
    } as const;
    const categories = new Map<string, Id<"skuCategories">>();
    for (const [slug, spec] of Object.entries(categorySpecs)) {
      const existing = await ctx.db.query("skuCategories").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
      categories.set(slug, existing?._id ?? (await ctx.db.insert("skuCategories", { slug, ...spec, active: true })));
    }

    let created = 0;
    let refreshed = 0;
    let left = 0;
    const now = Date.now();
    for (const [index, item] of items.entries()) {
      const categoryId = categories.get(item.category)!;
      const grants = [{ kind: item.kind, payload: item.payload, label: item.name }];
      let existing = await ctx.db.query("skus").withIndex("by_slug", (q) => q.eq("slug", item.slug)).unique();
      // The original Storm Chaser effect predates the collection slug. Reuse that published listing by kind and name so existing
      // owners get the lighter design instead of receiving a duplicate marketplace item.
      if (!existing && item.slug === "storm-chaser-effect") {
        existing = (await ctx.db.query("skus").withIndex("by_category", (q) => q.eq("categoryId", categoryId)).collect()).find(
          (sku) => sku.name.toLowerCase() === "storm chaser" && sku.grants.some((grant) => grant.kind === "profileEffect")
        ) ?? null;
      }
      if (existing) {
        // Published collections are left alone, except Storm Chaser: this targeted artwork fix preserves the listing's price/status
        // and refreshes existing owners so the performance and brightness improvements reach the cosmetic they already equipped.
        if (existing.status !== "draft" && item.slug !== "storm-chaser-effect") { left++; continue; }
        await ctx.db.patch(existing._id, { name: item.name, description: item.description, categoryId, grants, updatedAt: now });
        if (item.slug === "storm-chaser-effect" && existing.status !== "draft") {
          await ctx.scheduler.runAfter(0, internal.marketplace.refreshOwners, { skuId: existing._id, after: null });
        }
        refreshed++;
        continue;
      }
      await ctx.db.insert("skus", {
        slug: item.slug,
        name: item.name,
        description: item.description,
        categoryId,
        type: "cosmetic",
        priceCents: item.priceCents,
        currency: "usd",
        grants,
        status: "draft",
        featured: false,
        position: 1000 + index,
        // `byCrystal` is deliberately not set: that label is only ever written after a staff check (see staff-publish.test.mts),
        // and this runs from the CLI with no signed-in staff member. These are Crystal's own, created by the `crystal` user, as
        // the starter catalogue is.
        createdBy: author,
        createdAt: now,
        updatedAt: now,
      });
      created++;
    }
    await audit(ctx, author, "catalog.seed.collection", undefined, `Archive collection: ${created} created, ${refreshed} refreshed, ${left} left as they are (all drafts)`);
    return { created, refreshed, left };
  },
});

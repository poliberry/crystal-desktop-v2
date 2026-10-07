import { normalizeSceneSpec, normalizeThemePackSpec } from "./lib/creationSpecs";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { audit, requireStaff } from "./lib/staff";
import { getCurrentUserOrNull } from "./users";

/**
 * The catalogue: what is for sale, in what categories, for how much.
 *
 * Everyone signed in can read the active part of it; changing it takes a staff
 * role (`catalog.write`), and changing what it costs takes a further one
 * (`pricing.write`). Stripe is told about a SKU when it is published and is never
 * the source of its price — see `convex/payments.ts`.
 */

const skuTypeValidator = v.union(
  v.literal("cosmetic"),
  v.literal("subscription"),
  v.literal("community"),
  v.literal("bundle")
);

const grantKindValidator = v.union(
  v.literal("avatarDecoration"),
  v.literal("profileSticker"),
  v.literal("profileEffect"),
  v.literal("nameplate"),
  v.literal("communityTheme"),
  v.literal("communityBoost"),
  v.literal("loungeScene"),
  v.literal("themePack"),
  v.literal("plan")
);

const grantValidator = v.object({
  kind: grantKindValidator,
  payload: v.optional(v.string()),
  label: v.optional(v.string()),
});

type Grant = Doc<"skus">["grants"][number];

/** Currencies a SKU may be sold in. Stripe supports far more; these are the ones
 * the business is set up to take. */
export const CURRENCIES = ["usd", "aud", "eur", "gbp"] as const;

/** Stripe won't take a card payment under about fifty cents, in any of these. */
const MIN_PAID_CENTS = 50;
const MAX_PRICE_CENTS = 1_000_000;

const USER_KINDS = ["avatarDecoration", "profileSticker", "profileEffect", "nameplate", "themePack", "plan"];
const COMMUNITY_KINDS = ["communityTheme", "communityBoost", "loungeScene"];

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** An address that is at least https; the creator path is stricter. */
const httpsOnly = (url: string) => {
  if (!isHttps(url)) throw new Error("Every file has to be at an https address.");
  return url;
};

/** A grant's payload has to be what its kind says it is. Checked on the way in,
 * because it is later drawn into other people's profiles. */
function checkGrant(grant: Grant) {
  const payload = grant.payload ?? "";
  switch (grant.kind) {
    case "avatarDecoration":
    case "profileSticker": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        throw new Error(`${grant.kind} needs its layers as JSON.`);
      }
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error(`${grant.kind} needs at least one layer.`);
      for (const layer of parsed as { url?: unknown; kind?: unknown }[]) {
        const picture = !layer.kind || layer.kind === "image";
        // Pictures must be hosted over https or be one of the built-in presets.
        if (picture && !(typeof layer.url === "string" && (isHttps(layer.url) || layer.url.startsWith("builtin:")))) {
          throw new Error("Every picture in the artwork has to be an https address.");
        }
      }
      return;
    }
    case "profileEffect":
    case "nameplate":
      if (!isHttps(payload)) throw new Error(`${grant.kind} needs an https address.`);
      return;
    case "communityTheme": {
      let parsed: { start?: unknown; end?: unknown };
      try {
        parsed = JSON.parse(payload);
      } catch {
        throw new Error("A community theme needs its colours as JSON.");
      }
      const hex = /^#[0-9a-fA-F]{6}$/;
      if (typeof parsed.start !== "string" || typeof parsed.end !== "string" || !hex.test(parsed.start) || !hex.test(parsed.end)) {
        throw new Error("A community theme needs a start and end colour like #5865f2.");
      }
      return;
    }
    case "loungeScene": {
      // Staff-authored: the same rules a creator's scene goes through, with an
      // https address standing in for "on our CDN, in the creator's folder".
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        throw new Error("A lounge scene needs its details as JSON.");
      }
      normalizeSceneSpec({ name: grant.label ?? "Scene", ...(parsed as object) }, httpsOnly);
      return;
    }
    case "themePack": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        throw new Error("A theme pack needs its details as JSON.");
      }
      normalizeThemePackSpec({ name: grant.label ?? "Theme pack", ...(parsed as object) }, httpsOnly);
      return;
    }
    case "communityBoost":
    case "plan":
      return;
  }
}

/** Everything about a SKU that has to be true before it is saved. */
function validateSku(input: {
  slug: string;
  name: string;
  description?: string;
  type: Doc<"skus">["type"];
  priceCents: number;
  currency: string;
  interval?: Doc<"skus">["interval"];
  grants: Grant[];
}) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.slug) || input.slug.length > 60) {
    throw new Error("The slug can only use lowercase letters, numbers and hyphens.");
  }
  if (input.name.trim().length < 2 || input.name.length > 80) throw new Error("A name is 2–80 characters.");
  if ((input.description ?? "").length > 600) throw new Error("A description is up to 600 characters.");
  if (!(CURRENCIES as readonly string[]).includes(input.currency)) {
    throw new Error(`Currency must be one of ${CURRENCIES.join(", ").toUpperCase()}.`);
  }
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0 || input.priceCents > MAX_PRICE_CENTS) {
    throw new Error("The price has to be a whole number of cents.");
  }
  if (input.priceCents > 0 && input.priceCents < MIN_PAID_CENTS) {
    throw new Error("Paid items start at 50 cents — that is the least Stripe will take.");
  }
  if (input.grants.length === 0) throw new Error("A SKU has to give something.");
  if (input.grants.length > 12) throw new Error("A SKU can give at most 12 things.");

  if (input.type === "subscription") {
    if (!input.interval) throw new Error("A subscription needs a billing interval.");
    if (input.priceCents === 0) throw new Error("A subscription can't be free.");
  } else if (input.interval) {
    throw new Error("Only subscriptions have a billing interval.");
  }

  const allowed = input.type === "community" ? COMMUNITY_KINDS : USER_KINDS;
  for (const grant of input.grants) {
    if (!allowed.includes(grant.kind)) {
      throw new Error(
        input.type === "community"
          ? "A community item can only give community things."
          : `A ${input.type} can't give "${grant.kind}".`,
      );
    }
    checkGrant(grant);
  }
  if (input.type === "community" && new Set(input.grants.map((g) => g.kind)).size !== input.grants.length) {
    throw new Error("A community item gives each kind of thing once.");
  }
}

// --- What anyone can see ------------------------------------------------------

/** The part of a SKU the store shows. Stripe ids stay private; who made it is
 * shown, because buying from a creator is something people want to know. */
async function publicSku(ctx: QueryCtx, sku: Doc<"skus">) {
  const creator = sku.creatorId ? await ctx.db.get(sku.creatorId) : null;
  return {
    id: sku._id,
    slug: sku.slug,
    name: sku.name,
    description: sku.description,
    categoryId: sku.categoryId,
    type: sku.type,
    priceCents: sku.priceCents,
    currency: sku.currency,
    interval: sku.interval,
    imageUrl: sku.imageUrl,
    featured: sku.featured,
    createdAt: sku.createdAt,
    creator: creator ? { username: creator.username, name: creator.name, imageUrl: creator.imageUrl } : null,
    grants: sku.grants.map((g) => ({ kind: g.kind, payload: g.payload, label: g.label })),
  };
}

export const categories = query({
  args: {},
  handler: async (ctx) => {
    if (!(await getCurrentUserOrNull(ctx))) return [];
    const rows = await ctx.db.query("skuCategories").collect();
    return rows
      .filter((c) => c.active)
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c._id, slug: c.slug, name: c.name, description: c.description }));
  },
});

/** What is for sale, featured first. */
export const list = query({
  args: { categoryId: v.optional(v.id("skuCategories")) },
  handler: async (ctx, { categoryId }) => {
    if (!(await getCurrentUserOrNull(ctx))) return [];
    const all = await ctx.db
      .query("skus")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const rows = all
      .filter((s) => !categoryId || s.categoryId === categoryId)
      .sort((a, b) => Number(b.featured) - Number(a.featured) || a.position - b.position);
    return Promise.all(rows.map((sku) => publicSku(ctx, sku)));
  },
});

export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    if (!(await getCurrentUserOrNull(ctx))) return null;
    const sku = await ctx.db
      .query("skus")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    return sku && sku.status === "active" ? await publicSku(ctx, sku) : null;
  },
});

// --- Staff: categories ----------------------------------------------------------

export const adminCategories = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx, "catalog.read");
    const rows = await ctx.db.query("skuCategories").collect();
    const skus = await ctx.db.query("skus").collect();
    return rows
      .sort((a, b) => a.position - b.position)
      .map((c) => ({
        id: c._id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        position: c.position,
        active: c.active,
        skuCount: skus.filter((s) => s.categoryId === c._id).length,
      }));
  },
});

export const adminUpsertCategory = mutation({
  args: {
    categoryId: v.optional(v.id("skuCategories")),
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    position: v.number(),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx, "catalog.write");
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(args.slug) || args.slug.length > 40) {
      throw new Error("The slug can only use lowercase letters, numbers and hyphens.");
    }
    if (args.name.trim().length < 2 || args.name.length > 60) throw new Error("A name is 2–60 characters.");
    const clash = await ctx.db
      .query("skuCategories")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (clash && clash._id !== args.categoryId) throw new Error("Another category already uses that slug.");

    const fields = {
      slug: args.slug,
      name: args.name.trim(),
      description: args.description?.trim().slice(0, 300) || undefined,
      position: args.position,
      active: args.active,
    };
    let id = args.categoryId;
    if (id) await ctx.db.patch(id, fields);
    else id = await ctx.db.insert("skuCategories", fields);
    await audit(ctx, staff.user._id, args.categoryId ? "catalog.category.update" : "catalog.category.create", { type: "category", id }, fields.name);
    return id;
  },
});

export const adminDeleteCategory = mutation({
  args: { categoryId: v.id("skuCategories") },
  handler: async (ctx, { categoryId }) => {
    const staff = await requireStaff(ctx, "catalog.write");
    const category = await ctx.db.get(categoryId);
    if (!category) return;
    const inUse = await ctx.db
      .query("skus")
      .withIndex("by_category", (q) => q.eq("categoryId", categoryId))
      .first();
    // Hiding it is the way to take a category out of the store while it still has
    // things in it; deleting is for one that was never used.
    if (inUse) throw new Error("This category has items in it. Move or archive them, or hide the category instead.");
    await ctx.db.delete(categoryId);
    await audit(ctx, staff.user._id, "catalog.category.delete", { type: "category", id: categoryId }, category.name);
  },
});

// --- Staff: SKUs ----------------------------------------------------------------

export const adminListSkus = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx, "catalog.read");
    const rows = await ctx.db.query("skus").collect();
    const categories = new Map((await ctx.db.query("skuCategories").collect()).map((c) => [c._id, c.name]));
    const creators = new Map<Id<"users">, string>();
    for (const id of new Set(rows.flatMap((s) => (s.creatorId ? [s.creatorId] : [])))) {
      creators.set(id, (await ctx.db.get(id))?.username ?? "unknown");
    }
    return rows
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => ({
        id: s._id,
        slug: s.slug,
        name: s.name,
        type: s.type,
        status: s.status,
        featured: s.featured,
        priceCents: s.priceCents,
        currency: s.currency,
        interval: s.interval,
        imageUrl: s.imageUrl,
        description: s.description,
        grants: s.grants,
        position: s.position,
        category: categories.get(s.categoryId) ?? "—",
        categoryId: s.categoryId,
        creatorId: s.creatorId,
        creatorUsername: s.creatorId ? creators.get(s.creatorId) ?? "unknown" : undefined,
        creatorShareBps: s.creatorShareBps,
        synced: s.priceCents === 0 || !!s.stripePriceId,
        updatedAt: s.updatedAt,
      }));
  },
});

export const adminGetSku = query({
  args: { skuId: v.id("skus") },
  handler: async (ctx, { skuId }) => {
    await requireStaff(ctx, "catalog.read");
    const sku = await ctx.db.get(skuId);
    if (!sku) return null;
    const orders = await ctx.db.query("orders").withIndex("by_sku", (q) => q.eq("skuId", skuId)).take(5000);
    const creator = sku.creatorId ? await ctx.db.get(sku.creatorId) : null;
    return {
      sold: orders.filter((o) => o.status === "paid").length,
      creator: creator ? { id: creator._id, username: creator.username, shareBps: sku.creatorShareBps ?? 8000 } : null,
      id: sku._id,
      slug: sku.slug,
      name: sku.name,
      description: sku.description,
      categoryId: sku.categoryId,
      type: sku.type,
      priceCents: sku.priceCents,
      currency: sku.currency,
      interval: sku.interval,
      grants: sku.grants,
      imageUrl: sku.imageUrl,
      status: sku.status,
      featured: sku.featured,
      position: sku.position,
      stripeProductId: sku.stripeProductId,
      stripePriceId: sku.stripePriceId,
    };
  },
});

export const adminGenerateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx, "catalog.write");
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Create or change a SKU.
 *
 * Changing the price, currency or interval is a separate permission from
 * changing anything else about it: the person who writes the copy and attaches
 * the artwork is not necessarily the person who decides what it costs. A paid SKU
 * that is `active` is then (re)published to Stripe.
 */
export const adminUpsertSku = mutation({
  args: {
    skuId: v.optional(v.id("skus")),
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    categoryId: v.id("skuCategories"),
    type: skuTypeValidator,
    priceCents: v.number(),
    currency: v.string(),
    interval: v.optional(v.union(v.literal("month"), v.literal("year"))),
    grants: v.array(grantValidator),
    imageUrl: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
    featured: v.boolean(),
    position: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx, "catalog.write");
    const existing = args.skuId ? await ctx.db.get(args.skuId) : null;
    if (args.skuId && !existing) throw new Error("That SKU doesn't exist.");

    const slug = args.slug.trim().toLowerCase();
    validateSku({ ...args, slug });
    if (!(await ctx.db.get(args.categoryId))) throw new Error("That category doesn't exist.");
    if (args.imageUrl && !isHttps(args.imageUrl)) throw new Error("The store picture has to be an https address.");

    const clash = await ctx.db
      .query("skus")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (clash && clash._id !== args.skuId) throw new Error("Another SKU already uses that slug.");

    const priceChanged =
      !existing ||
      existing.priceCents !== args.priceCents ||
      existing.currency !== args.currency ||
      existing.interval !== args.interval;
    if (priceChanged) await requireStaff(ctx, "pricing.write");
    // Putting something on sale needs a price decision to have been made by
    // someone allowed to make it — a draft can be saved by anyone who writes.
    if (!existing && args.status === "active") await requireStaff(ctx, "pricing.write");
    if (existing && existing.status !== "active" && args.status === "active" && args.priceCents !== existing.priceCents) {
      await requireStaff(ctx, "pricing.write");
    }

    const now = Date.now();
    const fields = {
      slug,
      name: args.name.trim(),
      description: args.description?.trim() || undefined,
      categoryId: args.categoryId,
      type: args.type,
      priceCents: args.priceCents,
      currency: args.currency,
      interval: args.interval,
      grants: args.grants.map((g) => ({ kind: g.kind, payload: g.payload, label: g.label?.slice(0, 80) })),
      imageUrl: args.imageUrl,
      status: args.status,
      featured: args.featured,
      position: args.position,
      updatedAt: now,
    };

    let id: Id<"skus">;
    if (existing) {
      id = existing._id;
      await ctx.db.patch(id, fields);
    } else {
      id = await ctx.db.insert("skus", { ...fields, createdBy: staff.user._id, createdAt: now });
    }

    const summary = existing
      ? [
          existing.name !== fields.name && `renamed "${existing.name}" → "${fields.name}"`,
          priceChanged &&
            `price ${existing.priceCents / 100} ${existing.currency} → ${fields.priceCents / 100} ${fields.currency}`,
          existing.status !== fields.status && `status ${existing.status} → ${fields.status}`,
        ]
          .filter(Boolean)
          .join("; ") || "edited"
      : `created "${fields.name}" at ${fields.priceCents / 100} ${fields.currency}`;
    await audit(ctx, staff.user._id, existing ? "catalog.sku.update" : "catalog.sku.create", { type: "sku", id }, summary);

    await publishToStripe(ctx, id, fields);
    return id;
  },
});

/** Ask Stripe to be told about a paid, active SKU. Done after the commit, in an
 * action, because a mutation can't call out. */
async function publishToStripe(
  ctx: MutationCtx,
  skuId: Id<"skus">,
  fields: { priceCents: number; status: Doc<"skus">["status"] }
) {
  if (fields.status !== "active" || fields.priceCents === 0) return;
  await ctx.scheduler.runAfter(0, internal.payments.syncSku, { skuId });
}

/** Take something off sale, or put it back. Archiving keeps it for the people
 * who already own it. */
export const adminSetSkuStatus = mutation({
  args: {
    skuId: v.id("skus"),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
  },
  handler: async (ctx, { skuId, status }) => {
    const staff = await requireStaff(ctx, "catalog.write");
    const sku = await ctx.db.get(skuId);
    if (!sku) throw new Error("That SKU doesn't exist.");
    if (status === "active") await requireStaff(ctx, "pricing.write");
    await ctx.db.patch(skuId, { status, updatedAt: Date.now() });
    await audit(ctx, staff.user._id, "catalog.sku.status", { type: "sku", id: skuId }, `${sku.name}: ${sku.status} → ${status}`);
    await publishToStripe(ctx, skuId, { priceCents: sku.priceCents, status });
  },
});

/** Seed the first Crystal catalogue. Idempotent by slug so it is safe to run
 * once in development and again after a fresh deployment. The visual presets
 * are built into the client, which keeps the starter catalogue usable offline;
 * uploaded creator art continues to use CDN URLs. */
export const seedStarterCatalog = mutation({
  args: {},
  handler: async (ctx) => {
    const staff = await requireStaff(ctx, "catalog.write");
    const categorySpecs = [
      { slug: "avatar-decorations", name: "Avatar decorations", description: "Built-in rings, ornaments and frames.", position: 0 },
      { slug: "profile-style", name: "Profile style", description: "Cosmetics for your profile card.", position: 1 },
      { slug: "crystal-geode", name: "Crystal Geode", description: "Memberships with customization perks.", position: 2 },
    ];
    const categories = new Map<string, Id<"skuCategories">>();
    for (const spec of categorySpecs) {
      const existing = await ctx.db.query("skuCategories").withIndex("by_slug", (q) => q.eq("slug", spec.slug)).unique();
      const id = existing?._id ?? await ctx.db.insert("skuCategories", { ...spec, active: true });
      categories.set(spec.slug, id);
    }

    const starter = [
      { slug: "aurora-ring", name: "Aurora Ring", description: "A quiet northern glow around your avatar.", category: "avatar-decorations", priceCents: 199, type: "cosmetic" as const, grants: [{ kind: "avatarDecoration" as const, payload: JSON.stringify([{ kind: "image", url: "builtin:aurora", anchor: "center", x: 50, y: 0, width: 100 }]), label: "Aurora Ring" }] },
      { slug: "starlight-sparkles", name: "Starlight Sparkles", description: "Six little stars that catch the light.", category: "avatar-decorations", priceCents: 199, type: "cosmetic" as const, grants: [{ kind: "avatarDecoration" as const, payload: JSON.stringify([{ kind: "image", url: "builtin:sparkles", anchor: "center", x: 50, y: 0, width: 100 }]), label: "Starlight Sparkles" }] },
      { slug: "rose-heart", name: "Rose Heart", description: "A soft pink constellation of hearts.", category: "avatar-decorations", priceCents: 199, type: "cosmetic" as const, grants: [{ kind: "avatarDecoration" as const, payload: JSON.stringify([{ kind: "image", url: "builtin:hearts", anchor: "center", x: 50, y: 0, width: 100 }]), label: "Rose Heart" }] },
      { slug: "royal-crown", name: "Royal Crown", description: "A tiny crown with a lot of confidence.", category: "avatar-decorations", priceCents: 299, type: "cosmetic" as const, grants: [{ kind: "avatarDecoration" as const, payload: JSON.stringify([{ kind: "image", url: "builtin:crown", anchor: "center", x: 50, y: 0, width: 100 }]), label: "Royal Crown" }] },
      { slug: "constellation-set", name: "Constellation Set", description: "Aurora, sparkles and rose hearts together.", category: "avatar-decorations", priceCents: 499, type: "bundle" as const, grants: ["builtin:aurora", "builtin:sparkles", "builtin:hearts"].map((url, index) => ({ kind: "avatarDecoration" as const, payload: JSON.stringify([{ kind: "image", url, anchor: "center", x: 50, y: 0, width: 100 }]), label: ["Aurora Ring", "Starlight Sparkles", "Rose Heart"][index] })) },
      { slug: "crystal-geode-basic", name: "Crystal Geode Basic", description: "10% off cosmetics, 1080p30 streaming and a rotating monthly Geode badge.", category: "crystal-geode", priceCents: 499, type: "subscription" as const, interval: "month" as const, grants: [{ kind: "plan" as const, payload: JSON.stringify({ plan: "crystal-geode-basic", cosmeticDiscountBps: 1000, streamResolution: "1080p", streamFrameRate: 30, monthlyBadge: true }), label: "Crystal Geode Basic" }] },
      { slug: "crystal-geode", name: "Crystal Geode", description: "25% off cosmetics, 1440p60 streaming, premium profile effects and early access to drops.", category: "crystal-geode", priceCents: 999, type: "subscription" as const, interval: "month" as const, grants: [{ kind: "plan" as const, payload: JSON.stringify({ plan: "crystal-geode", cosmeticDiscountBps: 2500, streamResolution: "1440p", streamFrameRate: 60, profileEffects: true, earlyAccess: true, monthlyBadge: true }), label: "Crystal Geode" }] },
    ];
    const created: Id<"skus">[] = [];
    for (const item of starter) {
      const existing = await ctx.db.query("skus").withIndex("by_slug", (q) => q.eq("slug", item.slug)).unique();
      const categoryId = categories.get(item.category);
      if (!categoryId) continue;
      if (existing) { created.push(existing._id); continue; }
      const now = Date.now();
      const id = await ctx.db.insert("skus", {
        slug: item.slug,
        name: item.name,
        description: item.description,
        categoryId,
        type: item.type,
        priceCents: item.priceCents,
        currency: "usd",
        interval: item.interval,
        grants: item.grants,
        status: "active",
        featured: item.slug === "crystal-geode" || item.slug === "constellation-set",
        position: created.length,
        createdBy: staff.user._id,
        createdAt: now,
        updatedAt: now,
      });
      created.push(id);
      await publishToStripe(ctx, id, { priceCents: item.priceCents, status: "active" });
    }
    await audit(ctx, staff.user._id, "catalog.seed", undefined, `starter catalogue: ${created.length} SKUs`);
    return { categories: categories.size, skus: created.length };
  },
});

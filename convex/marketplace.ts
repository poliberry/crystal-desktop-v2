import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireCommunity } from "./communities";
import { isActive } from "./lib/entitlements";
import {
  dropUnusedLayerAssets,
  layerArgValidator,
  MAX_LAYERS,
  normalizeDecorationLayers,
  normalizeStickerLayers,
  type LayerArg,
} from "./lib/cosmeticLayers";
import { normalizeSceneSpec, normalizeThemePackSpec } from "./lib/creationSpecs";
import { creationFolder, dropR2Url } from "./lib/r2";
import { CURRENCIES } from "./catalog";
import { PERMISSIONS, requireCommunityPermission } from "./permissions";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";
import { audit, requireStaff } from "./lib/staff";

/**
 * What a buyer sees and does with what they own.
 *
 * Buying is in `payments.ts`. This is the other half: the list of owned items,
 * their orders, and putting an owned item to use.
 */

/** Everything the caller owns that is still in force. */
export const myEntitlements = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const rows = await ctx.db
      .query("entitlements")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .order("desc")
      .take(300);
    const active = rows.filter((e) => isActive(e));
    return Promise.all(
      active.map(async (e) => {
        const sku = await ctx.db.get(e.skuId);
        const community = e.communityId ? await ctx.db.get(e.communityId) : null;
        return {
          id: e._id,
          skuId: e.skuId,
          skuName: sku?.name ?? "Unknown item",
          imageUrl: sku?.imageUrl,
          kind: e.kind,
          label: e.label,
          payload: e.payload,
          source: e.source,
          communityId: e.communityId,
          communityName: community?.name,
          expiresAt: e.expiresAt,
          createdAt: e.createdAt,
        };
      })
    );
  },
});

/** The caller's own purchases, newest first. */
export const myOrders = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const rows = await ctx.db
      .query("orders")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .order("desc")
      .take(100);
    return rows
      // A purchase that was started and abandoned is not something they bought.
      .filter((o) => o.status !== "pending" && o.status !== "canceled")
      .map((o) => ({
        id: o._id,
        skuName: o.skuName,
        status: o.status,
        amountCents: o.amountCents,
        currency: o.currency,
        isSubscription: !!o.stripeSubscriptionId,
        createdAt: o.createdAt,
        paidAt: o.paidAt,
      }));
  },
});

/** The caller's active subscriptions, for cancelling. */
export const mySubscriptions = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const rows = await ctx.db
      .query("orders")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .order("desc")
      .take(100);
    return rows
      .filter((o) => o.status === "paid" && !!o.stripeSubscriptionId)
      .map((o) => ({ id: o._id, skuName: o.skuName, amountCents: o.amountCents, currency: o.currency }));
  },
});

/** The strongest active Crystal plan, used by clients to gate premium features. */
export const myPlan = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    const rows = await ctx.db.query("entitlements").withIndex("by_user", (q) => q.eq("userId", me._id)).collect();
    const plans = rows.filter((row) => row.kind === "plan" && isActive(row));
    const rank = (payload?: string) => payload?.includes('"plan":"crystal-geode"') ? 2 : 1;
    const selected = plans.sort((a, b) => rank(b.payload) - rank(a.payload))[0];
    if (!selected?.payload) return null;
    try {
      return JSON.parse(selected.payload) as {
        plan?: string;
        cosmeticDiscountBps?: number;
        streamResolution?: string;
        streamFrameRate?: number;
        profileEffects?: boolean;
        earlyAccess?: boolean;
      };
    } catch {
      return null;
    }
  },
});

// --- Creators ---------------------------------------------------------------------

const CREATION_KINDS = [
  "avatarDecoration",
  "profileSticker",
  "profileEffect",
  "nameplate",
  "communityTheme",
  "loungeScene",
  "themePack",
] as const;
/** What is bought by a community rather than a person: never sold in a pack. */
const COMMUNITY_CREATION_KINDS = ["communityTheme", "loungeScene"];
/** The most things one pack can hold. */
const MAX_PACK_ITEMS = 8;
type CreationKind = (typeof CREATION_KINDS)[number];

const MIN_PAID_CENTS = 50;
const MAX_CREATION_CENTS = 50_000;
const MAX_OPEN_SUBMISSIONS = 10;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** What staff keep of a creator sale unless they decide otherwise, in basis
 * points of what the creator keeps. */
const DEFAULT_CREATOR_SHARE_BPS = 8000;

/**
 * The artwork address, checked.
 *
 * It has to be on our own CDN, in the folder the uploader's own upload went to.
 * Anything else — a link to some other site, or someone else's file — would be
 * drawn into other people's profiles, and an address elsewhere can change what it
 * shows after staff approved it.
 */
function creationArtworkUrl(url: string, clerkId: string): string {
  const base = (process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "").replace(/\/$/, "");
  if (!base) throw new Error("Creator uploads aren't available right now.");
  if (!url.startsWith(`${base}/${creationFolder(clerkId)}`) || url.length > 500) {
    throw new Error("Upload the artwork through Crystal first.");
  }
  return url;
}

/** The grant a creation gives, built here from the artwork rather than accepted
 * as JSON from the client: placement comes from the defaults, run through the
 * same limits the profile editors apply. */
function creationGrant(
  kind: CreationKind,
  name: string,
  input: { artworkUrl?: string; themeStart?: string; themeEnd?: string },
  clerkId: string,
): { kind: CreationKind; payload: string; label: string } {
  if (kind === "communityTheme") {
    if (!input.themeStart || !input.themeEnd || !HEX.test(input.themeStart) || !HEX.test(input.themeEnd)) {
      throw new Error("A theme needs a start and an end colour.");
    }
    return {
      kind,
      label: name,
      payload: JSON.stringify({ start: input.themeStart.toLowerCase(), end: input.themeEnd.toLowerCase() }),
    };
  }
  const url = creationArtworkUrl(input.artworkUrl ?? "", clerkId);
  switch (kind) {
    case "avatarDecoration":
      return {
        kind,
        label: name,
        payload: JSON.stringify(
          normalizeDecorationLayers([{ id: "art", url, anchor: "center", x: 50, y: 0, width: 100 }]),
        ),
      };
    case "profileSticker":
      return {
        kind,
        label: name,
        payload: JSON.stringify(
          normalizeStickerLayers([{ id: "art", url, anchor: "top", x: 50, y: 50, width: 36 }]),
        ),
      };
    default:
      return { kind, label: name, payload: url };
  }
}

/** A picture to show in the store for a grant. */
function previewOf(grant: { kind: string; payload?: string }): string | undefined {
  if (grant.kind === "profileEffect" || grant.kind === "nameplate") return grant.payload;
  if (grant.kind === "loungeScene") {
    try {
      return (JSON.parse(grant.payload ?? "") as { backgroundUrl?: string }).backgroundUrl;
    } catch {
      return undefined;
    }
  }
  if (grant.kind === "avatarDecoration" || grant.kind === "profileSticker") {
    try {
      const layers = JSON.parse(grant.payload ?? "") as { url?: string }[];
      return layers[0]?.url;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** A regular user proposes something to sell. It is not in the store until staff
 * approve it, and what it grants is built here, not taken from the client. */
export const submitListing = mutation({
  args: {
    kind: v.union(
      v.literal("avatarDecoration"),
      v.literal("profileSticker"),
      v.literal("profileEffect"),
      v.literal("nameplate"),
      v.literal("communityTheme"),
    ),
    name: v.string(),
    description: v.optional(v.string()),
    artworkUrl: v.optional(v.string()),
    themeStart: v.optional(v.string()),
    themeEnd: v.optional(v.string()),
    priceCents: v.number(),
    currency: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const name = args.name.trim();
    if (name.length < 2 || name.length > 60) throw new Error("A name is 2–60 characters.");
    const description = args.description?.trim() ?? "";
    if (description.length > 400) throw new Error("A description is up to 400 characters.");
    if (
      !Number.isInteger(args.priceCents) ||
      args.priceCents < 0 ||
      args.priceCents > MAX_CREATION_CENTS ||
      (args.priceCents > 0 && args.priceCents < MIN_PAID_CENTS)
    ) {
      throw new Error("Price must be free, or between 0.50 and 500.00.");
    }
    if (!(CURRENCIES as readonly string[]).includes(args.currency)) throw new Error("Unsupported currency.");

    const open = await ctx.db
      .query("marketplaceSubmissions")
      .withIndex("by_creator", (q) => q.eq("creatorId", me._id))
      .order("desc")
      .take(50);
    if (open.filter((s) => s.status === "pending").length >= MAX_OPEN_SUBMISSIONS) {
      throw new Error("You have a lot waiting for review already. Wait for some to be reviewed first.");
    }

    const grant = creationGrant(args.kind, name, args, me.clerkId);
    const now = Date.now();
    return ctx.db.insert("marketplaceSubmissions", {
      creatorId: me._id,
      name,
      description: description || undefined,
      type: args.kind === "communityTheme" ? "community" : "cosmetic",
      grants: [grant],
      requestedPriceCents: args.priceCents,
      currency: args.currency,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** One thing in a submission, as Studio sends it: artwork as placed layers, a
 * picture, or a spec. Rebuilt on arrival — see `buildCreationItem`. */
const creationItemValidator = v.union(
  v.object({ kind: v.literal("avatarDecoration"), layers: v.array(layerArgValidator) }),
  v.object({ kind: v.literal("profileSticker"), layers: v.array(layerArgValidator) }),
  v.object({ kind: v.literal("profileEffect"), artworkUrl: v.string() }),
  v.object({ kind: v.literal("nameplate"), artworkUrl: v.string() }),
  v.object({ kind: v.literal("loungeScene"), spec: v.any() }),
  v.object({ kind: v.literal("themePack"), spec: v.any() }),
);

/** The grant for one item, built here. Every address in it has to be on our CDN in
 * this creator's own folder, whatever kind of file it points to. */
function buildCreationItem(
  item: typeof creationItemValidator.type,
  name: string,
  clerkId: string,
): { kind: CreationKind; payload: string; label: string } {
  const assertUrl = (url: string) => creationArtworkUrl(url, clerkId);
  switch (item.kind) {
    case "avatarDecoration":
    case "profileSticker": {
      if (item.layers.length === 0 || item.layers.length > MAX_LAYERS) {
        throw new Error(`Artwork is between 1 and ${MAX_LAYERS} layers.`);
      }
      const layers = item.layers.map((layer) => {
        const picture = !layer.kind || layer.kind === "image";
        return {
          ...layer,
          // Pictures are on our CDN or nowhere; text and shapes carry no address.
          url: picture ? assertUrl(layer.url) : "",
          // Nothing in a submission points at a private upload.
          storageId: undefined,
        };
      });
      const normalize = item.kind === "avatarDecoration" ? normalizeDecorationLayers : normalizeStickerLayers;
      return { kind: item.kind, label: name, payload: JSON.stringify(normalize(layers)) };
    }
    case "profileEffect":
    case "nameplate":
      return { kind: item.kind, label: name, payload: assertUrl(item.artworkUrl) };
    case "loungeScene":
      return { kind: item.kind, label: name, payload: JSON.stringify(normalizeSceneSpec({ ...item.spec, name }, assertUrl)) };
    case "themePack":
      return { kind: item.kind, label: name, payload: JSON.stringify(normalizeThemePackSpec({ ...item.spec, name }, assertUrl)) };
  }
}

/**
 * Crystal Studio's way of sending something to be sold: one thing, or several as
 * a pack. What it grants is built here from what was sent, the same way
 * `submitListing` does — nothing in the arguments is stored as it arrived.
 */
export const submitCreation = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    items: v.array(creationItemValidator),
    /** The store picture, for what has no single picture of its own. */
    previewUrl: v.optional(v.string()),
    priceCents: v.number(),
    currency: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const name = args.name.trim();
    if (name.length < 2 || name.length > 60) throw new Error("A name is 2–60 characters.");
    const description = args.description?.trim() ?? "";
    if (description.length > 400) throw new Error("A description is up to 400 characters.");
    if (
      !Number.isInteger(args.priceCents) ||
      args.priceCents < 0 ||
      args.priceCents > MAX_CREATION_CENTS ||
      (args.priceCents > 0 && args.priceCents < MIN_PAID_CENTS)
    ) {
      throw new Error("Price must be free, or between 0.50 and 500.00.");
    }
    if (!(CURRENCIES as readonly string[]).includes(args.currency)) throw new Error("Unsupported currency.");
    if (args.items.length < 1 || args.items.length > MAX_PACK_ITEMS) {
      throw new Error(`A submission holds between 1 and ${MAX_PACK_ITEMS} things.`);
    }
    // A scene is bought by a community and a cosmetic by a person; a single item
    // can't be both, so a community kind is only ever sold on its own.
    if (args.items.length > 1 && args.items.some((i) => COMMUNITY_CREATION_KINDS.includes(i.kind))) {
      throw new Error("Scenes and community themes are sold on their own, not in a pack.");
    }
    // Two of one kind in a pack would fight over the same slot on a profile.
    const personalKinds = args.items.map((i) => i.kind);
    if (new Set(personalKinds).size !== personalKinds.length) {
      throw new Error("A pack can hold one of each kind of thing.");
    }

    const open = await ctx.db
      .query("marketplaceSubmissions")
      .withIndex("by_creator", (q) => q.eq("creatorId", me._id))
      .order("desc")
      .take(50);
    if (open.filter((s) => s.status === "pending").length >= MAX_OPEN_SUBMISSIONS) {
      throw new Error("You have a lot waiting for review already. Wait for some to be reviewed first.");
    }

    const grants = args.items.map((item) => buildCreationItem(item, name, me.clerkId));
    const previewUrl = args.previewUrl ? creationArtworkUrl(args.previewUrl, me.clerkId) : undefined;
    const single = grants.length === 1 ? grants[0] : null;
    if (!previewUrl && !(single && previewOf(single))) {
      throw new Error("Add a store picture so people can see what they are buying.");
    }

    const now = Date.now();
    return ctx.db.insert("marketplaceSubmissions", {
      creatorId: me._id,
      name,
      description: description || undefined,
      type: single ? (COMMUNITY_CREATION_KINDS.includes(single.kind) ? "community" : "cosmetic") : "bundle",
      grants,
      previewUrl,
      requestedPriceCents: args.priceCents,
      currency: args.currency,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Take a submission back before anyone has looked at it. */
export const withdrawSubmission = mutation({
  args: { submissionId: v.id("marketplaceSubmissions") },
  handler: async (ctx, { submissionId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const row = await ctx.db.get(submissionId);
    if (!row || row.creatorId !== me._id) throw new Error("That isn't yours.");
    if (row.status !== "pending") throw new Error("It has already been reviewed.");
    await ctx.db.delete(submissionId);
  },
});

/** Stop selling something you made. People who already own it keep it. */
export const retireCreation = mutation({
  args: { skuId: v.id("skus") },
  handler: async (ctx, { skuId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const sku = await ctx.db.get(skuId);
    if (!sku || sku.creatorId !== me._id) throw new Error("That isn't yours.");
    if (sku.status === "active") await ctx.db.patch(skuId, { status: "archived", updatedAt: Date.now() });
  },
});

/** The caller's creations: what is waiting, what was turned down and what is for
 * sale, with how it has sold. */
export const myCreations = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    const submissions = await ctx.db
      .query("marketplaceSubmissions")
      .withIndex("by_creator", (q) => q.eq("creatorId", me._id))
      .order("desc")
      .take(100);

    const live = await Promise.all(
      submissions
        .filter((s) => s.status === "approved" && s.skuId)
        .map(async (s) => {
          const sku = await ctx.db.get(s.skuId!);
          if (!sku) return null;
          const orders = await ctx.db
            .query("orders")
            .withIndex("by_sku", (q) => q.eq("skuId", sku._id))
            .take(2000);
          const sold = orders.filter((o) => o.status === "paid");
          return { submissionId: s._id, sku, sales: sold.length };
        }),
    );
    const liveBySubmission = new Map(live.filter((x) => x !== null).map((x) => [x.submissionId, x]));

    return submissions.map((s) => {
      const published = liveBySubmission.get(s._id);
      const grant = s.grants[0];
      return {
        id: s._id,
        name: s.name,
        description: s.description,
        kind: grant?.kind ?? "unknown",
        payload: grant?.payload,
        previewUrl: s.previewUrl ?? (grant ? previewOf(grant) : undefined),
        status: s.status,
        reviewNote: s.reviewNote,
        priceCents: published?.sku.priceCents ?? s.requestedPriceCents,
        currency: s.currency,
        createdAt: s.createdAt,
        sku: published
          ? {
              id: published.sku._id,
              status: published.sku.status,
              sales: published.sales,
              shareBps: published.sku.creatorShareBps ?? DEFAULT_CREATOR_SHARE_BPS,
            }
          : null,
      };
    });
  },
});

export const adminSubmissions = query({
  args: { status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"))) },
  handler: async (ctx, { status }) => {
    await requireStaff(ctx, "catalog.read");
    const rows = status
      ? await ctx.db.query("marketplaceSubmissions").withIndex("by_status", (q) => q.eq("status", status)).order("desc").take(200)
      : await ctx.db.query("marketplaceSubmissions").order("desc").take(200);
    return Promise.all(
      rows.map(async (row) => {
        const creator = await ctx.db.get(row.creatorId);
        return {
          ...row,
          creator: creator?.username ?? "unknown",
          creatorName: creator?.name,
          kind: row.grants[0]?.kind ?? "unknown",
          previewUrl: row.previewUrl ?? (row.grants[0] ? previewOf(row.grants[0]) : undefined),
        };
      }),
    );
  },
});

export const adminSubmission = query({
  args: { submissionId: v.id("marketplaceSubmissions") },
  handler: async (ctx, { submissionId }) => {
    await requireStaff(ctx, "catalog.read");
    const row = await ctx.db.get(submissionId);
    if (!row) return null;
    const creator = await ctx.db.get(row.creatorId);
    const sku = row.skuId ? await ctx.db.get(row.skuId) : null;
    // How this creator has fared before: the thing a reviewer wants to know.
    const history = await ctx.db
      .query("marketplaceSubmissions")
      .withIndex("by_creator", (q) => q.eq("creatorId", row.creatorId))
      .take(100);
    return {
      ...row,
      creator: creator ? { id: creator._id, username: creator.username, name: creator.name, imageUrl: creator.imageUrl } : null,
      sku: sku ? { id: sku._id, slug: sku.slug, status: sku.status } : null,
      past: {
        approved: history.filter((h) => h.status === "approved").length,
        rejected: history.filter((h) => h.status === "rejected").length,
      },
    };
  },
});

export const adminRejectSubmission = mutation({
  args: { submissionId: v.id("marketplaceSubmissions"), note: v.string() },
  handler: async (ctx, { submissionId, note }) => {
    const staff = await requireStaff(ctx, "catalog.write");
    const row = await ctx.db.get(submissionId);
    if (!row || row.status !== "pending") throw new Error("That submission is no longer pending.");
    const reason = note.trim().slice(0, 500);
    if (reason.length < 3) throw new Error("Tell the creator why, so they can fix it.");
    await ctx.db.patch(submissionId, { status: "rejected", reviewNote: reason, updatedAt: Date.now() });
    await audit(ctx, staff.user._id, "catalog.submission.reject", { type: "submission", id: submissionId }, reason);
  },
});

export const adminApproveSubmission = mutation({
  args: {
    submissionId: v.id("marketplaceSubmissions"),
    categoryId: v.id("skuCategories"),
    slug: v.string(),
    /** Staff may price it differently from what was asked. */
    priceCents: v.optional(v.number()),
    /** What the creator keeps, in basis points. Defaults to 80%. */
    creatorShareBps: v.optional(v.number()),
    featured: v.optional(v.boolean()),
  },
  handler: async (ctx, { submissionId, categoryId, slug, priceCents, creatorShareBps, featured }) => {
    const staff = await requireStaff(ctx, "catalog.write");
    const row = await ctx.db.get(submissionId);
    if (!row || row.status !== "pending") throw new Error("That submission is no longer pending.");
    const category = await ctx.db.get(categoryId);
    if (!category) throw new Error("Category not found.");
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) throw new Error("Invalid SKU slug.");
    if (await ctx.db.query("skus").withIndex("by_slug", (q) => q.eq("slug", slug)).unique()) {
      throw new Error("That slug is already in use.");
    }

    // Whatever the submission says, only these can be sold by a creator. Checked
    // again here, not only when it was submitted.
    const grant = row.grants[0];
    if (
      row.grants.length < 1 ||
      row.grants.length > MAX_PACK_ITEMS ||
      !grant ||
      !row.grants.every((g) => (CREATION_KINDS as readonly string[]).includes(g.kind)) ||
      (row.grants.length > 1 && row.grants.some((g) => COMMUNITY_CREATION_KINDS.includes(g.kind)))
    ) {
      throw new Error("This submission isn't something a creator can sell.");
    }
    const price = priceCents ?? row.requestedPriceCents;
    if (!Number.isInteger(price) || price < 0 || price > MAX_CREATION_CENTS || (price > 0 && price < MIN_PAID_CENTS)) {
      throw new Error("Price must be free, or between 0.50 and 500.00.");
    }
    const share = creatorShareBps ?? DEFAULT_CREATOR_SHARE_BPS;
    if (!Number.isInteger(share) || share < 0 || share > 9500) throw new Error("The creator's share can be 0%–95%.");

    const now = Date.now();
    const skuId = await ctx.db.insert("skus", {
      slug,
      name: row.name,
      description: row.description,
      categoryId,
      type: row.type,
      priceCents: price,
      currency: row.currency,
      grants: row.grants.map((g) => ({ kind: g.kind as CreationKind, payload: g.payload, label: g.label })),
      imageUrl: row.previewUrl ?? previewOf(grant),
      status: "active",
      featured: featured ?? false,
      position: now,
      creatorId: row.creatorId,
      creatorShareBps: share,
      createdBy: staff.user._id,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(submissionId, { status: "approved", skuId, updatedAt: now });
    await audit(
      ctx,
      staff.user._id,
      "catalog.submission.approve",
      { type: "submission", id: submissionId },
      `SKU ${slug} · creator keeps ${share / 100}%`,
    );
    if (price > 0) await ctx.scheduler.runAfter(0, internal.payments.syncSku, { skuId });
    return skuId;
  },
});

function parseLayers(payload: string | undefined, skuId: string): LayerArg[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload ?? "");
  } catch {
    throw new Error("That item's artwork is broken.");
  }
  if (!Array.isArray(parsed)) throw new Error("That item's artwork is broken.");
  return (parsed as Partial<LayerArg>[]).map((layer, index) => ({
    anchor: "center",
    x: 50,
    y: 0,
    width: 100,
    url: "",
    ...layer,
    // Staff-authored artwork has no id of its own, and none carries a Convex
    // file: it is on the CDN, shared by everyone who owns it.
    id: layer.id ?? `${skuId}-${index}`,
    storageId: undefined,
  })) as LayerArg[];
}

/**
 * Put something you own to use.
 *
 * Checked against the entitlement row, not against what the caller says they
 * own: the id is looked up, has to be theirs, and has to still be in force.
 * Cosmetics are written the same way the editors write them — through the same
 * limits — so a purchased decoration obeys the canvas bounds like any other.
 */
export const equip = mutation({
  args: { entitlementId: v.id("entitlements") },
  handler: async (ctx, { entitlementId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const entitlement = await ctx.db.get(entitlementId);
    if (!entitlement || entitlement.userId !== me._id) throw new Error("That isn't yours.");
    if (!isActive(entitlement)) throw new Error("That has run out.");

    switch (entitlement.kind) {
      case "avatarDecoration": {
        const next = normalizeDecorationLayers(parseLayers(entitlement.payload, entitlement.skuId));
        const previousLayers = me.avatarDecorationLayers;
        const previousSingle = me.avatarDecorationStorageId;
        await ctx.db.patch(me._id, {
          avatarDecorationLayers: next,
          avatarDecoration: `layers:${JSON.stringify(next)}`,
          avatarDecorationStorageId: undefined,
        });
        await dropUnusedLayerAssets(ctx, previousLayers, next);
        if (previousSingle) await ctx.storage.delete(previousSingle).catch(() => {});
        return { applied: true };
      }

      case "profileSticker": {
        const next = normalizeStickerLayers(parseLayers(entitlement.payload, entitlement.skuId));
        const previous = me.profileFrameLayers;
        await ctx.db.patch(me._id, { profileFrameLayers: next });
        await dropUnusedLayerAssets(ctx, previous, next);
        return { applied: true };
      }

      case "profileEffect": {
        const url = entitlement.payload;
        if (!url) throw new Error("That item has no artwork.");
        const previousStorage = me.profileEffectStorageId;
        const previousUrl = me.profileEffect as string | undefined;
        await ctx.db.patch(me._id, { profileEffect: url, profileEffectStorageId: undefined });
        if (previousStorage) await ctx.storage.delete(previousStorage).catch(() => {});
        if (previousUrl && previousUrl !== url) await dropR2Url(ctx, previousUrl);
        return { applied: true };
      }

      case "nameplate": {
        const url = entitlement.payload;
        if (!url) throw new Error("That item has no artwork.");
        const previousStorage = me.nameplateStorageId;
        const previousUrl = me.nameplateUrl;
        await ctx.db.patch(me._id, { nameplateUrl: url, nameplateStorageId: undefined });
        if (previousStorage) await ctx.storage.delete(previousStorage).catch(() => {});
        if (previousUrl && previousUrl !== url) await dropR2Url(ctx, previousUrl);
        return { applied: true };
      }

      case "communityTheme": {
        if (!entitlement.communityId) throw new Error("That theme isn't for a community.");
        const community = await requireCommunity(ctx, entitlement.communityId);
        // Having bought it is not the same as being allowed to change the
        // community: that still has to be true now.
        await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_COMMUNITY);
        let colours: { start?: string; end?: string };
        try {
          colours = JSON.parse(entitlement.payload ?? "");
        } catch {
          throw new Error("That theme is broken.");
        }
        if (!colours.start || !colours.end) throw new Error("That theme is broken.");
        await ctx.db.patch(community._id, {
          themeStart: colours.start.toLowerCase(),
          themeEnd: colours.end.toLowerCase(),
        });
        try {
          const { cacheInvalidateKeys } = await import("./cache");
          await cacheInvalidateKeys(`community:${community._id}:user:${me._id}:data`);
        } catch {}
        return { applied: true };
      }

      case "themePack": {
        // One pack at a time: choosing another replaces it. Only the pointer is
        // stored — the pack itself is read from the entitlement when it applies.
        await ctx.db.patch(me._id, { themePackEntitlementId: entitlement._id });
        return { applied: true };
      }

      // A plan's perks and a community's boost are in force while owned; there
      // is nothing to switch on.
      default:
        return { applied: false };
    }
  },
});

/** Take the theme pack off: the client goes back to its own theme, font, sounds
 * and icons. */
export const unequipThemePack = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrThrow(ctx);
    if (me.themePackEntitlementId) await ctx.db.patch(me._id, { themePackEntitlementId: undefined });
  },
});

/**
 * The theme pack this person's client should be wearing, or null.
 *
 * Read from the entitlement on every call rather than copied onto the user: a
 * pack that was refunded or has run out stops applying the moment it does, and
 * what is returned is rebuilt through the same validator that admitted it.
 */
export const activeThemePack = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me?.themePackEntitlementId) return null;
    const entitlement = await ctx.db.get(me.themePackEntitlementId);
    if (!entitlement || entitlement.userId !== me._id || entitlement.kind !== "themePack" || !isActive(entitlement)) {
      return null;
    }
    try {
      const spec = normalizeThemePackSpec(
        { name: entitlement.label ?? "Theme pack", ...(JSON.parse(entitlement.payload ?? "") as object) },
        (url) => url,
      );
      return { entitlementId: entitlement._id, spec };
    } catch {
      return null;
    }
  },
});

export type EntitlementDoc = Doc<"entitlements">;
export type EntitlementId = Id<"entitlements">;

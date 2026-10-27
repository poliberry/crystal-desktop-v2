import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { audit, requireStaff } from "./lib/staff";
import { isMotionAddress } from "./lib/motionAddress";
import { isR2Url } from "./lib/r2";

const mappingValidator = v.object({
  sourceUrl: v.string(),
  videoUrl: v.string(),
  posterUrl: v.string(),
  loopFrom: v.optional(v.number()),
  previewUrl: v.optional(v.string()),
});
type VideoMapping = { sourceUrl: string; videoUrl: string; posterUrl: string; loopFrom?: number; previewUrl?: string };

function candidateUrl(value: string | undefined): string | undefined {
  if (!value) return;
  const url = value.split("#", 1)[0];
  return isMotionAddress(url) ? url : undefined;
}

function addCandidate(counts: Map<string, { url: string; listings: number; owners: number }>, value: string | undefined, field: "listings" | "owners") {
  const url = candidateUrl(value);
  if (!url) return;
  const row = counts.get(url) ?? { url, listings: 0, owners: 0 };
  row[field]++;
  counts.set(url, row);
}

/** Animated Studio effects still worn as compact JSON timelines. Read by staff before migration. */
export const candidates = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx, "catalog.read");
    const counts = new Map<string, { url: string; listings: number; owners: number }>();
    const skus = await ctx.db.query("skus").collect();
    for (const sku of skus) for (const grant of sku.grants) {
      if (grant.kind === "profileEffect" || grant.kind === "nameplate") addCandidate(counts, grant.payload, "listings");
    }
    const submissions = await ctx.db.query("marketplaceSubmissions").collect();
    for (const row of submissions) for (const grant of row.grants) {
      if (grant.kind === "profileEffect" || grant.kind === "nameplate") addCandidate(counts, grant.payload, "listings");
    }
    const entitlements = await ctx.db.query("entitlements").collect();
    for (const row of entitlements) if (row.kind === "profileEffect" || row.kind === "nameplate") addCandidate(counts, row.payload, "owners");
    const users = await ctx.db.query("users").collect();
    for (const row of users) {
      addCandidate(counts, row.profileEffect, "owners");
      addCandidate(counts, row.nameplateUrl, "owners");
    }
    const profiles = await ctx.db.query("serverProfiles").collect();
    for (const row of profiles) {
      addCandidate(counts, row.profileEffect, "owners");
      addCandidate(counts, row.nameplateUrl, "owners");
    }
    return [...counts.values()].sort((a, b) => a.url.localeCompare(b.url));
  },
});

function mappedUrl(value: string | undefined, map: Map<string, VideoMapping>): string | undefined {
  if (!value) return value;
  const sourceUrl = value.split("#", 1)[0];
  const item = map.get(sourceUrl);
  if (!item) return value;
  return mappedVideoUrl(item);
}

function mappedVideoUrl(item: VideoMapping): string {
  const tags = [`cosmetic-poster=${encodeURIComponent(item.posterUrl)}`, ...(item.loopFrom !== undefined ? [`cosmetic-loop=${item.loopFrom}`] : [])];
  return `${item.videoUrl}#${tags.join("&")}`;
}

function mappedPayload(payload: string | undefined, kind: string, map: Map<string, VideoMapping>): string | undefined {
  if (!payload) return payload;
  if (kind === "profileEffect" || kind === "nameplate") return mappedUrl(payload, map);
  if (kind !== "avatarDecoration" && kind !== "profileSticker") return payload;
  try {
    const layers = JSON.parse(payload) as Array<{ url?: string; posterUrl?: string }>;
    if (!Array.isArray(layers)) return payload;
    let changed = false;
    const next = layers.map((layer) => {
      const item = layer.url && map.get(layer.url.split("#", 1)[0]);
      if (!item) return layer;
      changed = true;
      return { ...layer, url: mappedVideoUrl(item), posterUrl: item.posterUrl };
    });
    return changed ? JSON.stringify(next) : payload;
  } catch {
    return payload;
  }
}

function hasMappedPayload(grants: Array<{ kind: string; payload?: string }>, map: Map<string, VideoMapping>) {
  return grants.some((grant) => mappedPayload(grant.payload, grant.kind, map) !== grant.payload);
}

/** Repoint listings, purchases and equipped cosmetics in bounded, audited batches. */
export const repoint = mutation({
  args: { mappings: v.array(mappingValidator) },
  handler: async (ctx, { mappings }) => {
    const staff = await requireStaff(ctx, "catalog.write");
    if (mappings.length < 1 || mappings.length > 20) throw new Error("Migrate between 1 and 20 videos at a time.");
    const map = new Map<string, VideoMapping>();
    for (const item of mappings) {
      if (!isMotionAddress(item.sourceUrl) || !isR2Url(item.videoUrl) || !/\.webm(?:\?.*)?$/i.test(item.videoUrl) || !isR2Url(item.posterUrl) || !/\.(?:png|webp)(?:\?.*)?$/i.test(item.posterUrl) || (item.previewUrl && !isR2Url(item.previewUrl)) || (item.loopFrom !== undefined && (!Number.isFinite(item.loopFrom) || item.loopFrom <= 0 || item.loopFrom >= 12))) {
        throw new Error("A migrated video, poster and preview must be uploaded to the CDN first.");
      }
      map.set(item.sourceUrl, item);
    }
    if (map.size !== mappings.length) throw new Error("A migration batch contains the same source more than once.");

    let listings = 0;
    let submissionsChanged = 0;
    let entitlementsChanged = 0;
    let usersChanged = 0;
    let serverProfilesChanged = 0;
    const skus = await ctx.db.query("skus").collect();
    for (const sku of skus) {
      if (!hasMappedPayload(sku.grants, map)) continue;
      const grants = sku.grants.map((grant) => ({ ...grant, payload: mappedPayload(grant.payload, grant.kind, map) ?? grant.payload }));
      const previewUrl = mappings.find((item) => sku.grants.some((grant) => grant.payload?.includes(item.sourceUrl)))?.previewUrl;
      await ctx.db.patch(sku._id, { grants, ...(previewUrl ? { imageUrl: previewUrl } : {}), updatedAt: Date.now() });
      listings++;
    }
    const submissions = await ctx.db.query("marketplaceSubmissions").collect();
    for (const row of submissions) {
      if (!hasMappedPayload(row.grants, map)) continue;
      const grants = row.grants.map((grant) => ({ ...grant, payload: mappedPayload(grant.payload, grant.kind, map) ?? grant.payload }));
      const previewUrl = mappings.find((item) => row.grants.some((grant) => grant.payload?.includes(item.sourceUrl)))?.previewUrl;
      await ctx.db.patch(row._id, { grants, ...(previewUrl ? { previewUrl } : {}), updatedAt: Date.now() });
      submissionsChanged++;
    }
    const entitlements = await ctx.db.query("entitlements").collect();
    for (const row of entitlements) {
      const payload = mappedPayload(row.payload, row.kind, map);
      if (payload === row.payload) continue;
      await ctx.db.patch(row._id, { payload });
      entitlementsChanged++;
    }
    const users = await ctx.db.query("users").collect();
    for (const row of users) {
      const patch: Partial<Doc<"users">> = {};
      const profileEffect = mappedUrl(row.profileEffect, map);
      const nameplateUrl = mappedUrl(row.nameplateUrl, map);
      if (profileEffect !== row.profileEffect) patch.profileEffect = profileEffect;
      if (nameplateUrl !== row.nameplateUrl) patch.nameplateUrl = nameplateUrl;
      if (Object.keys(patch).length) { await ctx.db.patch(row._id, patch); usersChanged++; }
    }
    const profiles = await ctx.db.query("serverProfiles").collect();
    for (const row of profiles) {
      const patch: Partial<Doc<"serverProfiles">> = {};
      const profileEffect = mappedUrl(row.profileEffect, map);
      const nameplateUrl = mappedUrl(row.nameplateUrl, map);
      if (profileEffect !== row.profileEffect) patch.profileEffect = profileEffect;
      if (nameplateUrl !== row.nameplateUrl) patch.nameplateUrl = nameplateUrl;
      if (Object.keys(patch).length) { await ctx.db.patch(row._id, patch); serverProfilesChanged++; }
    }
    const summary = `Video migration: ${listings} listings, ${submissionsChanged} submissions, ${entitlementsChanged} entitlements, ${usersChanged} user profiles, ${serverProfilesChanged} server profiles updated.`;
    await audit(ctx, staff.user._id, "catalog.cosmetic_videos.migrate", undefined, summary);
    return { listings, submissions: submissionsChanged, entitlements: entitlementsChanged, users: usersChanged, serverProfiles: serverProfilesChanged };
  },
});

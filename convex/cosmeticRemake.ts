import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";
import { isR2Enabled, r2PublicUrlForKey } from "./lib/r2";
import { audit } from "./lib/staff";

/**
 * Publishing Crystal's remade animated cosmetics (scripts/cosmetics/, rendered by scripts/render-cosmetics.mjs).
 *
 * Operator-only: these are internal functions, so nothing in the app can call them; `scripts/publish-cosmetic-remakes.mjs`
 * runs them with `npx convex run` against the deployment it names, which needs that deployment's deploy credentials.
 * They act as the `crystal` system account and are audited, as the collection's other publishing functions are.
 *
 *  1. `presignUploads` hands out short-lived, single-object upload URLs for new, content-addressed files under
 *     `marketplace/cosmetics/<version>/`. It never overwrites: a key that already exists is reported and skipped, and a
 *     key's name carries a hash of its bytes, so an existing key already holds exactly those bytes.
 *  2. The script uploads the files and checks each one back from the CDN.
 *  3. `repoint` swaps every reference to an old cosmetic for its remake, in one transaction: listings (and their
 *     pictures, names and descriptions), submissions, purchases, and what people and server profiles have equipped.
 *     `dryRun` reports what would change and writes nothing.
 *
 * Old files are left where they are. They are only unreferenced afterwards, and are cleaned up separately, once the
 * remakes have been checked in the app.
 */

const FOLDER = /^marketplace\/cosmetics\/v\d+\/[a-z0-9-]+-[0-9a-f]{16}\.(webm|mp4|png)$/;
const TYPES: Record<string, string> = { webm: "video/webm", mp4: "video/mp4", png: "image/png" };

function r2() {
  if (!isR2Enabled()) throw new Error("This deployment has no CDN configured (R2_* settings).");
  return {
    base: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET}`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!, service: "s3", region: "auto" },
  };
}

export const presignUploads = internalAction({
  args: { files: v.array(v.object({ key: v.string(), bytes: v.number() })) },
  handler: async (_ctx, { files }) => {
    if (files.length < 1 || files.length > 200) throw new Error("Between 1 and 200 files at a time.");
    for (const f of files) {
      if (!FOLDER.test(f.key)) throw new Error(`${f.key} is not a remade cosmetic's address (marketplace/cosmetics/v<n>/<slug>-<hash>.<webm|mp4|png>).`);
      if (!Number.isInteger(f.bytes) || f.bytes < 1 || f.bytes > 12 * 1024 * 1024) throw new Error(`${f.key} is not between 1 byte and 12 MB.`);
    }
    const { AwsClient } = await import("aws4fetch");
    const { base, credentials } = r2();
    const client = new AwsClient(credentials);
    const out: { key: string; publicUrl: string; exists: boolean; uploadUrl?: string; headers?: Record<string, string> }[] = [];
    for (const f of files) {
      const publicUrl = r2PublicUrlForKey(f.key);
      const head = await client.fetch(`${base}/${f.key}`, { method: "HEAD" });
      if (head.ok) {
        out.push({ key: f.key, publicUrl, exists: true });
        continue;
      }
      if (head.status !== 404) throw new Error(`Couldn't check ${f.key} (${head.status}).`);
      const headers = { "Content-Type": TYPES[f.key.split(".").pop()!], "Cache-Control": "public, max-age=31536000, immutable" };
      const url = new URL(`${base}/${f.key}`);
      url.searchParams.set("X-Amz-Expires", "900");
      const signed = await client.sign(url.toString(), { method: "PUT", headers, aws: { signQuery: true } });
      out.push({ key: f.key, publicUrl, exists: false, uploadUrl: signed.url, headers });
    }
    return out;
  },
});

const itemValidator = v.object({
  slug: v.string(),
  kind: v.union(v.literal("nameplate"), v.literal("profileEffect"), v.literal("avatarDecoration")),
  /** The old addresses (fragment-free) and `builtin:` keys this replaces. */
  sources: v.array(v.string()),
  /** The new stored value: the WebM's address with its poster, loop point and HEVC copy in the fragment. */
  payload: v.string(),
  posterUrl: v.string(),
  /** Listings to refresh: their picture becomes the poster and, when given, their name and description. */
  skuSlugs: v.array(v.string()),
  name: v.optional(v.string()),
  description: v.optional(v.string()),
});
type Item = typeof itemValidator.type;

const base = (url: string) => url.split("#", 1)[0];

interface Layer {
  url?: string;
  posterUrl?: string;
  [key: string]: unknown;
}

export const repoint = internalMutation({
  args: { items: v.array(itemValidator), dryRun: v.optional(v.boolean()), version: v.string() },
  handler: async (ctx, { items, dryRun, version }) => {
    const author = (await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", "crystal")).unique())?._id;
    if (!author) throw new Error("There is no `crystal` user to record this against.");
    const cdn = r2PublicUrlForKey(`marketplace/cosmetics/${version}/`);
    const motion = new Map<string, Item>();
    const decoration = new Map<string, Item>();
    const claim = (item: Item, source: string) => {
      if (source.startsWith(cdn)) return; // already a remake: nothing to replace
      const into = item.kind === "avatarDecoration" ? decoration : motion;
      const other = motion.get(source) ?? decoration.get(source);
      if (other && other !== item) throw new Error(`${source} is claimed by both ${other.slug} and ${item.slug}.`);
      into.set(source, item);
    };
    const allSkus = await ctx.db.query("skus").collect();
    for (const item of items) {
      if (!item.payload.startsWith(cdn) || !item.posterUrl.startsWith(cdn) || !/\.webm#/.test(item.payload) || !/\.png$/.test(item.posterUrl)) throw new Error(`${item.slug}'s files are not under ${cdn}.`);
      for (const s of item.sources) claim(item, s);
      // What the listings sell now is replaced too, whatever version of it that is.
      for (const slug of item.skuSlugs) {
        const sku = allSkus.find((s) => s.slug === slug);
        if (!sku) throw new Error(`There is no listing called ${slug}.`);
        for (const g of sku.grants) {
          if (g.kind !== item.kind || !g.payload) continue;
          if (item.kind === "avatarDecoration") {
            for (const layer of JSON.parse(g.payload) as Layer[]) if (layer.url) claim(item, base(layer.url));
          } else claim(item, base(g.payload));
        }
      }
    }

    const changes: string[] = [];
    const note = (what: string) => changes.push(what);
    const motionValue = (value: string | undefined): string | undefined => (value ? motion.get(base(value))?.payload : undefined);
    const layerList = (layers: Layer[]): Layer[] | undefined => {
      let changed = false;
      const next = layers.map((layer) => {
        const item = layer.url ? decoration.get(base(layer.url)) : undefined;
        if (!item) return layer;
        changed = true;
        return { ...layer, url: item.payload, posterUrl: item.posterUrl };
      });
      return changed ? next : undefined;
    };
    const layerJson = (payload: string | undefined): string | undefined => {
      if (!payload) return;
      try {
        const layers = JSON.parse(payload);
        if (!Array.isArray(layers)) return;
        const next = layerList(layers);
        return next ? JSON.stringify(next) : undefined;
      } catch {
        return;
      }
    };
    const grantPayload = (kind: string, payload: string | undefined): string | undefined => {
      if (kind === "nameplate" || kind === "profileEffect") return motionValue(payload);
      if (kind === "avatarDecoration" || kind === "profileSticker") return layerJson(payload);
      return;
    };
    const grants = <G extends { kind: string; payload?: string }>(list: G[]): G[] | undefined => {
      let changed = false;
      const next = list.map((g) => {
        const payload = grantPayload(g.kind, g.payload);
        if (payload === undefined || payload === g.payload) return g;
        changed = true;
        return { ...g, payload };
      });
      return changed ? next : undefined;
    };
    const now = Date.now();

    const bySlug = new Map<string, Item>();
    for (const item of items) for (const s of item.skuSlugs) bySlug.set(s, item);
    for (const sku of allSkus) {
      const nextGrants = grants(sku.grants);
      const listed = bySlug.get(sku.slug);
      if (!nextGrants && !listed) continue;
      const patch: Partial<Doc<"skus">> = { updatedAt: now };
      if (nextGrants) patch.grants = nextGrants;
      if (listed) {
        patch.imageUrl = listed.posterUrl;
        if (listed.name) patch.name = listed.name;
        if (listed.description) patch.description = listed.description;
      }
      note(`sku ${sku.slug}`);
      if (!dryRun) await ctx.db.patch(sku._id, patch);
    }
    for (const row of await ctx.db.query("marketplaceSubmissions").collect()) {
      const nextGrants = grants(row.grants);
      if (!nextGrants) continue;
      const item = items.find((i) => row.grants.some((g) => g.payload && i.sources.some((s) => g.payload!.includes(s))));
      note(`submission ${row.name} (${row.status})`);
      if (!dryRun) await ctx.db.patch(row._id, { grants: nextGrants, ...(item ? { previewUrl: item.posterUrl } : {}), updatedAt: now });
    }
    for (const row of await ctx.db.query("entitlements").collect()) {
      const payload = grantPayload(row.kind, row.payload);
      if (payload === undefined || payload === row.payload) continue;
      note(`entitlement ${row._id} (${row.kind})`);
      if (!dryRun) await ctx.db.patch(row._id, { payload });
    }
    for (const row of await ctx.db.query("users").collect()) {
      const patch: Partial<Doc<"users">> = {};
      const effect = motionValue(row.profileEffect);
      if (effect && effect !== row.profileEffect) Object.assign(patch, { profileEffect: effect, profileEffectStorageId: undefined });
      const nameplate = motionValue(row.nameplateUrl);
      if (nameplate && nameplate !== row.nameplateUrl) Object.assign(patch, { nameplateUrl: nameplate, nameplateStorageId: undefined });
      if (row.avatarDecorationLayers) {
        const next = layerList(row.avatarDecorationLayers as Layer[]);
        if (next) patch.avatarDecorationLayers = next as Doc<"users">["avatarDecorationLayers"];
      }
      if (row.avatarDecoration?.startsWith("layers:")) {
        const next = layerJson(row.avatarDecoration.slice("layers:".length));
        if (next) patch.avatarDecoration = `layers:${next}`;
      } else if (row.avatarDecoration && decoration.has(base(row.avatarDecoration))) {
        const item = decoration.get(base(row.avatarDecoration))!;
        patch.avatarDecoration = `layers:${JSON.stringify([{ id: `${item.slug}-0`, url: item.payload, posterUrl: item.posterUrl, anchor: "center", x: 50, y: 0, width: 126 }])}`;
      }
      if (!Object.keys(patch).length) continue;
      note(`user ${row.username ?? row._id}: ${Object.keys(patch).filter((k) => !k.endsWith("StorageId")).join(", ")}`);
      if (!dryRun) await ctx.db.patch(row._id, patch);
    }
    for (const row of await ctx.db.query("serverProfiles").collect()) {
      const patch: Partial<Doc<"serverProfiles">> = {};
      const effect = motionValue(row.profileEffect);
      if (effect && effect !== row.profileEffect) Object.assign(patch, { profileEffect: effect, profileEffectStorageId: undefined });
      const nameplate = motionValue(row.nameplateUrl);
      if (nameplate && nameplate !== row.nameplateUrl) Object.assign(patch, { nameplateUrl: nameplate, nameplateStorageId: undefined });
      if (!Object.keys(patch).length) continue;
      note(`server profile ${row._id}`);
      if (!dryRun) await ctx.db.patch(row._id, patch);
    }

    if (!dryRun) await audit(ctx, author, "catalog.cosmetic_remake.repoint", undefined, `Cosmetic remakes ${version}: ${items.length} designs; ${changes.length} records repointed`);
    return { dryRun: !!dryRun, changed: changes.length, changes, sources: [...motion.keys(), ...decoration.keys()].length };
  },
});

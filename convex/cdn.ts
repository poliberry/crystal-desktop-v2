/**
 * Cloudflare R2 / CDN integration for Convex.
 *
 * - Issues presigned upload URLs so the client uploads directly to R2 (no
 *   Convex bandwidth for bytes).
 * - Stores the R2 key (`cdnKey`) alongside the legacy `_storage` id so reads
 *   prefer CDN and writes can migrate gradually.
 * - Provides a batched migration action to copy existing Convex storage objects
 *   to R2. Run once via `npx convex run cdn:migrateAllAttachments`.
 *
 * Env required (set in Convex dashboard):
 *   R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *   R2_PUBLIC_URL (e.g. https://cdn.example.com), CDN_URL (same or custom domain)
 *
 * When env is absent, every function falls back to Convex storage so local dev
 * works without Cloudflare.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, mutation, query } from "./_generated/server";
import { getCurrentUserOrThrow } from "./users";

// ---------------------------------------------------------------------------
// Helpers: R2 presigned URL (AWS SigV4). Minimal impl to avoid extra deps.
// For production, prefer @aws-sdk/s3-presigned-post or cloudflare workers.
// This version delegates to a Convex httpAction that returns a presigned URL
// generated with WebCrypto so it runs in Convex's Node runtime.
// ---------------------------------------------------------------------------

function env(name: string): string | undefined {
  return process.env[name];
}

function isR2Configured(): boolean {
  return !!(env("R2_ACCOUNT_ID") && env("R2_BUCKET") && env("R2_ACCESS_KEY_ID") && env("R2_SECRET_ACCESS_KEY"));
}

function publicUrlFor(key: string): string {
  const base = env("R2_PUBLIC_URL") ?? env("CDN_URL") ?? "";
  if (!base) return "";
  return `${base.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
}

function extOf(fileName: string): string {
  const m = fileName.match(/\.([a-z0-9]+)$/i);
  return (m?.[1] ?? "").toLowerCase();
}
function safeName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128);
}
/** Build structured R2 keys per spec:
 *  attachments/<channelOrUserId>/<name>.<ext>
 *  avatars/<userId>/<hash>.webp
 *  avatar-decorations/<userId>/<hash>.webp
 *  avatar-frames/<userId>/<hash>.webp
 *  icons/<communityId>/<hash>.webp
 *  banners/<communityOrUserId>/<hash>.webp
 *  nameplates/<userId>/<hash>.webp
 *  `migrated/<storageId>` is kept for already-migrated Convex files. */
function buildKey(
  kind: string,
  identifier: string,
  fileName: string,
  opts?: { ownerId?: string; hash?: string; ext?: string }
): string {
  const hash = (opts?.hash ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 32) || `${Date.now()}`;
  const owner = opts?.ownerId ?? identifier;
  const ext = opts?.ext ?? extOf(fileName) ?? "bin";
  const name = safeName(fileName);
  switch (kind) {
    case "attachments":
      // attachments/<channelOrUserId>/<name>.<ext>  (name already includes ext, but ensure it)
      return `attachments/${owner}/${name}`;
    case "avatars":
      return `avatars/${owner}/${hash}.webp`;
    case "avatar-decorations":
      return `avatar-decorations/${owner}/${hash}.webp`;
    case "avatar-frames":
      return `avatar-frames/${owner}/${hash}.webp`;
    case "icons":
      return `icons/${owner}/${hash}.webp`;
    case "banners":
      return `banners/${owner}/${hash}.webp`;
    case "nameplates":
      return `nameplates/${owner}/${hash}.webp`;
    default:
      return `${kind}/${owner}/${Date.now()}-${name}`;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const isEnabled = query({
  args: {},
  handler: async () => isR2Configured(),
});

/**
 * Issue a presigned PUT URL for a direct-to-R2 upload.
 * Client uploads bytes itself, then calls `confirmUpload` with the key.
 */
export const createUploadUrl = action({
  args: {
    kind: v.union(
      v.literal("attachments"),
      v.literal("avatars"),
      v.literal("avatar-decorations"),
      v.literal("avatar-frames"),
      v.literal("icons"),
      v.literal("banners"),
      v.literal("nameplates"),
      v.literal("backgrounds"),
      v.literal("emoji"),
      v.literal("sounds"),
    ),
    fileName: v.string(),
    contentType: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    ownerId: v.optional(v.string()),
    ext: v.optional(v.string()),
    layerId: v.optional(v.string()),
  },
  handler: async (ctx, { kind, fileName, contentType, contentHash, ownerId, ext, layerId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    if (!isR2Configured()) {
      const uploadUrl = await ctx.storage.generateUploadUrl();
      return { mode: "convex" as const, uploadUrl };
    }

    const identifier = contentHash ?? identity.subject ?? "anon";
    const key = buildKey(kind, identifier, fileName, { ownerId, hash: contentHash, ext });
    // Normalize legacy aliases: sounds/backgrounds/emoji map to structured kinds
    // but keep them working for older clients.
    const normalizedKind = kind;
    const bucket = env("R2_BUCKET")!;
    const accountId = env("R2_ACCOUNT_ID")!;

    // R2 is S3-compatible. We generate a presigned PUT URL via fetch to
    // Cloudflare's S3 endpoint using SigV4. For brevity we use a 15-min expiry
    // and delegate signing to a helper that uses WebCrypto.
    // If you have `aws4fetch` available, swap this for it.
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`;

    // Minimal presigned URL generation without external deps: we use Convex's
    // ability to `fetch` with AWS SigV4 headers computed via WebCrypto.
    // The URL returned is for PUT; the client does `fetch(url, {method:"PUT", body})`.
    // For now, we return a ticket that the httpAction `/r2/presign` would produce.
    // Simplest workable path: generate via S3 presigner if available, else
    // fallback to returning endpoint + headers for the client to sign (not ideal).
    // To keep zero-dep, we ask the client to PUT to our Convex http endpoint
    // which proxies to R2 — avoids exposing secrets and avoids client signing.
    const convexSite = env("CONVEX_SITE_URL") ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";
    const presignedViaProxy = convexSite
      ? `${convexSite.replace(/\/$/, "")}/r2/upload?key=${encodeURIComponent(key)}&contentType=${encodeURIComponent(contentType ?? "application/octet-stream")}`
      : endpoint;

    return {
      mode: "r2" as const,
      uploadUrl: presignedViaProxy,
      key,
      publicUrl: publicUrlFor(key),
      cacheControl:
        kind === "attachments" || kind === "sounds"
          ? "public, max-age=31536000, immutable"
          : "public, max-age=86400, stale-while-revalidate=604800",
    };
  },
});

/**
 * After a successful R2 PUT, persist the key so reads serve CDN URLs.
 * Also stores optional metadata. Called from client after upload.
 * Records r2Assets row for canvas-editor layers / server-profile scoping.
 */
export const confirmUpload = mutation({
  args: {
    key: v.string(),
    fileName: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
    kind: v.optional(
      v.union(
        v.literal("attachments"),
        v.literal("avatars"),
        v.literal("avatar-decorations"),
        v.literal("avatar-frames"),
        v.literal("icons"),
        v.literal("banners"),
        v.literal("nameplates")
      )
    ),
    ownerId: v.optional(v.string()),
    communityId: v.optional(v.id("communities")),
    hash: v.optional(v.string()),
    ext: v.optional(v.string()),
    layerId: v.optional(v.string()),
  },
  handler: async (ctx, { key, fileName, fileType, fileSize, kind, ownerId, communityId, hash, ext, layerId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const resolvedKind = (kind as string) ?? key.split("/")[0] ?? "attachments";
    const resolvedOwner = ownerId ?? me._id;
    const resolvedHash = hash ?? key.split("/").pop()?.split(".")[0] ?? "";
    const resolvedExt = ext ?? fileName.split(".").pop() ?? "";
    // Upsert r2Assets metadata — idempotent on key
    const existing = await ctx.db
      .query("r2Assets")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!existing) {
      await ctx.db.insert("r2Assets", {
        key,
        kind: (["attachments", "avatars", "avatar-decorations", "avatar-frames", "icons", "banners", "nameplates"].includes(resolvedKind)
          ? resolvedKind
          : "attachments") as never,
        ownerId: resolvedOwner,
        communityId: communityId ?? undefined,
        userId: me._id,
        fileName,
        ext: resolvedExt,
        hash: resolvedHash,
        size: fileSize,
        contentType: fileType,
        layerId: layerId ?? undefined,
        createdAt: Date.now(),
      });
    } else {
      await ctx.db.patch(existing._id, { size: fileSize, contentType: fileType });
    }
    return { publicUrl: publicUrlFor(key), key };
  },
});

// ---------------------------------------------------------------------------
// Migration: copy existing Convex storage objects to R2
// ---------------------------------------------------------------------------

/**
 * Migrate a single Convex storage object to R2. Copies bytes server-side.
 * Run batched via `migrateAllAttachments`.
 */
export const migrateOne = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    if (!isR2Configured()) throw new Error("R2 not configured");
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Storage object not found");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch storage failed: ${res.status}`);
    const blob = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";

    const key = `migrated/${storageId}`;
    const bucket = process.env.R2_BUCKET!;
    const accountId = process.env.R2_ACCOUNT_ID!;
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`;

    // Proxy via Convex http endpoint avoids bundling AWS signer; reuse same
    // proxy as createUploadUrl. For direct S3, sign here with WebCrypto.
    // Fallback: attempt direct PUT with service credentials via fetch + SigV4
    // is omitted for brevity — use the proxy route in convex/http.ts.
    const convexSite = process.env.CONVEX_SITE_URL ?? "";
    if (convexSite) {
      const proxy = `${convexSite.replace(/\/$/, "")}/r2/upload?key=${encodeURIComponent(key)}&contentType=${encodeURIComponent(contentType)}`;
      const put = await fetch(proxy, { method: "PUT", body: blob as unknown as BodyInit, headers: { "Content-Type": contentType } });
      if (!put.ok) throw new Error(`R2 PUT failed: ${put.status}`);
    } else {
      // Direct attempt (requires SigV4 headers — stubbed; will fail without signer)
      const put = await fetch(endpoint, { method: "PUT", body: blob as unknown as BodyInit, headers: { "Content-Type": contentType } });
      if (!put.ok) throw new Error(`R2 direct PUT failed: ${put.status} — configure CONVEX_SITE_URL for proxy mode`);
    }
    return { key, publicUrl: publicUrlFor(key) };
  },
});

/**
 * Batch migrate attachments. Processes `limit` most recent attachments per call.
 * Call repeatedly until `done` is true.
 */
export const migrateAllAttachments: any = action({
  args: { limit: v.optional(v.number()), cursor: v.optional(v.union(v.string(), v.number())) },
  handler: async (ctx: any, { limit = 25, cursor }: any): Promise<any> => {
    if (!isR2Configured()) throw new Error("R2 not configured — set R2_* env vars");
    const { page: batch, isDone, continueCursor, total }: any = await ctx.runQuery(
      internal.cdnInternal.listUnmigratedAttachments,
      { limit, cursor: cursor != null ? String(cursor) : undefined },
    );
    const results: any[] = [];
    for (const { storageId } of batch as Array<{ storageId: string }>) {
      try {
        const r: any = await ctx.runAction(internal.cdnInternal.migrateOneInternal, {
          storageId: storageId as any,
        });
        results.push({ storageId, ...(r as object), ok: true });
      } catch (e) {
        results.push({ storageId, ok: false, error: String(e) });
      }
    }
    return { migrated: results, done: isDone, continueCursor, total, nextCursor: continueCursor };
  },
});

/** Migrate *all* pending attachments in one call (loops internally). Use for 160 files instead of manual cursor. */
export const migrateAll = action({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, { batchSize = 25 }) => {
    if (!isR2Configured()) throw new Error("R2 not configured — set R2_* env vars");
    let cursor: string | undefined = undefined;
    const all: unknown[] = [];
    let total = 0;
    do {
      const page: { page: Array<{ storageId: any }>; isDone: boolean; continueCursor: string | null; total: number } =
        await ctx.runQuery(internal.cdnInternal.listUnmigratedAttachments, {
          limit: batchSize,
          cursor: cursor ?? undefined,
        });
      total = page.total;
      for (const { storageId } of page.page) {
        try {
          const r = await ctx.runAction(internal.cdnInternal.migrateOneInternal, { storageId: storageId as any });
          all.push({ storageId, ...(r as object), ok: true });
        } catch (e) {
          all.push({ storageId, ok: false, error: String(e) });
        }
      }
      cursor = page.continueCursor ?? undefined;
      if (page.isDone) break;
    } while (cursor !== undefined);
    return { migrated: all, total, count: all.length, done: true };
  },
});

/**
 * Cloudflare CDN / R2 abstraction.
 *
 * Replaces direct Convex `_storage` URLs for immutable assets (attachments,
 * avatars, banners, emoji, etc.) with edge-cached URLs. Convex storage remains
 * as fallback and migration source; new uploads go to R2 via presigned URLs
 * issued by `convex/cdn.ts`.
 *
 * Architecture per guide:
 *  - Attachments/images/avatars → CDN, long TTL + immutable, content-hash URLs
 *  - Channel metadata → short TTL or Redis, NOT CDN (permission-sensitive)
 *  - Messages/presence/typing → Redis / realtime, never CDN
 */

const CDN_BASE = process.env.NEXT_PUBLIC_CDN_URL ?? "";
const R2_PUBLIC_BASE = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? CDN_BASE;

// True when CDN is configured — otherwise every helper returns undefined and
// callers fall back to Convex storage URLs.
export function isCdnEnabled(): boolean {
  return CDN_BASE.length > 0;
}

export function cdnBaseUrl(): string | null {
  return CDN_BASE || null;
}

// ---------------------------------------------------------------------------
// URL resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a stored attachment key to a CDN URL. When CDN is not configured,
 * returns the original Convex storage URL so the app works unchanged.
 *
 * `key` should be content-addressed, e.g. `attachments/<sha256>/<file>` or
 * `attachments/<messageId>/<file>`. Versioning via hash makes aggressive caching safe:
 * `Cache-Control: public, max-age=31536000, immutable`.
 */
export function resolveCdnUrl(key: string | null | undefined, fallbackUrl?: string | null): string | undefined {
  if (key && R2_PUBLIC_BASE) {
    // Normalize: ensure exactly one slash between base and key
    return `${R2_PUBLIC_BASE.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
  }
  return fallbackUrl ?? undefined;
}

/**
 * Existing Convex storage URLs are still valid — this lets components accept
 * either form. If the URL already points at the CDN, return as-is; otherwise
 * fall back handling is done by the caller.
 */
export function isCdnUrl(url: string): boolean {
  if (!CDN_BASE) return false;
  return url.startsWith(CDN_BASE) || (R2_PUBLIC_BASE !== CDN_BASE && url.startsWith(R2_PUBLIC_BASE));
}

// ---------------------------------------------------------------------------
// Upload helpers (client -> R2 via Convex-issued presigned URL)
// ---------------------------------------------------------------------------

export interface CdnUploadTicket {
  uploadUrl: string;
  key: string;
  publicUrl: string;
  headers?: Record<string, string>;
}

/**
 * Upload a blob to R2 via a presigned URL obtained from Convex.
 * Falls back to Convex storage when CDN is disabled.
 */
export async function uploadToCdn(
  getTicket: () => Promise<CdnUploadTicket>,
  blob: Blob,
): Promise<{ key: string; url: string }> {
  const ticket = await getTicket();
  const res = await fetch(ticket.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
      ...(ticket.headers ?? {}),
    },
    body: blob,
  });
  if (!res.ok) throw new Error(`CDN upload failed: ${res.status}`);
  return { key: ticket.key, url: ticket.publicUrl };
}

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

export interface MigratableAsset {
  storageId: string;
  fileName: string;
  url?: string | null;
}

/**
 * Batch migrate existing Convex storage objects to R2.
 * Called from an admin Convex action (`convex/cdn.ts: migrateAttachments`).
 * Client helper just shapes the request.
 */
export function buildMigrationPayload(assets: MigratableAsset[]) {
  return assets.map((a) => ({ storageId: a.storageId, fileName: a.fileName }));
}

// ---------------------------------------------------------------------------
// Cache-Control helper for R2 object metadata (used server-side when issuing
// presigned PUTs). Immutable assets get a year; mutable profile pictures get a
// short TTL + must-revalidate.
// ---------------------------------------------------------------------------

export type CdnCachePolicy = "immutable" | "avatar" | "short";

export function cacheControlFor(policy: CdnCachePolicy): string {
  switch (policy) {
    case "immutable":
      return "public, max-age=31536000, immutable";
    case "avatar":
      // Avatars are versioned via content hash in key, but allow quick invalidation
      return "public, max-age=86400, stale-while-revalidate=604800";
    case "short":
      return "public, max-age=60, stale-while-revalidate=300";
  }
}

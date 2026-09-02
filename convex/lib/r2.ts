/**
 * R2 helpers for asset mutations (banners, decorations, effects, frames,
 * community banners, chat backgrounds, emoji, etc.).
 *
 * When R2 env is set, uploads go to R2 and imageUrl stores the CDN public URL.
 * When not set, fallback to Convex storage.
 */

export function isR2Enabled(): boolean {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_BUCKET && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
}

export function r2PublicUrlForKey(key: string): string {
  const base = process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "";
  if (!base) return "";
  return `${base.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
}

function r2KeyFromUrl(url: string | null | undefined): string | null {
  const base = process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "";
  if (!url || !base) return null;
  const prefix = base.replace(/\/$/, "") + "/";
  if (url.startsWith(prefix)) return url.slice(prefix.length);
  // Also handle migrated/ prefix directly
  if (url.includes("/migrated/")) {
    const idx = url.indexOf("/migrated/");
    return url.slice(idx + 1);
  }
  return null;
}

/**
 * Delete an R2 object by key or by public URL. No-op if R2 not configured or key null.
 * Called when an asset is replaced or removed — mirrors ctx.storage.delete for Convex.
 */
export async function r2DeleteByKey(key: string | null | undefined): Promise<void> {
  if (!key || !isR2Enabled()) return;
  const accountId = process.env.R2_ACCOUNT_ID!;
  const bucket = process.env.R2_BUCKET!;
  const accessKey = process.env.R2_ACCESS_KEY_ID!;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY!;
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`;
  try {
    const { AwsClient } = await import("aws4fetch");
    const client = new AwsClient({ accessKeyId: accessKey, secretAccessKey: secretKey, service: "s3", region: "auto" });
    await client.fetch(endpoint, { method: "DELETE" });
  } catch {
    // deletion is best-effort
  }
}

export async function r2DeleteByUrl(url: string | null | undefined): Promise<void> {
  const key = r2KeyFromUrl(url);
  if (key) await r2DeleteByKey(key);
}

/**
 * Resolve an asset URL for reads: prefer CDN if storageId looks like already-migrated,
 * else fallback to Convex storage URL. For DB-stored URLs (users.imageUrl etc.),
 * just return as-is — they already hold the CDN URL after R2 upload.
 */
export function isR2Url(url: string | null | undefined): boolean {
  if (!url) return false;
  const base = process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "";
  return !!base && url.startsWith(base.replace(/\/$/, "") + "/");
}

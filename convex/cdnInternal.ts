/**
 * Internal helpers for CDN migration — separated so `cdn.ts` (use node) can
 * call them via ctx.runQuery/runAction without circular imports.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";

export const listUnmigratedAttachments = internalQuery({
  args: { limit: v.number(), cursor: v.optional(v.union(v.string(), v.number())) },
  handler: async (ctx, { limit, cursor }) => {
    const cap = Math.min(100, Math.max(1, limit));
    const offset = cursor != null ? parseInt(String(cursor), 10) || 0 : 0;
    const dm = await ctx.db.query("messageAttachments").collect();
    const ch = await ctx.db.query("channelMessageAttachments").collect();
    const combined = [...dm, ...ch];
    // Deduplicate by storageId (same file can be referenced twice)
    const seen = new Set<string>();
    const unique: typeof combined = [];
    for (const r of combined) {
      const id = String(r.storageId);
      if (seen.has(id)) continue;
      seen.add(id);
      unique.push(r);
    }
    const page = unique.slice(offset, offset + cap);
    const nextCursor = offset + cap < unique.length ? String(offset + cap) : null;
    return {
      page: page.map((r) => ({ storageId: r.storageId })),
      isDone: nextCursor === null,
      continueCursor: nextCursor,
      total: unique.length,
    };
  },
});

export const migrateOneInternal = internalAction({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Storage object not found");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch storage ${res.status}`);
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") ?? "application/octet-stream";
    const key = `migrated/${String(storageId)}`;
    const accountId = process.env.R2_ACCOUNT_ID;
    const bucket = process.env.R2_BUCKET;
    const accessKey = process.env.R2_ACCESS_KEY_ID;
    const secretKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !bucket || !accessKey || !secretKey) {
      throw new Error("R2 not configured — set R2_ACCOUNT_ID/R2_BUCKET/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY");
    }
    const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`;
    const { AwsClient } = await import("aws4fetch");
    const client = new AwsClient({
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      service: "s3",
      region: "auto",
    });
    const put = await client.fetch(endpoint, {
      method: "PUT",
      body: buf as unknown as BodyInit,
      headers: {
        "Content-Type": ct,
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
    if (!put.ok) {
      const text = await put.text().catch(() => "");
      throw new Error(`R2 PUT ${put.status} ${text.slice(0, 500)}`);
    }
    const base = process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "";
    const publicUrl = base ? `${base.replace(/\/$/, "")}/${key}` : endpoint;
    return { key, publicUrl };
  },
});

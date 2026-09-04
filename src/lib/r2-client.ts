"use client";
import { api } from "../../convex/_generated/api";
import type { ConvexReactClient } from "convex/react";

async function hashOf(file: File): Promise<string> {
  try {
    const buf = await file.arrayBuffer();
    const h = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  } catch {
    return `${Date.now()}`;
  }
}

/**
 * Try to upload via R2 (Cloudflare). Supports structured paths:
 *  attachments/<channelOrUserId>/<name>.<ext>
 *  avatars/<userId>/<hash>.webp, avatar-decorations/<userId>/<hash>.webp, avatar-frames/<userId>/<hash>.webp
 *  icons/<communityId>/<hash>.webp, banners/<communityOrUserId>/<hash>.webp, nameplates/<userId>/<hash>.webp
 * Falls back to null if R2 not configured — caller should use Convex storage.
 */
export async function tryUploadViaR2(
  convex: ConvexReactClient,
  file: File,
  kind: "attachments" | "avatars" | "avatar-decorations" | "avatar-frames" | "icons" | "banners" | "nameplates" | "backgrounds" | "emoji" | "sounds",
  opts?: { ownerId?: string; communityId?: string; layerId?: string }
): Promise<{ cdnKey: string; cdnUrl: string } | null> {
  try {
    const hash = await hashOf(file);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
    const ticket = await convex.action(api.cdn.createUploadUrl, {
      kind: (kind === "backgrounds" ? "banners" : kind) as never,
      fileName: file.name || "upload",
      contentType: file.type || "application/octet-stream",
      contentHash: hash,
      ownerId: opts?.ownerId,
      ext,
      layerId: opts?.layerId,
    } as never);
    if ((ticket as { mode?: string }).mode === "convex" || !(ticket as { uploadUrl?: string }).uploadUrl) return null;
    const { uploadUrl, key, publicUrl } = ticket as { uploadUrl: string; key: string; publicUrl: string };
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!res.ok) return null;
    // Record metadata for canvas-editor / server-profile scoping
    try {
      await convex.mutation(api.cdn.confirmUpload, {
        key,
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
        fileSize: file.size,
        kind: (kind === "backgrounds" ? "banners" : kind) as never,
        ownerId: opts?.ownerId,
        communityId: opts?.communityId as never,
        hash,
        ext,
        layerId: opts?.layerId,
      } as never);
    } catch {}
    const cdnUrl = publicUrl || key;
    return { cdnKey: key, cdnUrl };
  } catch {
    return null;
  }
}

export async function uploadViaR2OrConvex(
  convex: ConvexReactClient,
  file: File,
  kind: Parameters<typeof tryUploadViaR2>[2],
  generateConvexUploadUrl: () => Promise<string>
): Promise<{ storageId?: string; cdnKey?: string; cdnUrl?: string }> {
  const r2 = await tryUploadViaR2(convex, file, kind);
  if (r2) return r2;
  // Fallback to Convex storage
  const uploadUrl = await generateConvexUploadUrl();
  const { uploadToStorage } = await import("./storage-upload");
  const storageId = await uploadToStorage(uploadUrl, file);
  return { storageId };
}

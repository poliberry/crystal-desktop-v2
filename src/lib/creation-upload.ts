import type { ConvexReactClient } from "convex/react";

import { api } from "../../convex/_generated/api";

/** What a creator may upload as artwork — mirrors the server's list, which is
 * what actually decides. */
export const CREATION_ACCEPT = "image/png,image/gif,image/webp,image/jpeg,video/webm,video/mp4";
/** The largest single file a creator can upload: one number for Studio's editors, its limits
 * text and this uploader, so a file the editor accepts is a file that can be sent. */
export const CREATION_MAX_BYTES = 10 * 1024 * 1024;
/** `10 MB`, for copy and messages. */
export const CREATION_MAX_LABEL = `${CREATION_MAX_BYTES / 1024 / 1024} MB`;

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/**
 * Put a creator's artwork on the CDN and return where it lives.
 *
 * Unlike the profile uploads there is no fall-back to Convex storage: artwork
 * that other people wear has to be at a stable public address, and a missing
 * CDN is a reason to stop and say so rather than to quietly store it somewhere
 * it would not work.
 */
export async function uploadCreation(convex: ConvexReactClient, file: File): Promise<string> {
  if (file.size > CREATION_MAX_BYTES) throw new Error(`That file is over ${CREATION_MAX_LABEL}.`);
  const ticket = (await convex.action(api.cdn.createUploadUrl, {
    kind: "creations",
    fileName: file.name || "artwork",
    contentType: file.type || "application/octet-stream",
    contentHash: await sha256(file),
    ext: file.name.split(".").pop()?.toLowerCase(),
  })) as { mode: "r2" | "convex"; uploadUrl: string; publicUrl?: string };

  if (ticket.mode !== "r2" || !ticket.publicUrl) throw new Error("Creator uploads need the CDN, which isn't set up.");
  const response = await fetch(ticket.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!response.ok) throw new Error("The upload failed. Try again.");
  return ticket.publicUrl;
}

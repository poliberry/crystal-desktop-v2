import { v } from "convex/values";

import { action } from "./_generated/server";
import { normalizeMotionSpec, type MotionSpec } from "./lib/motion";
import { canonicalJson, MAX_MOTION_BYTES, MOTION_FOLDER } from "./lib/motionAddress";
import { creationArtworkUrl, isR2Enabled, r2PublicUrlForKey } from "./lib/r2";

/**
 * Where animated profile effects and nameplates are made public.
 *
 * A motion design is a small JSON file the app fetches and plays. It is written here, by the server, and
 * never uploaded by the creator's own browser: the server checks the design (`normalizeMotionSpec` — every
 * picture on the CDN in the creator's own folder, every number clamped, no code), writes *the checked copy*,
 * and names the file after the hash of its contents. So the file at a published address is exactly what was
 * checked, can never be swapped for something else afterwards, and the same design is the same address.
 *
 * It goes in `marketplace/motion/`: shared by everyone who owns it and never deleted by the clean-up paths
 * (see `PROTECTED_PREFIX`), like the rest of a creator's artwork.
 */

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Check a motion design and publish it, returning where it now lives. Idempotent: publishing the same design
 * again writes the same file to the same address.
 */
export const publish = action({
  args: { spec: v.any() },
  handler: async (ctx, { spec }): Promise<{ url: string; bytes: number; spec: MotionSpec }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    if (!isR2Enabled()) throw new Error("Creator uploads need the CDN, which isn't set up here.");

    // Pictures go through the same check as every other creator upload: ours, and in this creator's own folder.
    const checked = normalizeMotionSpec(spec, (url) => creationArtworkUrl(url, identity.subject));
    const text = canonicalJson(checked);
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > MAX_MOTION_BYTES) throw new Error(`That design is too large (${Math.ceil(bytes / 1024)} KB; the limit is ${MAX_MOTION_BYTES / 1024} KB). Use fewer clips or keyframes.`);

    const key = `${MOTION_FOLDER}${await sha256Hex(text)}.json`;
    const accountId = process.env.R2_ACCOUNT_ID!;
    const bucket = process.env.R2_BUCKET!;
    const { AwsClient } = await import("aws4fetch");
    const client = new AwsClient({ accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!, service: "s3", region: "auto" });
    const put = await client.fetch(`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`, {
      method: "PUT",
      body: text,
      headers: {
        "Content-Type": "application/json",
        // The name is the hash of the contents, so it can be cached for ever.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
    if (!put.ok) throw new Error("Couldn't publish the design. Try again.");
    return { url: r2PublicUrlForKey(key), bytes, spec: checked };
  },
});

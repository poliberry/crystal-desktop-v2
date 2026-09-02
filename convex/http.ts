import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { registerRoutes } from "@convex-dev/stripe";
import { components } from "./_generated/api";

// --- CDN: Cloudflare R2 proxy + cache headers ---
// When R2 env is set, uploads go straight to R2 via this proxy so the client
// never sees secrets and we can set Cache-Control centrally. When not set,
// this route is inert and Convex storage is used instead.

const http = httpRouter();

// See convex/lib/liveKitWebhook.ts. Point your LiveKit project's webhook URL
// at `<this deployment's .convex.site URL>/livekit/webhook`. Signature
// verification (and all node-only work) happens in that "use node" action —
// this route just forwards the raw body/header, since http.ts itself runs
// in the default (non-node) runtime.
http.route({
  path: "/livekit/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();
    const authorization = request.headers.get("Authorization") ?? "";
    await ctx.runAction(internal.lib.liveKitWebhook.handle, { body, authorization });
    return new Response(null, { status: 200 });
  }),
});

registerRoutes(http, components.stripe, {
  webhookPath: "/stripe/webhook",
  apiVersion: "2026-04-22.dahlia", // Optional
});

// R2 upload proxy: client PUTs bytes here; we forward to R2 with service credentials
// and return the public CDN URL. Keeps secrets server-side and lets us set
// long immutable cache headers for attachments.
http.route({
  path: "/r2/upload",
  method: "PUT",
  handler: httpAction(async (_ctx, request) => {
    const accountId = process.env.R2_ACCOUNT_ID;
    const bucket = process.env.R2_BUCKET;
    const accessKey = process.env.R2_ACCESS_KEY_ID;
    const secretKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !bucket || !accessKey || !secretKey) {
      return new Response("R2 not configured", { status: 501 });
    }
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (!key) return new Response("Missing key", { status: 400 });
    const contentType = url.searchParams.get("contentType") ?? request.headers.get("content-type") ?? "application/octet-stream";
    const body = await request.arrayBuffer();

    try {
      const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`;
      const headers: Record<string, string> = {
        "Content-Type": contentType,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
      };
      const { AwsClient } = await import("aws4fetch");
      const client = new AwsClient({
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
        service: "s3",
        region: "auto",
      });
      const r = await client.fetch(endpoint, {
        method: "PUT",
        body: body as unknown as BodyInit,
        headers,
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        console.error(`R2 PUT failed ${r.status} ${text.slice(0, 500)} for ${key}`);
        return new Response(`R2 PUT failed: ${r.status} ${text.slice(0, 200)}`, { status: 502 });
      }
      const base = process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "";
      const publicUrl = base ? `${base.replace(/\/$/, "")}/${key}` : endpoint;
      return new Response(JSON.stringify({ key, publicUrl }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=31536000, immutable" },
      });
    } catch (e) {
      console.error("R2 proxy error", String(e));
      return new Response(`R2 proxy error: ${String(e)}`, { status: 500 });
    }
  }),
});

http.route({
  path: "/r2/upload",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Cache-Control",
      },
    });
  }),
});

export default http;

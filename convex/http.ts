import { verifyUploadTicket } from "./lib/uploadTicket";
import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

// --- CDN: Cloudflare R2 proxy + cache headers ---
// When R2 env is set, uploads go straight to R2 via this proxy so the client
// never sees secrets and we can set Cache-Control centrally. When not set,
// this route is inert and Convex storage is used instead.

const http = httpRouter();

// The Bot API. One prefix route: botHttp.ts authenticates and dispatches, and botApi.ts decides
// what a bot may do. Only the methods it uses are registered.
import { handle as botApiHandler } from "./botHttp";
for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
  http.route({ pathPrefix: "/bot/v1/", method, handler: botApiHandler });
}

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

// Twitch, YouTube and TikTok send a person back here after they have said yes (or
// no) to connecting their account. Everything that matters happens in
// `connectedAccounts.complete`: the signed `state` says who started it, and the
// code is exchanged server-side with the app's own secret. This route only
// forwards the two parameters and sends the browser on to a page that says how
// it went.
for (const provider of ["twitch", "youtube", "tiktok"] as const) {
  http.route({
    path: `/oauth/callback/${provider}`,
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      const url = new URL(request.url);
      const app = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://usecrystal.app").replace(/\/$/, "");
      const back = (params: Record<string, string>) =>
        Response.redirect(`${app}/oauth-return/?${new URLSearchParams({ provider, ...params })}`, 302);

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (url.searchParams.get("error") || !code || !state) {
        return back({ status: "error", message: "The connection was cancelled." });
      }
      const result = await ctx.runAction(internal.connectedAccounts.complete, { provider, code, state });
      return result.ok ? back({ status: "ok" }) : back({ status: "error", message: result.message ?? "Couldn't connect that account." });
    }),
  });
}

// Stripe calls this with payment events. Point the endpoint at
// `<this deployment's .convex.site URL>/stripe/webhook`. Like LiveKit's, the raw
// body and signature are handed to a "use node" action (convex/payments.ts) that
// verifies them before reading anything — this route trusts nothing itself.
//
// 400 for a request that isn't validly signed (Stripe should not retry that) and
// 500 for one that was valid but couldn't be handled (it should).
http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const signature = request.headers.get("stripe-signature");
    if (!signature) return new Response("Missing signature", { status: 400 });
    const payload = await request.text();
    try {
      await ctx.runAction(internal.payments.handleWebhook, { payload, signature });
      return new Response(null, { status: 200 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const unsigned = /signature|timestamp|payload/i.test(message);
      console.error("Stripe webhook failed:", message);
      return new Response(unsigned ? "Invalid signature" : "Webhook handling failed", {
        status: unsigned ? 400 : 500,
      });
    }
  }),
});

// R2 upload proxy: client PUTs bytes here; we forward to R2 with service credentials
// and return the public CDN URL. Keeps secrets server-side and lets us set
// long immutable cache headers for attachments.
const MAX_PROXY_UPLOAD_BYTES = 30 * 1024 * 1024;

const R2_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Cache-Control, Content-Length, Authorization, X-Requested-With",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

http.route({
  path: "/r2/upload",
  method: "PUT",
  handler: httpAction(async (_ctx, request) => {
    const accountId = process.env.R2_ACCOUNT_ID;
    const bucket = process.env.R2_BUCKET;
    const accessKey = process.env.R2_ACCESS_KEY_ID;
    const secretKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !bucket || !accessKey || !secretKey) {
      return new Response("R2 not configured", { status: 501, headers: R2_CORS_HEADERS });
    }
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (!key) return new Response("Missing key", { status: 400, headers: R2_CORS_HEADERS });
    const contentType = url.searchParams.get("contentType") ?? request.headers.get("content-type") ?? "application/octet-stream";
    // Only to a ticket `cdn.createUploadUrl` issued for exactly this key and
    // content type — see convex/lib/uploadTicket.ts.
    const valid = await verifyUploadTicket(
      secretKey,
      key,
      contentType,
      url.searchParams.get("exp"),
      url.searchParams.get("sig")
    );
    if (!valid) return new Response("Upload ticket missing, expired or invalid", { status: 403, headers: R2_CORS_HEADERS });
    // The largest thing the app uploads is an attachment, capped at 25 MB; the
    // margin is for multipart overhead, and it stops the route being a way to
    // fill the bucket.
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_PROXY_UPLOAD_BYTES) {
      return new Response("Too large", { status: 413, headers: R2_CORS_HEADERS });
    }
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_PROXY_UPLOAD_BYTES) {
      return new Response("Too large", { status: 413, headers: R2_CORS_HEADERS });
    }

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
        return new Response(`R2 PUT failed: ${r.status} ${text.slice(0, 200)}`, { status: 502, headers: R2_CORS_HEADERS });
      }
      const base = process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "";
      const publicUrl = base ? `${base.replace(/\/$/, "")}/${key}` : endpoint;
      return new Response(JSON.stringify({ key, publicUrl }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=31536000, immutable", ...R2_CORS_HEADERS },
      });
    } catch (e) {
      console.error("R2 proxy error", String(e));
      return new Response(`R2 proxy error: ${String(e)}`, { status: 500, headers: R2_CORS_HEADERS });
    }
  }),
});

http.route({
  path: "/r2/upload",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      headers: R2_CORS_HEADERS,
    });
  }),
});

export default http;

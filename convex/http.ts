import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { registerRoutes } from "@convex-dev/stripe";
import { components } from "./_generated/api";

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

export default http;

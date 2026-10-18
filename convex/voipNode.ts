"use node";

import { createPrivateKey, sign } from "node:crypto";
import { connect, constants, type ClientHttp2Session } from "node:http2";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

/**
 * Rings iPhones through CallKit: a VoIP (PushKit) push straight to APNs, which
 * wakes the mobile app — even when it isn't running — so it can show the
 * system incoming-call screen (crystal-mobile `modules/crystal-call`).
 *
 * Node runtime because APNs only speaks HTTP/2 and the token is an ES256 JWT.
 * Needs these deployment environment variables (nothing is sent without them,
 * and devices then get the ordinary Expo push instead — see push.ts):
 *
 *   APNS_KEY_ID        the key's ID (Apple Developer → Keys, with APNs enabled)
 *   APNS_PRIVATE_KEY   the .p8 file's contents (PEM; literal "\n"s are fine)
 *   APNS_TEAM_ID       defaults to the app's team, 5XRJTTANUT
 *   APNS_BUNDLE_ID     defaults to com.crystal.mobile
 */

const HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
} as const;

/** How long APNs keeps trying a ring (server `RING_TIMEOUT_MS` is 45s). */
const RING_TTL_SECONDS = 40;

let cachedJwt: { token: string; at: number; keyId: string } | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** APNs provider token. Apple wants it reused for 20–60 minutes, not minted per push. */
function providerToken(keyId: string, teamId: string, pem: string): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.keyId === keyId && now - cachedJwt.at < 40 * 60) return cachedJwt.token;
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: now }));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), {
    key: createPrivateKey(pem),
    dsaEncoding: "ieee-p1363",
  });
  const token = `${header}.${claims}.${base64url(signature)}`;
  cachedJwt = { token, at: now, keyId };
  return token;
}

function post(
  session: ClientHttp2Session,
  path: string,
  headers: Record<string, string | number>,
  body: string,
): Promise<{ status: number; reason?: string }> {
  return new Promise((resolve) => {
    const request = session.request({
      [constants.HTTP2_HEADER_METHOD]: "POST",
      [constants.HTTP2_HEADER_PATH]: path,
      ...headers,
    });
    let status = 0;
    let data = "";
    request.setEncoding("utf8");
    request.on("response", (h) => {
      status = Number(h[constants.HTTP2_HEADER_STATUS] ?? 0);
    });
    request.on("data", (chunk: string) => {
      data += chunk;
    });
    request.on("end", () => {
      let reason: string | undefined;
      try {
        reason = data ? (JSON.parse(data) as { reason?: string }).reason : undefined;
      } catch {
        /* not JSON */
      }
      resolve({ status, reason });
    });
    request.on("error", (err) => resolve({ status: 0, reason: String(err) }));
    request.setTimeout(10_000, () => {
      request.close();
      resolve({ status: 0, reason: "timeout" });
    });
    request.end(body);
  });
}

export const sendCallRing = internalAction({
  args: {
    userId: v.id("users"),
    conversationId: v.id("conversations"),
    /** What the incoming-call screen shows: the caller (1:1) or the group's name. */
    title: v.string(),
    callerName: v.optional(v.string()),
    isGroup: v.boolean(),
    hasVideo: v.optional(v.boolean()),
  },
  handler: async (ctx, { userId, conversationId, title, callerName, isGroup, hasVideo }) => {
    const keyId = process.env.APNS_KEY_ID;
    const rawKey = process.env.APNS_PRIVATE_KEY;
    if (!keyId || !rawKey) return;
    const teamId = process.env.APNS_TEAM_ID ?? "5XRJTTANUT";
    const topic = `${process.env.APNS_BUNDLE_ID ?? "com.crystal.mobile"}.voip`;
    const pem = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;

    const rows = await ctx.runQuery(internal.push.getVoipTokensForUser, { userId });
    if (rows.length === 0) return;

    let jwt: string;
    try {
      jwt = providerToken(keyId, teamId, pem);
    } catch (err) {
      console.error("APNs key couldn't be used to sign", err);
      return;
    }

    // Only what the phone needs to put up the call screen: no message content.
    const body = JSON.stringify({
      aps: {},
      conversationId,
      title,
      callerName,
      isGroup,
      hasVideo: !!hasVideo,
    });
    const headers = {
      authorization: `bearer ${jwt}`,
      "apns-topic": topic,
      "apns-push-type": "voip",
      "apns-priority": 10,
      "apns-expiration": Math.floor(Date.now() / 1000) + RING_TTL_SECONDS,
      // Collapses a re-ring for the same conversation into one.
      "apns-collapse-id": `ring-${conversationId}`.slice(0, 64),
      "content-type": "application/json",
    };

    for (const environment of ["production", "sandbox"] as const) {
      const targets = rows.filter((row) => row.environment === environment);
      if (targets.length === 0) continue;
      const session = connect(HOSTS[environment]);
      session.on("error", (err) => console.error("APNs connection error", environment, err));
      try {
        const results = await Promise.all(
          targets.map(async (row) => ({ row, result: await post(session, `/3/device/${row.voipToken}`, headers, body) })),
        );
        for (const { row, result } of results) {
          if (result.status === 200) continue;
          // The token no longer works (app removed, or it belongs to the other environment).
          if (result.status === 410 || result.reason === "BadDeviceToken" || result.reason === "Unregistered" || result.reason === "DeviceTokenNotForTopic") {
            await ctx.runMutation(internal.push.removeVoipToken, { voipToken: row.voipToken });
          } else {
            console.error("APNs VoIP push failed", environment, result.status, result.reason);
          }
        }
      } finally {
        session.close();
      }
    }
  },
});

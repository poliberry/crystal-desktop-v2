import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { signedInIds } from "./lib/identity";
import { randomToken, sha256Hex } from "./lib/authPolicy";
import { verifySecondFactorCode } from "./lib/secondFactor";
import { factorSummary } from "./lib/secondFactor";
import { finish } from "./authInternal";
import { allow } from "./lib/rateLimit";
import { sealRequestIp } from "./lib/ipBans";

const TTL = 2 * 60 * 1000;

/** Create independent phone-approval and desktop-poll capabilities. */
export const create = mutation({
  args: {},
  handler: async (ctx) => {
    const sealed = await sealRequestIp((await ctx.meta.getRequestMetadata()).ip);
    if (sealed && !(await allow(ctx, `qr-login:ip:${sealed.ipHash}`, 10, 15 * 60 * 1000))) {
      throw new Error("Too many phone sign-in requests. Try again later.");
    }
    const request = randomToken();
    const poll = randomToken();
    const expiresAt = Date.now() + TTL;
    await ctx.db.insert("qrLoginRequests", {
      requestHash: await sha256Hex(request), pollHash: await sha256Hex(poll),
      expiresAt, attempts: 0, status: "pending",
    });
    return { request, poll, expiresAt };
  },
});

/** Phone approval always consumes an enrolled second factor before a login ticket can exist. */
export const approve = mutation({
  args: { request: v.string(), code: v.string() },
  handler: async (ctx, { request, code }) => {
    const ids = await signedInIds(ctx);
    if (!ids) return { ok: false as const, message: "Sign in on your phone first." };
    const requestHash = await sha256Hex(request);
    const row = await ctx.db.query("qrLoginRequests").withIndex("by_request", q => q.eq("requestHash", requestHash)).unique();
    if (!row || row.status !== "pending" || row.expiresAt <= Date.now()) return { ok: false as const, message: "This QR request has expired. Start again on your computer." };
    if (row.attempts >= 5) return { ok: false as const, message: "Too many tries. Start a new QR request." };
    const factors = await factorSummary(ctx, ids.userId);
    if (!factors.totp && !factors.backupCodes) return { ok: false as const, message: "Set up an authenticator or backup codes before approving a login." };
    const verified = await verifySecondFactorCode(ctx, ids.userId, code);
    if (!verified.ok) {
      await ctx.db.patch(row._id, { attempts: row.attempts + 1 });
      return { ok: false as const, message: verified.reason === "locked" ? "Too many codes. Try again later." : "That code didn't work." };
    }
    const user = await ctx.db.get(ids.userId);
    if (!user) return { ok: false as const, message: "Account unavailable." };
    await ctx.db.patch(row._id, { status: "approved", userId: ids.userId });
    return { ok: true as const };
  },
});

/** Polling requires the desktop-only capability. The QR request secret alone cannot read a ticket. */
export const poll = mutation({
  args: { poll: v.string(), pulse: v.number() },
  handler: async (ctx, { poll, pulse }) => {
    void pulse;
    const pollHash = await sha256Hex(poll);
    const row = await ctx.db.query("qrLoginRequests").withIndex("by_poll", q => q.eq("pollHash", pollHash)).unique();
    if (!row) return { status: "expired" as const };
    if (row.expiresAt <= Date.now()) {
      if (row.status === "pending" || row.status === "approved") await ctx.db.patch(row._id, { status: "denied" });
      return { status: "expired" as const };
    }
    if (row.status === "pending") return { status: "pending" as const };
    if (row.status === "denied" || row.status === "consumed") return { status: "denied" as const };
    const user = row.userId ? await ctx.db.get(row.userId) : null;
    if (!user) {
      await ctx.db.patch(row._id, { status: "denied" });
      return { status: "denied" as const };
    }
    const result = await finish(ctx, user);
    if (result.status !== "signed_in") {
      await ctx.db.patch(row._id, { status: "denied" });
      if (result.status === "blocked") return { status: "blocked" as const, kind: result.kind, reason: result.reason };
      return { status: "denied" as const };
    }
    await ctx.db.patch(row._id, { status: "consumed" });
    return { status: "approved" as const, ticket: result.ticket };
  },
});

/** Stop a pending request when the browser closes the QR prompt. */
export const cancel = mutation({
  args: { poll: v.string() },
  handler: async (ctx, { poll }) => {
    const pollHash = await sha256Hex(poll);
    const row = await ctx.db.query("qrLoginRequests").withIndex("by_poll", q => q.eq("pollHash", pollHash)).unique();
    if (row?.status === "pending") await ctx.db.patch(row._id, { status: "denied" });
    return null;
  },
});

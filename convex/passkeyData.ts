import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { WEBAUTHN_CHALLENGE_TTL_MS } from "./lib/authPolicy";
import { signedInIds } from "./lib/identity";
import { factorSummary, replaceBackupCodes } from "./lib/secondFactor";
import { grantStepUp, requireFreshVerification } from "./lib/stepUp";

/**
 * The database side of convex/passkeys.ts, which runs in Node and can't touch the database
 * itself. None of this is callable from the app.
 */

// --- Challenges -------------------------------------------------------------------------------

export const saveChallenge = internalMutation({
  args: {
    challenge: v.string(),
    kind: v.union(v.literal("register"), v.literal("authenticate")),
    userId: v.optional(v.id("users")),
    rpId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("webauthnChallenges", { ...args, expiresAt: Date.now() + WEBAUTHN_CHALLENGE_TTL_MS });
  },
});

/** Use up a challenge. Single use whether or not it was good, so an answer can't be replayed. */
export const takeChallenge = internalMutation({
  args: { challenge: v.string(), kind: v.union(v.literal("register"), v.literal("authenticate")) },
  handler: async (ctx, { challenge, kind }) => {
    const row = await ctx.db.query("webauthnChallenges").withIndex("by_challenge", (q) => q.eq("challenge", challenge.slice(0, 200))).first();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (row.kind !== kind || row.expiresAt <= Date.now()) return null;
    return { userId: row.userId ?? null, rpId: row.rpId };
  },
});

// --- Credentials ------------------------------------------------------------------------------

export const credentialById = internalQuery({
  args: { credentialId: v.string() },
  handler: async (ctx, { credentialId }) => {
    const row = await ctx.db.query("passkeys").withIndex("by_credential_id", (q) => q.eq("credentialId", credentialId.slice(0, 1024))).unique();
    return row
      ? {
          id: row._id,
          userId: row.userId,
          credentialId: row.credentialId,
          publicKey: row.publicKey,
          counter: row.counter,
          transports: row.transports,
          rpId: row.rpId,
        }
      : null;
  },
});

export const credentialsOf = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db.query("passkeys").withIndex("by_user", (q) => q.eq("userId", userId)).take(50);
    return rows.map((r) => ({ id: r.credentialId, transports: r.transports }));
  },
});

export const recordUse = internalMutation({
  args: { id: v.id("passkeys"), counter: v.number(), backedUp: v.boolean() },
  handler: async (ctx, { id, counter, backedUp }) => {
    await ctx.db.patch(id, { counter, backedUp, lastUsedAt: Date.now() });
  },
});

// --- Registering (signed in) -------------------------------------------------------------------

/**
 * Who is registering, and what they already have. Refuses unless the session has just proved it
 * is the owner at the keyboard (see `requireFreshVerification`): a stolen session can't add its
 * own passkey and lock the real owner out.
 */
export const registrationInfo = internalQuery({
  args: {},
  handler: async (ctx) => {
    const ids = await signedInIds(ctx);
    if (!ids) throw new Error("Not signed in.");
    await requireFreshVerification(ctx, ids.userId);
    const user = await ctx.db.get(ids.userId);
    if (!user) throw new Error("Not signed in.");
    const existing = await ctx.db.query("passkeys").withIndex("by_user", (q) => q.eq("userId", ids.userId)).take(50);
    return {
      userId: ids.userId,
      username: user.username,
      name: user.name,
      existing: existing.map((p) => ({ id: p.credentialId, transports: p.transports })),
    };
  },
});

const MAX_PASSKEYS = 10;

export const addPasskey = internalMutation({
  args: {
    credentialId: v.string(),
    publicKey: v.string(),
    counter: v.number(),
    transports: v.optional(v.array(v.string())),
    deviceType: v.string(),
    backedUp: v.boolean(),
    name: v.string(),
    rpId: v.string(),
  },
  handler: async (ctx, args): Promise<{ backupCodes: string[] | null }> => {
    const ids = await signedInIds(ctx);
    if (!ids) throw new Error("Not signed in.");
    await requireFreshVerification(ctx, ids.userId);

    const before = await factorSummary(ctx, ids.userId);
    if (before.passkeys >= MAX_PASSKEYS) throw new Error(`You can have up to ${MAX_PASSKEYS} passkeys. Remove one first.`);
    const clash = await ctx.db.query("passkeys").withIndex("by_credential_id", (q) => q.eq("credentialId", args.credentialId)).first();
    if (clash) throw new Error("That passkey is already registered.");

    await ctx.db.insert("passkeys", {
      userId: ids.userId,
      ...args,
      name: args.name.trim().slice(0, 40) || "Passkey",
      createdAt: Date.now(),
    });
    // The account has just gained its first real factor: it needs a way back in for when that's lost.
    const backupCodes = before.enrolled || before.backupCodes > 0 ? null : await replaceBackupCodes(ctx, ids.userId);
    // They've just used the thing that proves them; the next admin function shouldn't ask again.
    await grantStepUp(ctx, ids.userId, ids.sessionId, "passkey");
    return { backupCodes };
  },
});

// --- Proving it's still you (signed in) ----------------------------------------------------------

export const grantPasskeyStepUp = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<number> => {
    const ids = await signedInIds(ctx);
    // The passkey that signed the challenge has to be the signed-in account's own.
    if (!ids || ids.userId !== userId) throw new Error("That passkey isn't on this account.");
    return grantStepUp(ctx, ids.userId, ids.sessionId, "passkey");
  },
});

export const myUserId = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"users"> | null> => (await signedInIds(ctx))?.userId ?? null,
});

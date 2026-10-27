import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { signedInIds } from "./lib/identity";
import { clearFailures, lockedUntil, recordFailure } from "./lib/rateLimit";
import { revokeSessions } from "./lib/sessions";
import { decryptSecret, encryptSecret } from "./lib/secrets";
import {
  dropBackupCodesIfUnenrolled,
  factorSummary,
  replaceBackupCodes,
  verifySecondFactorCode,
} from "./lib/secondFactor";
import { getStaff } from "./lib/staff";
import {
  grantStepUp,
  platformSecurity,
  requireFreshVerification,
  stepUpState,
} from "./lib/stepUp";
import { generateTotpSecret, totpUri, verifyTotp } from "./lib/twoFactor";
import { getCurrentUserOrNull } from "./users";

/**
 * Settings → Security: setting up, using and removing the second steps on your own account.
 *
 * Everything here is about the signed-in account and takes no account id: you can't be handed
 * somebody else's. Changing what protects an account (adding or removing a factor, regenerating
 * the backup codes) needs a fresh proof first — a code if the account has a second step, the
 * password if it has none — so a stolen session token alone can't lock the real owner out.
 *
 * Passkeys are registered in convex/passkeys.ts (they need Node); removing and renaming them is
 * here.
 */

const ISSUER = "Crystal";

async function me(ctx: MutationCtx) {
  const ids = await signedInIds(ctx);
  if (!ids) throw new Error("Not signed in.");
  const user = await ctx.db.get(ids.userId);
  if (!user) throw new Error("Not signed in.");
  return { ...ids, user };
}

/**
 * Whether this account may lose its last second step. Staff can't while the platform requires it
 * of them, and the owner of a server that requires it can't while they own it — removing it would
 * lock them out of the thing they are responsible for, and defeat the rule.
 */
async function guardLastFactor(ctx: MutationCtx, userId: Id<"users">): Promise<void> {
  const staff = await ctx.db.query("staffMembers").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
  if (staff && staff.revokedAt === undefined && (await platformSecurity(ctx)).requireStaffTwoFactor) {
    throw new Error("Crystal requires two-step verification for staff, so you can't remove your last one.");
  }
  const owned = await ctx.db.query("communities").withIndex("by_owner", (q) => q.eq("ownerId", userId)).take(200);
  const strict = owned.find((c) => c.requireTwoFactor === true);
  if (strict) {
    throw new Error(`“${strict.name}” requires two-step verification from its admins. Turn that off first, or hand the server over.`);
  }
}

// --- What the settings page shows ----------------------------------------------------------------

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) return null;
    const [factors, address, password, passkeys, state, staff, platform] = await Promise.all([
      factorSummary(ctx, user._id),
      ctx.db.query("userEmails").withIndex("by_user", (q) => q.eq("userId", user._id)).first(),
      ctx.db.query("authCredentials").withIndex("by_user", (q) => q.eq("userId", user._id)).unique(),
      ctx.db.query("passkeys").withIndex("by_user", (q) => q.eq("userId", user._id)).take(50),
      stepUpState(ctx, user._id),
      getStaff(ctx),
      platformSecurity(ctx),
    ]);
    return {
      email: address?.email ?? null,
      emailVerified: address?.verifiedAt !== undefined,
      hasPassword: !!password,
      totp: factors.totp,
      passkeys: passkeys.map((p) => ({
        id: p._id,
        name: p.name,
        createdAt: p.createdAt,
        lastUsedAt: p.lastUsedAt ?? null,
        backedUp: p.backedUp,
      })),
      backupCodesLeft: factors.backupCodes,
      enrolled: factors.enrolled,
      /** Until when this session's second step is good for administrative functions, if it is. */
      unlockedUntil: state.unlockedUntil,
      isStaff: !!staff,
      staffMustEnrol: !!staff && platform.requireStaffTwoFactor,
    };
  },
});

/**
 * What a screen that holds administrative functions needs to know to decide between showing them,
 * asking for a code, and sending the person to turn two-step verification on. Never throws.
 */
export const gate = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) return null;
    const [state, platform, factors] = await Promise.all([stepUpState(ctx, user._id), platformSecurity(ctx), factorSummary(ctx, user._id)]);
    return {
      enrolled: state.enrolled,
      unlockedUntil: state.unlockedUntil,
      methods: { totp: factors.totp, passkey: factors.passkeys > 0, backup: factors.backupCodes > 0 },
      staffMustEnrol: platform.requireStaffTwoFactor,
    };
  },
});

// --- Authenticator app -----------------------------------------------------------------------------

/** Start setting up an authenticator: a new secret, shown once as a QR code, not live until a code from it is entered. */
export const beginTotpSetup = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await me(ctx);
    await requireFreshVerification(ctx, userId);
    const account = await ctx.db.query("userEmails").withIndex("by_user", (q) => q.eq("userId", userId)).first();
    const secret = generateTotpSecret();
    const row = await ctx.db.query("userTwoFactor").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    const pendingSecret = await encryptSecret(secret);
    if (row) await ctx.db.patch(row._id, { pendingSecret });
    else await ctx.db.insert("userTwoFactor", { userId, pendingSecret });
    return { secret, uri: totpUri(secret, account?.email ?? userId, ISSUER) };
  },
});

/** Finish setting up an authenticator by entering a code from it. The first factor also brings the backup codes. */
export const confirmTotpSetup = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<{ ok: true; backupCodes: string[] | null } | { ok: false; reason: "invalid" | "locked" | "no_setup" }> => {
    const { userId, sessionId } = await me(ctx);
    await requireFreshVerification(ctx, userId);
    const row = await ctx.db.query("userTwoFactor").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (!row?.pendingSecret) return { ok: false, reason: "no_setup" };

    // The same limit on guessing as everywhere else a code is asked for.
    if (await lockedUntil(ctx, `2sv:${userId}`)) return { ok: false, reason: "locked" };
    const step = await verifyTotp(await decryptSecret(row.pendingSecret), code, Date.now());
    if (step === null) {
      await recordFailure(ctx, `2sv:${userId}`);
      return { ok: false, reason: "invalid" };
    }
    await clearFailures(ctx, `2sv:${userId}`);

    const before = await factorSummary(ctx, userId);
    await ctx.db.patch(row._id, { secret: row.pendingSecret, pendingSecret: undefined, enabledAt: Date.now(), lastStep: step });
    const backupCodes = before.enrolled || before.backupCodes > 0 ? null : await replaceBackupCodes(ctx, userId);
    // They've just entered a code: don't ask again for the next few minutes.
    await grantStepUp(ctx, userId, sessionId, "totp");
    return { ok: true, backupCodes };
  },
});

export const disableTotp = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await me(ctx);
    await requireFreshVerification(ctx, userId);
    const row = await ctx.db.query("userTwoFactor").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (!row) return;
    const before = await factorSummary(ctx, userId);
    if (before.passkeys === 0) await guardLastFactor(ctx, userId);
    await ctx.db.delete(row._id);
    await dropBackupCodesIfUnenrolled(ctx, userId);
  },
});

// --- Backup codes ------------------------------------------------------------------------------------

/** Replace the backup codes with a fresh set. The old ones stop working. Shown once. */
export const regenerateBackupCodes = mutation({
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const { userId } = await me(ctx);
    await requireFreshVerification(ctx, userId);
    if (!(await factorSummary(ctx, userId)).enrolled) throw new Error("Turn on two-step verification first.");
    return replaceBackupCodes(ctx, userId);
  },
});

// --- Passkeys ------------------------------------------------------------------------------------------

export const removePasskey = mutation({
  args: { id: v.id("passkeys") },
  handler: async (ctx, { id }) => {
    const { userId } = await me(ctx);
    await requireFreshVerification(ctx, userId);
    const row = await ctx.db.get(id);
    // Somebody else's id looks exactly like one that doesn't exist.
    if (!row || row.userId !== userId) throw new Error("Passkey not found.");
    const before = await factorSummary(ctx, userId);
    if (!before.totp && before.passkeys === 1) await guardLastFactor(ctx, userId);
    await ctx.db.delete(id);
    await dropBackupCodesIfUnenrolled(ctx, userId);
  },
});

export const renamePasskey = mutation({
  args: { id: v.id("passkeys"), name: v.string() },
  handler: async (ctx, { id, name }) => {
    const { userId } = await me(ctx);
    const row = await ctx.db.get(id);
    if (!row || row.userId !== userId) throw new Error("Passkey not found.");
    const clean = name.trim().slice(0, 40);
    if (!clean) throw new Error("Give the passkey a name.");
    await ctx.db.patch(id, { name: clean });
  },
});

// --- Stepping up -----------------------------------------------------------------------------------------

/**
 * Enter a code (from the authenticator, or a backup code) to unlock administrative functions on
 * this session for a few minutes. Passkeys do the same through convex/passkeys.ts.
 */
export const stepUp = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<{ ok: true; until: number } | { ok: false; reason: "invalid" | "locked" | "not_enrolled"; until?: number }> => {
    const { userId, sessionId } = await me(ctx);
    if (!(await factorSummary(ctx, userId)).enrolled) return { ok: false, reason: "not_enrolled" };
    const result = await verifySecondFactorCode(ctx, userId, code);
    if (!result.ok) return result.reason === "locked" ? { ok: false, reason: "locked", until: result.until } : { ok: false, reason: "invalid" };
    return { ok: true, until: await grantStepUp(ctx, userId, sessionId, result.method) };
  },
});

/** Put the unlocked state away early, e.g. on stepping away from the console. */
export const lock = mutation({
  args: {},
  handler: async (ctx) => {
    const { sessionId } = await me(ctx);
    const grants = await ctx.db.query("stepUpGrants").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).collect();
    for (const grant of grants) await ctx.db.delete(grant._id);
  },
});

/** Sign out of every other device. This one stays signed in. */
export const signOutOtherSessions = mutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const { userId, sessionId } = await me(ctx);
    await requireFreshVerification(ctx, userId);
    return revokeSessions(ctx, userId, sessionId);
  },
});

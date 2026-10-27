import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { clearFailures, lockedUntil, recordFailure } from "./rateLimit";
import { decryptSecret } from "./secrets";
import {
  generateBackupCodes,
  hashBackupCode,
  looksLikeBackupCode,
  verifyTotp,
} from "./twoFactor";

/**
 * Which second steps an account has, and checking a code against them.
 *
 * "Two-step verification is on" means at least one real factor — an authenticator app or a
 * passkey. Backup codes are only the way back in when those are lost, so they don't count as
 * enrolment on their own, and they're deleted when the last factor goes.
 */

/** The key that makes stored backup-code hashes useless to somebody who can only read the table. */
export function codeKeyMaterial(): string {
  const key = process.env.AUTH_CODE_SECRET ?? process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!key) throw new Error("Sign-in isn't set up on this deployment (AUTH_CODE_SECRET).");
  return key;
}

export interface FactorSummary {
  totp: boolean;
  passkeys: number;
  backupCodes: number;
  /** At least one real factor: the account is under two-step verification. */
  enrolled: boolean;
}

export async function factorSummary(ctx: QueryCtx, userId: Id<"users">): Promise<FactorSummary> {
  const [totp, passkeys, codes] = await Promise.all([
    ctx.db.query("userTwoFactor").withIndex("by_user", (q) => q.eq("userId", userId)).unique(),
    ctx.db.query("passkeys").withIndex("by_user", (q) => q.eq("userId", userId)).take(50),
    ctx.db.query("twoFactorBackupCodes").withIndex("by_user", (q) => q.eq("userId", userId)).take(50),
  ]);
  const hasTotp = !!totp?.secret && totp.enabledAt !== undefined;
  return {
    totp: hasTotp,
    passkeys: passkeys.length,
    backupCodes: codes.filter((c) => c.usedAt === undefined).length,
    enrolled: hasTotp || passkeys.length > 0,
  };
}

/**
 * Check a code the user typed — a six-digit authenticator code or a backup code — and use it up.
 * Returns which kind it was, or `null` if it isn't valid.
 *
 * A backup code is deleted from play by marking it used; a TOTP code records its time step so the
 * same code can't be replayed. Both happen in the caller's transaction, so two requests carrying
 * the same code can't both succeed.
 */
export async function consumeSecondFactorCode(
  ctx: MutationCtx,
  userId: Id<"users">,
  input: string,
): Promise<"totp" | "backup_code" | null> {
  if (looksLikeBackupCode(input)) {
    const hash = await hashBackupCode(input, codeKeyMaterial());
    const row = await ctx.db
      .query("twoFactorBackupCodes")
      .withIndex("by_hash", (q) => q.eq("userId", userId).eq("codeHash", hash))
      .first();
    if (!row || row.usedAt !== undefined) return null;
    await ctx.db.patch(row._id, { usedAt: Date.now() });
    return "backup_code";
  }

  const factor = await ctx.db.query("userTwoFactor").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
  if (!factor?.secret || factor.enabledAt === undefined) return null;
  const step = await verifyTotp(await decryptSecret(factor.secret), input, Date.now(), factor.lastStep);
  if (step === null) return null;
  await ctx.db.patch(factor._id, { lastStep: step });
  return "totp";
}

export type SecondFactorResult =
  | { ok: true; method: "totp" | "backup_code" }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; until: number };

/**
 * `consumeSecondFactorCode` behind the limit on guessing.
 *
 * Five wrong codes in a quarter of an hour pause guessing for a quarter of an hour, and the one
 * counter covers every place a code is asked for — signing in, stepping up, changing security
 * settings — so changing where the guesses are made doesn't reset it. Returns the outcome rather
 * than throwing, because a thrown error rolls the transaction back and the wrong guess with it.
 */
export async function verifySecondFactorCode(
  ctx: MutationCtx,
  userId: Id<"users">,
  input: string,
): Promise<SecondFactorResult> {
  const key = `2sv:${userId}`;
  const locked = await lockedUntil(ctx, key);
  if (locked) return { ok: false, reason: "locked", until: locked };
  // Anything longer than a backup code is not one: don't hash an arbitrarily large string.
  const method = await consumeSecondFactorCode(ctx, userId, input.slice(0, 32));
  if (!method) {
    await recordFailure(ctx, key);
    const now = await lockedUntil(ctx, key);
    return now ? { ok: false, reason: "locked", until: now } : { ok: false, reason: "invalid" };
  }
  await clearFailures(ctx, key);
  return { ok: true, method };
}

/** Throw away any backup codes the account has and make a fresh set. Returns the plain codes, once. */
export async function replaceBackupCodes(ctx: MutationCtx, userId: Id<"users">): Promise<string[]> {
  const old = await ctx.db.query("twoFactorBackupCodes").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  for (const row of old) await ctx.db.delete(row._id);
  const codes = generateBackupCodes();
  const key = codeKeyMaterial();
  for (const code of codes) {
    await ctx.db.insert("twoFactorBackupCodes", { userId, codeHash: await hashBackupCode(code, key) });
  }
  return codes;
}

/** After a factor is removed: with none left, the backup codes have nothing to back up. */
export async function dropBackupCodesIfUnenrolled(ctx: MutationCtx, userId: Id<"users">): Promise<void> {
  if ((await factorSummary(ctx, userId)).enrolled) return;
  const old = await ctx.db.query("twoFactorBackupCodes").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  for (const row of old) await ctx.db.delete(row._id);
}

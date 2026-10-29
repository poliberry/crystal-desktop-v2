import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, mutation, query } from "./_generated/server";
import {
  DISPLAY_NAME_MAX,
  EMAIL_CODE_TTL_MS,
  isValidEmail,
  normalizeEmail,
  normalizeEmailCode,
  passwordProblem,
  PASSWORD_MAX,
  usernameProblem,
} from "./lib/authPolicy";
import { accountByEmail } from "./lib/accounts";
import { makeGuest } from "./authInternal";
import { sealRequestIp } from "./lib/ipBans";
import { allow } from "./lib/rateLimit";
import { firstNameOf } from "./lib/emailBrand";
import { mailConfigured, sendCodeEmail } from "./lib/mail";
import { hashPassword, verifyPassword } from "./lib/passwordHash";
import type { AddressState, SignInStep } from "./lib/signInStep";

/**
 * Signing in, as the sign-in screen sees it.
 *
 * Every function here is callable by anyone, so each one is built to be asked anything: nothing
 * trusts what the caller says about who they are, wrong guesses are counted against the thing
 * being guessed, and the answers don't say whether an address has an account beyond what the
 * screen needs to choose its next step.
 *
 * None of them makes a session. Each ends in a `SignInStep`, and the only one that starts a session
 * is `{ status: "signed_in", ticket }`, whose ticket the screen hands to the auth library's own
 * `signIn` (see the provider in convex/auth.ts). So there is exactly one way in, and the
 * account's standing (banned, suspended) is checked on the way to it — before any session exists.
 */

/**
 * Where an address stands, so the one sign-in screen can choose what comes next: ask for a password,
 * start choosing one, or start making an account.
 *
 * For an address that has an account it also returns the username, name and avatar, so the screen
 * can say "welcome back" to the right person before asking for anything. That makes this a way to
 * find out whether an address has an account, which is the price of that screen — so it is limited
 * hard per network (and overall), and returns nothing else about the account.
 *
 * A mutation rather than a query so it can count its callers.
 */
export const lookup = mutation({
  args: { email: v.string() },
  handler: async (
    ctx,
    { email },
  ): Promise<
    | { state: AddressState; profile?: undefined }
    | { state: "password" | "setup"; profile: { username: string; name: string; imageUrl?: string } }
    | { state: "throttled" }
  > => {
    const address = normalizeEmail(email);
    if (!isValidEmail(address)) return { state: "invalid_email" };

    const sealed = await sealRequestIp((await ctx.meta.getRequestMetadata()).ip);
    // 20 a quarter of an hour per network is plenty for typos; 2000 an hour overall is a ceiling for a crowd.
    if (sealed && !(await allow(ctx, `lookup:ip:${sealed.ipHash}`, 20, 15 * 60 * 1000))) return { state: "throttled" };
    if (!(await allow(ctx, "lookup:all", 2000, 60 * 60 * 1000))) return { state: "throttled" };
    // And per address, so one person's inbox or profile can't be probed in a loop from many networks.
    if (!(await allow(ctx, `lookup:email:${address}`, 12, 15 * 60 * 1000))) return { state: "throttled" };

    const account = await accountByEmail(ctx, address);
    if (!account) return { state: "signup" };
    const password = await ctx.db.query("authCredentials").withIndex("by_user", (q) => q.eq("userId", account.user._id)).unique();
    const { username, name, imageUrl } = account.user;
    return { state: password ? "password" : "setup", profile: { username, name, imageUrl } };
  },
});

/** Whether a username can be taken, for the sign-up and guest screens to say so as it's typed. */
export const usernameAvailable = query({
  args: { username: v.string() },
  handler: async (ctx, { username }): Promise<{ ok: true } | { ok: false; message: string }> => {
    const handle = username.trim().toLowerCase();
    const problem = usernameProblem(handle);
    if (problem) return { ok: false, message: problem };
    const taken = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", handle)).unique();
    return taken ? { ok: false, message: "That username is taken." } : { ok: true };
  },
});

/** A password the check will always fail, for taking as long on an unknown address as on a known one. */
let timingHash: Promise<string> | undefined;
const dummyHash = () => (timingHash ??= hashPassword(`not-a-real-password-${Math.random()}`));

/** The password step. */
export const signInWithPassword = action({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }): Promise<SignInStep> => {
    const address = normalizeEmail(email);
    const info = isValidEmail(address) ? await ctx.runQuery(internal.authInternal.passwordCheck, { email: address }) : null;
    if (!info) {
      // Do the work anyway: an unknown address shouldn't answer faster than a known one with a wrong password.
      await verifyPassword(password.slice(0, PASSWORD_MAX), await dummyHash());
      return { status: "invalid" };
    }
    if (info.lockedUntil) return { status: "locked", until: info.lockedUntil };
    const correct = await verifyPassword(password.slice(0, PASSWORD_MAX), info.passwordHash);
    return ctx.runMutation(internal.authInternal.passwordResult, { userId: info.userId, correct });
  },
});

/** Email a code to an address, to open an account, set a password on one that has none, or reset a forgotten one. */
export const requestCode = action({
  args: { email: v.string() },
  handler: async (
    ctx,
    { email },
  ): Promise<{ ok: true } | { ok: false; reason: "invalid_email" | "cooldown" | "limit" | "unavailable" }> => {
    const address = normalizeEmail(email);
    if (!isValidEmail(address)) return { ok: false, reason: "invalid_email" };

    const configured = mailConfigured();
    // Without a mail provider a code can only go to the log, and only when that is asked for outright.
    const logInstead = !configured && process.env.AUTH_LOG_CODES === "true";
    if (!configured && !logInstead) return { ok: false, reason: "unavailable" };

    const issued = await ctx.runMutation(internal.authInternal.issueCode, { email: address });
    if (!issued.ok) return { ok: false, reason: issued.reason };

    if (logInstead) {
      console.warn(`[auth] AUTH_LOG_CODES is on: the sign-in code for ${address} is ${issued.code}`);
      return { ok: true };
    }
    const { state } = await ctx.runQuery(internal.authInternal.addressState, { email: address });
    try {
      await sendCodeEmail(address, issued.code, state === "password" ? "reset" : "verify", EMAIL_CODE_TTL_MS / 60_000);
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true };
  },
});

/**
 * The emailed code, entered. If it's right, returns a proof that the address was just proved, which
 * the last step presents instead of the code (see `proveCode`).
 */
export const verifyCode = action({
  args: { email: v.string(), code: v.string() },
  handler: async (ctx, { email, code }): Promise<{ ok: true; proof: string } | { ok: false; message: string }> => {
    const address = normalizeEmail(email);
    if (!isValidEmail(address)) return { ok: false, message: "Enter a valid email address." };
    const proof = await ctx.runMutation(internal.authInternal.proveCode, { email: address, code: normalizeEmailCode(code) });
    return proof ? { ok: true, proof } : { ok: false, message: "That code isn't right, or it has expired." };
  },
});

/**
 * The last step of making an account, or of choosing a password: the proof, the password, and for a
 * new person the username and name they picked.
 *
 * Covers all three reasons to be here: opening an account for an address nobody has used, setting
 * the first password on an account that came over from Clerk (the sign-in screen steers every such
 * person here), and replacing a forgotten one. The account's second step, if it has one, still has
 * to be passed before the password changes.
 */
export const complete = action({
  args: {
    email: v.string(),
    proof: v.string(),
    password: v.string(),
    profile: v.optional(v.object({ username: v.string(), name: v.string() })),
  },
  handler: async (ctx, { email, proof, password, profile }): Promise<SignInStep> => {
    const address = normalizeEmail(email);
    if (!isValidEmail(address)) return { status: "invalid", message: "Enter a valid email address." };
    const problem = passwordProblem(password, address);
    if (problem) return { status: "invalid", message: problem };
    if (profile && profile.name.trim().length > DISPLAY_NAME_MAX) {
      return { status: "invalid", message: `Display names are up to ${DISPLAY_NAME_MAX} characters.` };
    }
    // The proof is checked before the password is hashed, so a bad one can't be used to make us do the work.
    if (!(await ctx.runQuery(internal.authInternal.proofIsGood, { email: address, proof }))) return { status: "expired" };

    return ctx.runMutation(internal.authInternal.completeWithProof, {
      email: address,
      proof,
      passwordHash: await hashPassword(password),
      profile,
    });
  },
});

/** A temporary account: a username, and a day to try the app. */
export const startGuest = mutation({
  args: { username: v.string() },
  handler: async (ctx, { username }): Promise<SignInStep> => makeGuest(ctx, username, (await ctx.meta.getRequestMetadata()).ip),
});

/** The second step: a code from the authenticator app, or a backup code. */
export const verifySecondFactor = action({
  args: { token: v.string(), code: v.string() },
  handler: async (ctx, { token, code }): Promise<SignInStep> =>
    ctx.runMutation(internal.authInternal.answerChallengeWithCode, { token, code }),
});

// --- Signed in ------------------------------------------------------------------------------

/**
 * Confirm the password of the account that's signed in, before changing its security settings.
 * Only for an account with no second step yet: one that has a second step proves itself with that.
 */
export const confirmPassword = action({
  args: { password: v.string() },
  handler: async (ctx, { password }): Promise<{ ok: true; until: number } | { ok: false; reason: "invalid" | "use_second_step" | "locked"; until?: number }> => {
    const info = await ctx.runQuery(internal.authInternal.myPasswordCheck, {});
    if (!info) return { ok: false, reason: "invalid" };
    if (info.lockedUntil) return { ok: false, reason: "locked", until: info.lockedUntil };
    if (info.enrolled) return { ok: false, reason: "use_second_step" };
    const correct = await verifyPassword(password.slice(0, PASSWORD_MAX), info.passwordHash);
    return ctx.runMutation(internal.authInternal.confirmPasswordResult, { correct });
  },
});

/** Change the password of the account that's signed in. Every other session is signed out. */
export const changePassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, { currentPassword, newPassword }): Promise<{ ok: true } | { ok: false; message: string }> => {
    const info = await ctx.runQuery(internal.authInternal.myPasswordCheck, {});
    if (!info) return { ok: false, message: "Set a password first: sign out and use “Forgot password”." };
    if (info.lockedUntil) return { ok: false, message: "Too many wrong passwords. Try again later." };
    const problem = passwordProblem(newPassword, info.email ?? undefined);
    if (problem) return { ok: false, message: problem };
    const correct = await verifyPassword(currentPassword.slice(0, PASSWORD_MAX), info.passwordHash);
    if (!correct) {
      await ctx.runMutation(internal.authInternal.confirmPasswordResult, { correct: false });
      return { ok: false, message: "Your current password isn't right." };
    }
    await ctx.runMutation(internal.authInternal.replaceMyPassword, { passwordHash: await hashPassword(newPassword) });
    return { ok: true };
  },
});

/** Email a code to a new address, to move the account there. */
export const requestEmailChange = action({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<{ ok: true } | { ok: false; message: string }> => {
    const address = normalizeEmail(email);
    if (!isValidEmail(address)) return { ok: false, message: "Enter a valid email address." };
    const check = await ctx.runQuery(internal.authInternal.emailChangeCheck, { email: address });
    if (!check.ok) return check;
    const logInstead = !mailConfigured() && process.env.AUTH_LOG_CODES === "true";
    if (!mailConfigured() && !logInstead) return { ok: false, message: "We can't send email right now. Try again in a little while." };
    const issued = await ctx.runMutation(internal.authInternal.issueCode, { email: address });
    if (!issued.ok) return { ok: false, message: issued.reason === "cooldown" ? "A code was just sent. Give it a minute." : "Too many codes for that address. Try again later." };
    if (logInstead) {
      console.warn(`[auth] AUTH_LOG_CODES is on: the email-change code for ${address} is ${issued.code}`);
      return { ok: true };
    }
    try {
      await sendCodeEmail(address, issued.code, "verify", EMAIL_CODE_TTL_MS / 60_000);
    } catch {
      return { ok: false, message: "We couldn't send that email. Try again in a moment." };
    }
    return { ok: true };
  },
});

/** Enter the code from the new address to finish moving the account there. */
export const confirmEmailChange = action({
  args: { email: v.string(), code: v.string() },
  handler: async (ctx, { email, code }): Promise<{ ok: true } | { ok: false; message: string }> => {
    const address = normalizeEmail(email);
    if (!isValidEmail(address)) return { ok: false, message: "Enter a valid email address." };
    const check = await ctx.runQuery(internal.authInternal.emailChangeCheck, { email: address });
    if (!check.ok) return check;
    const proof = await ctx.runMutation(internal.authInternal.proveCode, { email: address, code: normalizeEmailCode(code) });
    if (!proof) return { ok: false, message: "That code isn't right, or it has expired." };
    const done = await ctx.runMutation(internal.authInternal.applyEmailChange, { email: address, proof });
    return done.ok ? { ok: true } : { ok: false, message: "Couldn't change your email. Try again." };
  },
});

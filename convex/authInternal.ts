import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { accountByEmail, createAccountForEmail } from "./lib/accounts";
import {
  AUTH_ERROR,
  CHALLENGE_TTL_MS,
  constantTimeEqual,
  EMAIL_CODE_COOLDOWN_MS,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_TTL_MS,
  EMAIL_PROOF_TTL_MS,
  generateEmailCode,
  hmacHex,
  normalizeEmailCode,
  randomToken,
  sha256Hex,
  TICKET_TTL_MS,
  usernameProblem,
  DISPLAY_NAME_MAX,
} from "./lib/authPolicy";
import { signedInIds } from "./lib/identity";
import { GUEST_TTL_MS, GUESTS_PER_HOUR, GUESTS_PER_NETWORK_PER_DAY } from "./lib/guests";
import { isIpBanned, recordIp, sealRequestIp } from "./lib/ipBans";
import { signInBlock } from "./lib/moderation";
import { allow, clearFailures, lockedUntil, recordFailure } from "./lib/rateLimit";
import { codeKeyMaterial, factorSummary, verifySecondFactorCode } from "./lib/secondFactor";
import { revokeSessions } from "./lib/sessions";
import { grantStepUp, requireFreshVerification, stepUpState } from "./lib/stepUp";
import type { AddressState, SignInStep } from "./lib/signInStep";

/**
 * The database side of convex/authFlow.ts, convex/passkeys.ts and the sign-in callback in
 * convex/auth.ts: the questions they ask and the writes they make. Actions can't reach the
 * database, and none of these is callable from the app.
 *
 * Everything that decides *whether a session may start* ends at `finish` below, the only place a
 * ticket is made. It is also where the account's standing is checked — so a banned or suspended
 * account is stopped, and told why, by the same code whichever way it got this far: password,
 * emailed code, authenticator, or passkey.
 */

// --- The end of every successful sign-in ------------------------------------------------------

/**
 * Every check the account has to pass has passed. Hand it a ticket — unless it is banned or
 * suspended, in which case say so instead, with the reason staff gave.
 */
export async function finish(ctx: MutationCtx, user: Doc<"users">): Promise<SignInStep> {
  const block = signInBlock(user);
  if (block) {
    return block.kind === "banned"
      ? { status: "blocked", kind: "banned", reason: block.reason }
      : { status: "blocked", kind: "suspended", reason: block.reason, until: block.until, indefinite: block.indefinite };
  }
  const ticket = randomToken();
  await ctx.db.insert("authTickets", {
    userId: user._id,
    ticketHash: await sha256Hex(ticket),
    expiresAt: Date.now() + TICKET_TTL_MS,
  });
  return { status: "signed_in", ticket };
}

/**
 * The first factor (a password, or an emailed code) is right. Either the account has a second
 * step to pass, and a challenge is opened for it, or it is done.
 *
 * The block is checked *first*, so a banned person is told so straight away instead of being
 * walked through a second-step prompt to a screen that turns them away. `pendingPasswordHash` is
 * a password reset waiting on that second step: it is only applied when the step is passed.
 */
async function afterFirstFactor(ctx: MutationCtx, user: Doc<"users">, pendingPasswordHash?: string): Promise<SignInStep> {
  const blocked = signInBlock(user);
  if (blocked) return finish(ctx, user);

  const factors = await factorSummary(ctx, user._id);
  if (!factors.enrolled) {
    if (pendingPasswordHash) await applyPassword(ctx, user._id, pendingPasswordHash);
    return finish(ctx, user);
  }
  const token = randomToken();
  await ctx.db.insert("authSecondFactorChallenges", {
    userId: user._id,
    tokenHash: await sha256Hex(token),
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
    pendingPasswordHash,
  });
  return {
    status: "second_factor",
    token,
    methods: { totp: factors.totp, passkey: factors.passkeys > 0, backup: factors.backupCodes > 0 },
  };
}

/** Set (or replace) an account's password, and sign it out everywhere else: whoever had the old one is out. */
async function applyPassword(
  ctx: MutationCtx,
  userId: Id<"users">,
  passwordHash: string,
  keepSession?: Id<"authSessions">,
): Promise<void> {
  const existing = await ctx.db.query("authCredentials").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
  if (existing) await ctx.db.patch(existing._id, { passwordHash, updatedAt: Date.now() });
  else await ctx.db.insert("authCredentials", { userId, passwordHash, updatedAt: Date.now() });
  await revokeSessions(ctx, userId, keepSession);
}

// --- Tickets ------------------------------------------------------------------------------------

/**
 * Trade a ticket for the account it was issued to, for the auth library to start a session on.
 *
 * Single use: it is deleted whether or not it turns out to be good. The standing is checked again,
 * because up to two minutes can pass between a ticket being issued and being redeemed.
 */
export const redeemTicket = internalMutation({
  args: { ticket: v.string() },
  handler: async (ctx, { ticket }): Promise<Id<"users"> | null> => {
    const ticketHash = await sha256Hex(ticket.slice(0, 200));
    const row = await ctx.db.query("authTickets").withIndex("by_hash", (q) => q.eq("ticketHash", ticketHash)).unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (row.expiresAt <= Date.now()) return null;
    const user = await ctx.db.get(row.userId);
    if (!user || user.isBot || signInBlock(user)) return null;
    return user._id;
  },
});

/** A ticket for an account that has proved itself some other way (a passkey that verifies the person). */
export const ticketFor = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<SignInStep> => {
    const user = await ctx.db.get(userId);
    if (!user || user.isBot) return { status: "invalid" };
    return finish(ctx, user);
  },
});

// --- Addresses and emailed codes ---------------------------------------------------------------

/** Where an address stands, for choosing the next screen. */
export const addressState = internalQuery({
  args: { email: v.string() },
  handler: async (
    ctx,
    { email },
  ): Promise<{ state: AddressState; userId?: Id<"users">; profile?: { username: string; name: string; imageUrl?: string } }> => {
    const account = await accountByEmail(ctx, email);
    if (!account) return { state: "signup" };
    const password = await ctx.db.query("authCredentials").withIndex("by_user", (q) => q.eq("userId", account.user._id)).unique();
    const { username, name, imageUrl } = account.user;
    return { state: password ? "password" : "setup", userId: account.user._id, profile: { username, name, imageUrl } };
  },
});

/**
 * Make a code for an address and remember a keyed hash of it. Returns the code, once, for the
 * action to email; the table never holds it.
 *
 * Limits how often one address can be sent codes (a pause between two, and a handful per quarter
 * of an hour), so the sign-in screen can't be used to fill somebody's inbox. The count includes
 * every request, whether or not an account exists, so it says nothing about that either.
 */
export const issueCode = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<{ ok: true; code: string } | { ok: false; reason: "cooldown" | "limit" }> => {
    const key = `code:${email}`;
    if (await lockedUntil(ctx, key)) return { ok: false, reason: "limit" };
    const previous = await ctx.db.query("authEmailCodes").withIndex("by_email", (q) => q.eq("email", email)).order("desc").first();
    if (previous && Date.now() - previous.createdAt < EMAIL_CODE_COOLDOWN_MS) return { ok: false, reason: "cooldown" };

    await recordFailure(ctx, key);
    const old = await ctx.db.query("authEmailCodes").withIndex("by_email", (q) => q.eq("email", email)).collect();
    for (const row of old) await ctx.db.delete(row._id);

    const code = generateEmailCode();
    await ctx.db.insert("authEmailCodes", {
      email,
      codeHash: await hmacHex(codeKeyMaterial(), `${email}:${code}`),
      expiresAt: Date.now() + EMAIL_CODE_TTL_MS,
      attempts: 0,
      createdAt: Date.now(),
    });
    return { ok: true, code };
  },
});

/**
 * The emailed code was entered: if it's right, hand back a proof that the address was just proved.
 *
 * The proof is what the last step presents instead of the code, so the code can be entered on a
 * screen of its own and the rest (a profile, a password) filled in afterwards without the code's
 * ten minutes running out underneath. Single use, and good for half an hour.
 */
export const proveCode = internalMutation({
  args: { email: v.string(), code: v.string() },
  handler: async (ctx, { email, code }): Promise<string | null> => {
    const row = await ctx.db.query("authEmailCodes").withIndex("by_email", (q) => q.eq("email", email)).order("desc").first();
    if (!row) return null;
    if (row.expiresAt <= Date.now() || row.attempts >= EMAIL_CODE_MAX_ATTEMPTS) {
      await ctx.db.delete(row._id);
      return null;
    }
    const given = await hmacHex(codeKeyMaterial(), `${email}:${normalizeEmailCode(code).slice(0, 16)}`);
    if (!constantTimeEqual(given, row.codeHash)) {
      if (row.attempts + 1 >= EMAIL_CODE_MAX_ATTEMPTS) await ctx.db.delete(row._id);
      else await ctx.db.patch(row._id, { attempts: row.attempts + 1 });
      return null;
    }
    await ctx.db.delete(row._id);
    const proof = randomToken();
    await ctx.db.insert("authEmailProofs", { email, proofHash: await sha256Hex(proof), expiresAt: Date.now() + EMAIL_PROOF_TTL_MS });
    return proof;
  },
});

/** Whether a proof is still good for this address, without using it up (so the screen can go back and forth). */
export const proofIsGood = internalQuery({
  args: { email: v.string(), proof: v.string() },
  handler: async (ctx, { email, proof }): Promise<boolean> => {
    const proofHash = await sha256Hex(proof.slice(0, 200));
    const row = await ctx.db.query("authEmailProofs").withIndex("by_hash", (q) => q.eq("proofHash", proofHash)).unique();
    return !!row && row.email === email && row.expiresAt > Date.now();
  },
});

/** Whether a username is free, and fit to take. Usernames are public, so this tells nothing that isn't already visible. */
export const usernameCheck = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, { username }): Promise<{ ok: true } | { ok: false; message: string }> => {
    const problem = usernameProblem(username);
    if (problem) return { ok: false, message: problem };
    const taken = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", username)).unique();
    return taken ? { ok: false, message: "That username is taken." } : { ok: true };
  },
});

/**
 * The last step of sign-up, or of choosing a password: the address was proved, and a password (and,
 * for a new person, a profile) has been chosen. Open the account if there isn't one, or set the
 * password on the one there is (a Clerk account's first, or a forgotten one's replacement).
 *
 * Everything that can be refused is checked before the proof is used up, so a taken username
 * doesn't cost the person their code. Nothing is written for a blocked account: it's told so and
 * the password is left as it was. For an account with a second step, the password waits in the
 * challenge until that step is passed, so having the inbox alone is never enough to change the
 * password of an account that has more than that protecting it.
 */
export const completeWithProof = internalMutation({
  args: {
    email: v.string(),
    proof: v.string(),
    passwordHash: v.string(),
    profile: v.optional(v.object({ username: v.string(), name: v.string() })),
  },
  handler: async (ctx, { email, proof, passwordHash, profile }): Promise<SignInStep> => {
    const proofHash = await sha256Hex(proof.slice(0, 200));
    const row = await ctx.db.query("authEmailProofs").withIndex("by_hash", (q) => q.eq("proofHash", proofHash)).unique();
    if (!row || row.email !== email || row.expiresAt <= Date.now()) {
      return { status: "expired" };
    }
    const account = await accountByEmail(ctx, email);
    if (!account) {
      const username = (profile?.username ?? "").trim().toLowerCase();
      const name = (profile?.name ?? "").trim();
      const problem = usernameProblem(username);
      if (problem) return { status: "invalid", message: problem };
      if (!name || name.length > DISPLAY_NAME_MAX) return { status: "invalid", message: `Pick a display name up to ${DISPLAY_NAME_MAX} characters.` };
      const identity = await signedInIds(ctx);
      const currentUser = identity ? await ctx.db.get(identity.userId) : null;
      const guest = currentUser?.isGuest && (currentUser.guestExpiresAt ?? 0) > Date.now() ? currentUser : null;
      const nameOwner = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", username)).unique();
      if (nameOwner && nameOwner._id !== guest?._id) {
        return { status: "invalid", message: "That username was just taken. Pick another." };
      }
      await ctx.db.delete(row._id);
      let userId: Id<"users">;
      if (guest) {
        // Keep the guest's identity and data when they sign up from the preview flow.
        // That also lets them claim the username they were already using.
        userId = guest._id;
        await ctx.db.patch(userId, { username, name, isGuest: undefined, guestExpiresAt: undefined });
        await ctx.db.insert("userEmails", { userId, email, verifiedAt: Date.now(), source: "signup" });
      } else {
        userId = await createAccountForEmail(ctx, email, { username, name });
      }
      await applyPassword(ctx, userId, passwordHash);
      return finish(ctx, (await ctx.db.get(userId))!);
    }
    await ctx.db.delete(row._id);
    // The code proved the address, whatever its source before.
    if (account.address.verifiedAt === undefined) await ctx.db.patch(account.address._id, { verifiedAt: Date.now() });
    return afterFirstFactor(ctx, account.user, passwordHash);
  },
});

// --- Passwords ----------------------------------------------------------------------------------

/** What the action needs to check a password: the hash, and whether guessing is paused. */
export const passwordCheck = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const account = await accountByEmail(ctx, email);
    if (!account) return null;
    const row = await ctx.db.query("authCredentials").withIndex("by_user", (q) => q.eq("userId", account.user._id)).unique();
    if (!row) return null;
    return {
      userId: account.user._id,
      passwordHash: row.passwordHash,
      lockedUntil: await lockedUntil(ctx, `pw:${account.user._id}`),
    };
  },
});

/**
 * The outcome of a password check. A wrong one is counted — ten in a quarter of an hour pause
 * guessing — and a right one moves on to the second step, or to a ticket.
 */
export const passwordResult = internalMutation({
  args: { userId: v.id("users"), correct: v.boolean() },
  handler: async (ctx, { userId, correct }): Promise<SignInStep> => {
    const key = `pw:${userId}`;
    if (!correct) {
      await recordFailure(ctx, key);
      const until = await lockedUntil(ctx, key);
      return until ? { status: "locked", until } : { status: "invalid" };
    }
    await clearFailures(ctx, key);
    const user = await ctx.db.get(userId);
    if (!user || user.isBot) return { status: "invalid" };
    return afterFirstFactor(ctx, user);
  },
});

// --- The second step ----------------------------------------------------------------------------

/** The open challenge for a token, if it's still good. */
async function openChallenge(ctx: MutationCtx, token: string) {
  const tokenHash = await sha256Hex(token.slice(0, 200));
  const row = await ctx.db.query("authSecondFactorChallenges").withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    await ctx.db.delete(row._id);
    return null;
  }
  return row;
}

/** Answer a second-step challenge with a code from the authenticator app or a backup code. */
export const answerChallengeWithCode = internalMutation({
  args: { token: v.string(), code: v.string() },
  handler: async (ctx, { token, code }): Promise<SignInStep> => {
    const challenge = await openChallenge(ctx, token);
    if (!challenge) return { status: "expired" };
    const result = await verifySecondFactorCode(ctx, challenge.userId, code);
    if (!result.ok) {
      return result.reason === "locked" ? { status: "locked", until: result.until } : { status: "invalid", message: "That code isn't right." };
    }
    return completeChallenge(ctx, challenge);
  },
});

/** The challenge a passkey is about to answer, and whose it is. */
export const challengeOwner = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<Id<"users"> | null> => {
    const tokenHash = await sha256Hex(token.slice(0, 200));
    const row = await ctx.db.query("authSecondFactorChallenges").withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash)).unique();
    return row && row.expiresAt > Date.now() ? row.userId : null;
  },
});

/** Answer a second-step challenge with a passkey the caller has already verified belongs to the account. */
export const answerChallengeWithPasskey = internalMutation({
  args: { token: v.string(), passkeyUserId: v.id("users") },
  handler: async (ctx, { token, passkeyUserId }): Promise<SignInStep> => {
    const challenge = await openChallenge(ctx, token);
    if (!challenge) return { status: "expired" };
    // The credential has to be this account's own: a valid passkey of somebody else's is not an answer.
    if (challenge.userId !== passkeyUserId) return { status: "invalid", message: "That passkey isn't on this account." };
    return completeChallenge(ctx, challenge);
  },
});

async function completeChallenge(ctx: MutationCtx, challenge: Doc<"authSecondFactorChallenges">): Promise<SignInStep> {
  await ctx.db.delete(challenge._id);
  const user = await ctx.db.get(challenge.userId);
  if (!user || user.isBot) return { status: "invalid" };
  // Standing is looked at again: it can change in the minutes a challenge is open.
  if (signInBlock(user)) return finish(ctx, user);
  if (challenge.pendingPasswordHash) await applyPassword(ctx, user._id, challenge.pendingPasswordHash);
  return finish(ctx, user);
}

// --- The signed-in account ----------------------------------------------------------------------
// Called from actions, which carry the caller's identity through to these: `signedInIds` is what
// decides who "me" is, and checks the session is still alive.

/** My password hash and standing, for an action that needs to check what I typed. */
export const myPasswordCheck = internalQuery({
  args: {},
  handler: async (ctx) => {
    const ids = await signedInIds(ctx);
    if (!ids) return null;
    const row = await ctx.db.query("authCredentials").withIndex("by_user", (q) => q.eq("userId", ids.userId)).unique();
    if (!row) return null;
    const address = await ctx.db.query("userEmails").withIndex("by_user", (q) => q.eq("userId", ids.userId)).first();
    return {
      passwordHash: row.passwordHash,
      email: address?.email ?? null,
      enrolled: (await factorSummary(ctx, ids.userId)).enrolled,
      lockedUntil: await lockedUntil(ctx, `pw:${ids.userId}`),
    };
  },
});

/**
 * The outcome of confirming my password. A right one, on an account with no second step, unlocks
 * security settings on this session for a few minutes; a wrong one counts against guessing.
 */
export const confirmPasswordResult = internalMutation({
  args: { correct: v.boolean() },
  handler: async (ctx, { correct }) => {
    const ids = await signedInIds(ctx);
    if (!ids) return { ok: false, reason: "invalid" } as const;
    const key = `pw:${ids.userId}`;
    if (!correct) {
      await recordFailure(ctx, key);
      const until = await lockedUntil(ctx, key);
      return until ? ({ ok: false, reason: "locked", until } as const) : ({ ok: false, reason: "invalid" } as const);
    }
    await clearFailures(ctx, key);
    if ((await factorSummary(ctx, ids.userId)).enrolled) return { ok: false, reason: "use_second_step" } as const;
    const until = await grantStepUp(ctx, ids.userId, ids.sessionId, "password");
    return { ok: true, until } as const;
  },
});

/** Replace my password (the action has checked the old one). Signs out every other session. */
export const replaceMyPassword = internalMutation({
  args: { passwordHash: v.string() },
  handler: async (ctx, { passwordHash }) => {
    const ids = await signedInIds(ctx);
    if (!ids) throw new Error("Not signed in.");
    // An account with a second step needs it entered recently, not only the old password.
    await requireFreshVerificationUnlessPassword(ctx, ids.userId);
    await applyPassword(ctx, ids.userId, passwordHash, ids.sessionId);
  },
});

async function requireFreshVerificationUnlessPassword(ctx: MutationCtx, userId: Id<"users">): Promise<void> {
  const state = await stepUpState(ctx, userId);
  if (!state.enrolled) return; // the old password, already checked, is the proof
  if (state.unlockedUntil !== null && state.unlockedUntil > Date.now()) return;
  throw new ConvexError({ code: AUTH_ERROR.stepUpRequired, message: "Enter a verification code to continue." });
}


// --- Guests -------------------------------------------------------------------------------------

/**
 * Make a guest account: a username and nothing else, good for a day.
 *
 * Limited by network (a few a day) and overall (so a script can't fill the table), and refused from
 * a network banned from Crystal — the same rule `ensureUser` applies to new accounts, because a
 * guest is the cheapest way round it. `ip` comes from the request that reached the public mutation
 * (an internal mutation called from an action wouldn't see the caller's address), which is why this
 * is a helper for `authFlow.startGuest` and not a function of its own.
 */
export async function makeGuest(ctx: MutationCtx, username: string, ip: string | null | undefined): Promise<SignInStep> {
  {
    const handle = username.trim().toLowerCase();
    const problem = usernameProblem(handle);
    if (problem) return { status: "invalid", message: problem };

    const sealed = await sealRequestIp(ip);
    if (sealed && (await isIpBanned(ctx, sealed.ipHash))) {
      return {
        status: "blocked",
        kind: "banned",
        reason: "This network is banned from Crystal, so guest accounts can't be made from it.",
      };
    }
    if (!(await allow(ctx, "guest:all", GUESTS_PER_HOUR, 60 * 60 * 1000))) {
      return { status: "invalid", message: "Lots of people are trying Crystal right now. Try again in a little while." };
    }
    // Without a usable address there is nothing to limit by; the overall limit still holds.
    if (sealed && !(await allow(ctx, `guest:ip:${sealed.ipHash}`, GUESTS_PER_NETWORK_PER_DAY, 24 * 60 * 60 * 1000))) {
      return { status: "invalid", message: "You've made a few guest accounts today. Create a free account to keep going." };
    }
    if (await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", handle)).unique()) {
      return { status: "invalid", message: "That username is taken." };
    }

    const userId = await ctx.db.insert("users", {
      name: handle,
      username: handle,
      isGuest: true,
      guestExpiresAt: Date.now() + GUEST_TTL_MS,
    });
    if (sealed) await recordIp(ctx, userId, sealed);
    return finish(ctx, (await ctx.db.get(userId))!);
  }
}


// --- Changing the address ---------------------------------------------------------------------------

/** Is this session allowed to change its address to `email`, and is `email` free? Throws for a refusal that needs a code. */
export const emailChangeCheck = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<{ ok: true } | { ok: false; message: string }> => {
    const ids = await signedInIds(ctx);
    if (!ids) return { ok: false, message: "Sign in again to do that." };
    const user = await ctx.db.get(ids.userId);
    if (!user || user.isGuest) return { ok: false, message: "Guest accounts don't have an email address." };
    await requireFreshVerification(ctx, ids.userId);
    const taken = await ctx.db.query("userEmails").withIndex("by_email", (q) => q.eq("email", email)).first();
    if (taken) return { ok: false, message: taken.userId === ids.userId ? "That's already your email address." : "That email address is already in use." };
    return { ok: true };
  },
});

/** Make `email` the account's address, given a proof that it was just confirmed. Replaces the old one. */
export const applyEmailChange = internalMutation({
  args: { email: v.string(), proof: v.string() },
  handler: async (ctx, { email, proof }): Promise<{ ok: boolean }> => {
    const ids = await signedInIds(ctx);
    if (!ids) return { ok: false };
    await requireFreshVerification(ctx, ids.userId);
    const proofHash = await sha256Hex(proof.slice(0, 200));
    const row = await ctx.db.query("authEmailProofs").withIndex("by_hash", (q) => q.eq("proofHash", proofHash)).unique();
    if (!row || row.email !== email || row.expiresAt <= Date.now()) return { ok: false };
    if (await ctx.db.query("userEmails").withIndex("by_email", (q) => q.eq("email", email)).first()) return { ok: false };
    await ctx.db.delete(row._id);
    const existing = await ctx.db.query("userEmails").withIndex("by_user", (q) => q.eq("userId", ids.userId)).first();
    if (existing) await ctx.db.patch(existing._id, { email, verifiedAt: Date.now(), source: "change" });
    else await ctx.db.insert("userEmails", { userId: ids.userId, email, verifiedAt: Date.now(), source: "change" });
    return { ok: true };
  },
});

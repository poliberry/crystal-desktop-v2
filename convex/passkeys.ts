"use node";

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, type ActionCtx } from "./_generated/server";
import type { SignInStep } from "./lib/signInStep";
import { allowedOrigins, fromBase64Url, readClientData, RP_NAME, rpIdFor, toBase64Url } from "./lib/webauthn";

/**
 * Passkeys (WebAuthn), as the sign-in screen and Settings → Security use them. Runs in Node
 * because the library parses certificates and CBOR; the database work is in convex/passkeyData.ts.
 *
 * Four things a passkey does here, each with an options step (the server picks a one-time
 * challenge) and a verify step (the browser has signed it):
 *
 *   register       add one to the signed-in account
 *   sign in        no password at all. A passkey used with user verification (a fingerprint, a face,
 *                  a PIN) is two factors in one, so it also satisfies the account's second step.
 *   second step    after the password, in place of a code
 *   step up        before an administrative function, in place of a code
 *
 * Every verification demands user verification, so a passkey that only proves "somebody is holding
 * the device" is not accepted for any of them.
 */

type AnyJson = Record<string, unknown>;

/** The relying party for the origin the page says it's on — which we only believe if we recognise it. */
function relyingParty(origin: string): string {
  const rpId = rpIdFor(origin);
  if (!rpId) throw new Error("Passkeys aren't available on this address.");
  return rpId;
}

async function startAssertion(
  ctx: ActionCtx,
  origin: string,
  options: { userId?: Id<"users">; allow?: { id: string; transports?: string[] }[] },
): Promise<AnyJson> {
  const rpID = relyingParty(origin);
  const result = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: options.allow,
  });
  await ctx.runMutation(internal.passkeyData.saveChallenge, {
    challenge: result.challenge,
    kind: "authenticate",
    userId: options.userId,
    rpId: rpID,
  });
  return result as unknown as AnyJson;
}

/**
 * Check a signed assertion and return the passkey it came from.
 *
 * `onlyUser` pins it to one account (the signed-in one, or the one a second-step challenge belongs
 * to). Without it, a challenge that was made for a particular account still can't be answered with
 * another account's passkey: the challenge row remembers whose it was.
 */
async function checkAssertion(
  ctx: ActionCtx,
  response: AnyJson,
  onlyUser?: Id<"users">,
): Promise<{ userId: Id<"users"> } | null> {
  const body = response as unknown as { id?: string; response?: { clientDataJSON?: string } };
  if (typeof body.id !== "string" || typeof body.response?.clientDataJSON !== "string") return null;
  const client = readClientData(body.response.clientDataJSON);
  if (!client || client.type !== "webauthn.get") return null;

  // The challenge is used up first, so a replayed answer finds nothing.
  const challenge = await ctx.runMutation(internal.passkeyData.takeChallenge, { challenge: client.challenge, kind: "authenticate" });
  if (!challenge) return null;
  const passkey = await ctx.runQuery(internal.passkeyData.credentialById, { credentialId: body.id });
  if (!passkey) return null;
  if (challenge.userId && challenge.userId !== passkey.userId) return null;
  if (onlyUser && passkey.userId !== onlyUser) return null;
  // The browser wrote the origin into what it signed; it has to be one of ours and the one this passkey was made for.
  if (rpIdFor(client.origin) !== passkey.rpId || challenge.rpId !== passkey.rpId) return null;

  try {
    const verified = await verifyAuthenticationResponse({
      response: response as never,
      expectedChallenge: client.challenge,
      expectedOrigin: allowedOrigins(),
      expectedRPID: passkey.rpId,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: fromBase64Url(passkey.publicKey) as never,
        counter: passkey.counter,
        transports: passkey.transports as never,
      },
    });
    if (!verified.verified) return null;
    await ctx.runMutation(internal.passkeyData.recordUse, {
      id: passkey.id,
      counter: verified.authenticationInfo.newCounter,
      backedUp: verified.authenticationInfo.credentialBackedUp,
    });
    return { userId: passkey.userId };
  } catch (error) {
    // A signature that doesn't check out, a counter that went backwards (a cloned key), a wrong origin.
    console.warn("A passkey assertion was refused:", error instanceof Error ? error.message : "unknown");
    return null;
  }
}

// --- Sign in with a passkey ---------------------------------------------------------------------

export const signInOptions = action({
  args: { origin: v.string() },
  handler: async (ctx, { origin }): Promise<AnyJson> => startAssertion(ctx, origin, {}),
});

export const signInVerify = action({
  args: { response: v.any() },
  handler: async (ctx, { response }): Promise<SignInStep> => {
    const passkey = await checkAssertion(ctx, response);
    if (!passkey) return { status: "invalid", message: "That passkey didn't work. Try again or use your password." };
    return ctx.runMutation(internal.authInternal.ticketFor, { userId: passkey.userId });
  },
});

// --- As the second step -------------------------------------------------------------------------

export const secondFactorOptions = action({
  args: { token: v.string(), origin: v.string() },
  handler: async (ctx, { token, origin }): Promise<AnyJson> => {
    const userId = await ctx.runQuery(internal.authInternal.challengeOwner, { token });
    if (!userId) throw new Error("This sign-in has expired. Start again.");
    const allow = await ctx.runQuery(internal.passkeyData.credentialsOf, { userId });
    if (allow.length === 0) throw new Error("This account has no passkeys.");
    return startAssertion(ctx, origin, { userId, allow });
  },
});

export const secondFactorVerify = action({
  args: { token: v.string(), response: v.any() },
  handler: async (ctx, { token, response }): Promise<SignInStep> => {
    const owner = await ctx.runQuery(internal.authInternal.challengeOwner, { token });
    if (!owner) return { status: "expired" };
    const passkey = await checkAssertion(ctx, response, owner);
    if (!passkey) return { status: "invalid", message: "That passkey didn't work." };
    return ctx.runMutation(internal.authInternal.answerChallengeWithPasskey, { token, passkeyUserId: passkey.userId });
  },
});

// --- Stepping up ----------------------------------------------------------------------------------

export const stepUpOptions = action({
  args: { origin: v.string() },
  handler: async (ctx, { origin }): Promise<AnyJson> => {
    const userId = await ctx.runQuery(internal.passkeyData.myUserId, {});
    if (!userId) throw new Error("Not signed in.");
    const allow = await ctx.runQuery(internal.passkeyData.credentialsOf, { userId });
    if (allow.length === 0) throw new Error("You have no passkeys.");
    return startAssertion(ctx, origin, { userId, allow });
  },
});

export const stepUpVerify = action({
  args: { response: v.any() },
  handler: async (ctx, { response }): Promise<{ ok: true; until: number } | { ok: false }> => {
    const userId = await ctx.runQuery(internal.passkeyData.myUserId, {});
    if (!userId) return { ok: false };
    const passkey = await checkAssertion(ctx, response, userId);
    if (!passkey) return { ok: false };
    return { ok: true, until: await ctx.runMutation(internal.passkeyData.grantPasskeyStepUp, { userId: passkey.userId }) };
  },
});

// --- Registering ----------------------------------------------------------------------------------

export const registrationOptions = action({
  args: { origin: v.string() },
  handler: async (ctx, { origin }): Promise<AnyJson> => {
    const rpID = relyingParty(origin);
    // Refuses unless this session has just proved it's the owner (a code, or the password if there is no second step yet).
    const me = await ctx.runQuery(internal.passkeyData.registrationInfo, {});
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userName: me.username,
      userDisplayName: me.name,
      // Stable per account, and not the username: it can change, and it is shown by some authenticators.
      userID: new TextEncoder().encode(me.userId),
      attestationType: "none",
      excludeCredentials: me.existing,
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    });
    await ctx.runMutation(internal.passkeyData.saveChallenge, {
      challenge: options.challenge,
      kind: "register",
      userId: me.userId,
      rpId: rpID,
    });
    return options as unknown as AnyJson;
  },
});

export const registrationVerify = action({
  args: { response: v.any(), name: v.optional(v.string()) },
  handler: async (ctx, { response, name }): Promise<{ ok: true; backupCodes: string[] | null } | { ok: false; message: string }> => {
    const me = await ctx.runQuery(internal.passkeyData.registrationInfo, {});
    const body = response as { response?: { clientDataJSON?: string } };
    const client = typeof body?.response?.clientDataJSON === "string" ? readClientData(body.response.clientDataJSON) : null;
    if (!client || client.type !== "webauthn.create") return { ok: false, message: "That passkey couldn't be read." };

    const challenge = await ctx.runMutation(internal.passkeyData.takeChallenge, { challenge: client.challenge, kind: "register" });
    if (!challenge || challenge.userId !== me.userId || rpIdFor(client.origin) !== challenge.rpId) {
      return { ok: false, message: "That took too long. Try adding the passkey again." };
    }
    try {
      const verified = await verifyRegistrationResponse({
        response: response as never,
        expectedChallenge: client.challenge,
        expectedOrigin: allowedOrigins(),
        expectedRPID: challenge.rpId,
        requireUserVerification: true,
      });
      if (!verified.verified) return { ok: false, message: "That passkey couldn't be verified." };
      const { credential, credentialDeviceType, credentialBackedUp } = verified.registrationInfo;
      const saved = await ctx.runMutation(internal.passkeyData.addPasskey, {
        credentialId: credential.id,
        publicKey: toBase64Url(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        name: name ?? "Passkey",
        rpId: challenge.rpId,
      });
      return { ok: true, backupCodes: saved.backupCodes };
    } catch (error) {
      console.warn("A passkey registration was refused:", error instanceof Error ? error.message : "unknown");
      return { ok: false, message: error instanceof Error && error.message.startsWith("You can have") ? error.message : "That passkey couldn't be verified." };
    }
  },
});

import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx } from "./_generated/server";
import { CREATOR_PLATFORMS, PLATFORM_META, type CreatorPlatform } from "./lib/communityKinds";
import { configuredPlatforms, missingEnv, PLATFORMS, type Purpose, type Tokens } from "./lib/platforms";
import { decryptSecret, encryptSecret, signState, verifyState } from "./lib/secrets";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

/**
 * Outside accounts a person has connected to theirs: Twitch, YouTube, TikTok.
 *
 * Connecting is an OAuth round trip through the platform's own page, so Crystal
 * never sees a password. The tokens that come back are stored encrypted and are
 * only ever read by server-side actions; a client sees who the account is and what
 * it was allowed to do, nothing more.
 */

const providerValidator = v.union(v.literal("twitch"), v.literal("youtube"), v.literal("tiktok"));
const purposeValidator = v.union(v.literal("channel"), v.literal("identity"));

/** Where a platform sends the person back to, after they say yes. */
function redirectUri(provider: CreatorPlatform): string {
  const site = process.env.CONVEX_SITE_URL;
  if (!site) throw new Error("Account connections aren't set up on this deployment.");
  return `${site.replace(/\/$/, "")}/oauth/callback/${provider}`;
}

/** The connected accounts of the caller, and which platforms can be connected here. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    const available = configuredPlatforms();
    if (!me) return { accounts: [], available };
    const rows = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();
    return {
      available,
      accounts: rows.map((a) => ({
        id: a._id,
        provider: a.provider,
        displayName: a.displayName,
        handle: a.handle,
        avatarUrl: a.avatarUrl,
        // Whether it was connected with enough to read memberships — a channel
        // connection, as opposed to just proving who someone is.
        canReadMembers: a.provider === "twitch" ? a.scopes.includes("channel:read:subscriptions") : a.scopes.some((s) => s.includes("channel-memberships")),
        lastError: a.lastError,
      })),
    };
  },
});

export const whoami = internalQuery({
  args: {},
  handler: async (ctx) => (await getCurrentUserOrThrow(ctx))._id,
});

/** Begin connecting: the address of the platform's consent page. Opened in a
 * browser; the platform returns to `/oauth/callback/<provider>`. */
export const start = action({
  args: { provider: providerValidator, purpose: purposeValidator },
  handler: async (ctx, { provider, purpose }): Promise<{ url: string }> => {
    if (!(CREATOR_PLATFORMS as readonly string[]).includes(provider)) throw new Error("That isn't a platform Crystal can connect to.");
    const platform = PLATFORMS[provider];
    if (!platform.configured()) {
      // Name what is missing: "isn't set up" sends people looking in the wrong place.
      const missing = missingEnv(provider);
      throw new Error(`${PLATFORM_META[provider].label} isn't set up on this deployment — ${missing.join(" and ")} ${missing.length === 1 ? "isn't" : "aren't"} set.`);
    }
    const userId: Id<"users"> = await ctx.runQuery(internal.connectedAccounts.whoami, {});
    const state = await signState({ uid: userId, provider, purpose, n: crypto.randomUUID() });
    return { url: platform.authUrl(redirectUri(provider), state, purpose as Purpose) };
  },
});

export const save = internalMutation({
  args: {
    userId: v.id("users"),
    provider: providerValidator,
    externalId: v.string(),
    displayName: v.string(),
    handle: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    accessCipher: v.string(),
    refreshCipher: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    scopes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // One platform account belongs to one Crystal account: otherwise connecting
    // somebody else's channel would be a way to claim being them.
    const holder = await ctx.db
      .query("connectedAccounts")
      .withIndex("by_provider_external", (q) => q.eq("provider", args.provider).eq("externalId", args.externalId))
      .first();
    if (holder && holder.userId !== args.userId) throw new Error("That account is already connected to a different Crystal account.");

    const now = Date.now();
    const mine = (await ctx.db.query("connectedAccounts").withIndex("by_user", (q) => q.eq("userId", args.userId)).collect()).find(
      (a) => a.provider === args.provider,
    );
    // Reconnecting with narrower permissions must not silently lose the wider ones
    // a channel link depends on, but the platform's answer is what is true now.
    if (mine) {
      await ctx.db.patch(mine._id, { ...args, updatedAt: now, lastError: undefined });
      return mine._id;
    }
    return ctx.db.insert("connectedAccounts", { ...args, createdAt: now, updatedAt: now });
  },
});

/** The platform has redirected the person back: finish connecting. */
export const complete = internalAction({
  args: { provider: providerValidator, code: v.string(), state: v.string() },
  handler: async (ctx, { provider, code, state }): Promise<{ ok: boolean; message?: string }> => {
    const parsed = await verifyState<{ uid: Id<"users">; provider: CreatorPlatform; purpose: Purpose }>(state);
    if (!parsed || parsed.provider !== provider) return { ok: false, message: "That link has expired. Start again from Crystal." };
    try {
      const platform = PLATFORMS[provider];
      const tokens = await platform.exchange(code, redirectUri(provider));
      const profile = await platform.profile(tokens.accessToken);
      await ctx.runMutation(internal.connectedAccounts.save, {
        userId: parsed.uid,
        provider,
        externalId: profile.externalId,
        displayName: profile.displayName,
        handle: profile.handle,
        avatarUrl: profile.avatarUrl,
        accessCipher: await encryptSecret(tokens.accessToken),
        refreshCipher: tokens.refreshToken ? await encryptSecret(tokens.refreshToken) : undefined,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error && e.message.includes("already connected") ? e.message : "Couldn't connect that account." };
    }
  },
});

export const disconnect = mutation({
  args: { accountId: v.id("connectedAccounts") },
  handler: async (ctx, { accountId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const account = await ctx.db.get(accountId);
    if (!account || account.userId !== me._id) return;
    // A community's channel link that stands on this account stops with it.
    for (const channel of await ctx.db.query("creatorChannels").withIndex("by_account", (q) => q.eq("accountId", accountId)).collect()) {
      await ctx.db.delete(channel._id);
    }
    await ctx.db.delete(accountId);
  },
});

// --- Using the tokens ---------------------------------------------------------------------

export const cipherFor = internalQuery({
  args: { accountId: v.id("connectedAccounts") },
  handler: async (ctx, { accountId }): Promise<Doc<"connectedAccounts"> | null> => ctx.db.get(accountId),
});

export const storeTokens = internalMutation({
  args: {
    accountId: v.id("connectedAccounts"),
    accessCipher: v.string(),
    refreshCipher: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, accessCipher, refreshCipher, expiresAt, error }) => {
    if (!(await ctx.db.get(accountId))) return;
    await ctx.db.patch(accountId, {
      accessCipher,
      ...(refreshCipher ? { refreshCipher } : {}),
      expiresAt,
      lastError: error,
      updatedAt: Date.now(),
    });
  },
});

export const noteError = internalMutation({
  args: { accountId: v.id("connectedAccounts"), error: v.string() },
  handler: async (ctx, { accountId, error }) => {
    if (await ctx.db.get(accountId)) await ctx.db.patch(accountId, { lastError: error.slice(0, 200) });
  },
});

/** A working access token for an account, refreshed if it is about to lapse. */
export async function freshToken(ctx: ActionCtx, accountId: Id<"connectedAccounts">): Promise<{ token: string; account: Doc<"connectedAccounts"> }> {
  const account: Doc<"connectedAccounts"> | null = await ctx.runQuery(internal.connectedAccounts.cipherFor, { accountId });
  if (!account) throw new Error("That account isn't connected any more.");
  const stale = account.expiresAt !== undefined && account.expiresAt - 60_000 < Date.now();
  if (!stale) return { token: await decryptSecret(account.accessCipher), account };
  if (!account.refreshCipher) {
    await ctx.runMutation(internal.connectedAccounts.noteError, { accountId, error: "Connect it again — it has expired." });
    throw new Error("The connection has expired. Connect the account again.");
  }
  let tokens: Tokens;
  try {
    tokens = await PLATFORMS[account.provider].refresh(await decryptSecret(account.refreshCipher));
  } catch {
    await ctx.runMutation(internal.connectedAccounts.noteError, { accountId, error: "Connect it again — it has expired." });
    throw new Error("The connection has expired. Connect the account again.");
  }
  await ctx.runMutation(internal.connectedAccounts.storeTokens, {
    accountId,
    accessCipher: await encryptSecret(tokens.accessToken),
    refreshCipher: tokens.refreshToken ? await encryptSecret(tokens.refreshToken) : undefined,
    expiresAt: tokens.expiresAt,
  });
  return { token: tokens.accessToken, account };
}

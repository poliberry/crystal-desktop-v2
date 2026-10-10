import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireCommunity } from "./communities";
import { MANAGE_INTEGRATIONS, audit, loadActing, permissionsIn, removeInstall } from "./lib/botAccess";
import {
  BOT_LIMITS,
  BOT_PERMISSIONS,
  computeGrant,
  effectivePermissions,
  generateSigningSecret,
  generateToken,
  holds,
  lostFromAuthoriser,
  validateBotName,
  validateCommands,
  validateRequest,
} from "./lib/botAuth";
import { canReceive, newEvent, sendToBot } from "./lib/botEvents";
import { applyPlan, approvePending, checkBio } from "./lib/botProfile";
import { planBotUpdate } from "./lib/listingUpdate";
import { checkRedirectUris, redirectAllowed } from "./lib/oauthLinks";
import { assertPanelUrl } from "./lib/panelClient";
import { creationFolder } from "./lib/r2";
import { encryptSecret } from "./lib/secrets";
import { PERMISSIONS, getBasePermissions, getChannelPermissions } from "./permissions";
import { audit as staffAudit, requireStaff } from "./lib/staff";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

/**
 * Bots, from the point of view of people: an author making and managing their bot, and a
 * community manager adding one, deciding what it may do, and taking it out again.
 *
 * What a bot may do is decided in `lib/botAuth.ts` (the rules) and enforced for every action in
 * `lib/botAccess.ts` (applied to the live database). This file is where a person acts on those
 * rules, so it is where "you can only give a bot what you hold yourself" is checked.
 */

// --- Helpers ------------------------------------------------------------------------------------

/** Whether an install screen should promise events: a bot with an endpoint is pushed to, one without collects them itself. Only a stopped or switched-off bot won't hear. */
const hearsEvents = (bot: Doc<"bots">) => !bot.suspendedAt && !bot.eventsDisabledAt;

async function requireIntegrationsManager(ctx: QueryCtx, community: Doc<"communities">, userId: Id<"users">): Promise<number> {
  const base = await getBasePermissions(ctx, community, userId);
  if (!holds(base, MANAGE_INTEGRATIONS)) throw new Error("You need the Manage Integrations permission to do that.");
  return base;
}

/** The avatar has to be one the author uploaded through Crystal, on our CDN, in their own folder. */
function botImageUrl(url: string, clerkId: string): string {
  const base = (process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "").replace(/\/$/, "");
  if (!base) throw new Error("Uploads aren't available right now.");
  if (!url.startsWith(`${base}/${creationFolder(clerkId)}`) || url.length > 500) throw new Error("Upload the picture through Crystal first.");
  return url;
}

function endpoint(url: string): string {
  if (url.length > 300) throw new Error("That address is too long.");
  assertPanelUrl(url);
  return new URL(url.trim()).href;
}

async function freshUsername(ctx: MutationCtx, name: string): Promise<string> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "bot";
  for (let i = 0; i < 20; i++) {
    const candidate = `${slug}-bot${i === 0 ? "" : `-${Math.floor(Math.random() * 9000 + 1000)}`}`;
    const taken = await ctx.db.query("users").withIndex("by_username", (q) => q.eq("username", candidate)).unique();
    if (!taken) return candidate;
  }
  return `${slug}-bot-${Date.now()}`;
}

async function uniqueToken(ctx: MutationCtx) {
  for (let i = 0; i < 8; i++) {
    const t = await generateToken();
    const clash = await ctx.db.query("bots").withIndex("by_token_prefix", (q) => q.eq("tokenPrefix", t.prefix)).first();
    if (!clash) return t;
  }
  throw new Error("Couldn't make a token. Try again.");
}

async function ownBot(ctx: QueryCtx, botId: Id<"bots">, userId: Id<"users">): Promise<Doc<"bots">> {
  const bot = await ctx.db.get(botId);
  if (!bot || bot.ownerId !== userId) throw new Error("That bot isn't yours.");
  return bot;
}

// --- An author's own bots -----------------------------------------------------------------------

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const bots = await ctx.db.query("bots").withIndex("by_owner", (q) => q.eq("ownerId", me._id)).collect();
    return Promise.all(
      bots.map(async (b) => ({
        id: b._id,
        name: b.name,
        description: b.description,
        imageUrl: b.imageUrl ?? null,
        visibility: b.visibility,
        endpointUrl: b.endpointUrl ?? null,
        permissions: b.permissions,
        scopes: b.scopes,
        commands: b.commands,
        redirectUris: b.redirectUris ?? [],
        suspended: !!b.suspendedAt,
        suspendedReason: b.suspendedReason ?? null,
        /** A change to the public listing waiting for review, and what staff said about the last one. */
        bio: (await ctx.db.get(b.userId))?.bio ?? "",
        bannerUrl: (await ctx.db.get(b.userId))?.bannerUrl ?? null,
        pending: b.pending ?? null,
        lastReview: b.lastReview ?? null,
        eventsDisabled: !!b.eventsDisabledAt,
        consecutiveFailures: b.consecutiveFailures,
        lastDelivery: b.lastDelivery ?? null,
        tokenRotatedAt: b.tokenRotatedAt,
        installCount: (await ctx.db.query("botInstalls").withIndex("by_bot", (q) => q.eq("botId", b._id)).collect()).length,
        createdAt: b.createdAt,
      })),
    );
  },
});

const botFields = {
  description: v.optional(v.string()),
  imageUrl: v.optional(v.union(v.string(), v.null())),
  /** The line on the bot's profile card, and the picture across its top. */
  bio: v.optional(v.string()),
  bannerUrl: v.optional(v.union(v.string(), v.null())),
  visibility: v.optional(v.union(v.literal("private"), v.literal("public"))),
  permissions: v.optional(v.number()),
  scopes: v.optional(v.array(v.string())),
  commands: v.optional(v.array(v.object({ name: v.string(), description: v.string() }))),
  endpointUrl: v.optional(v.union(v.string(), v.null())),
  redirectUris: v.optional(v.array(v.string())),
};

function checkDescription(text: string, visibility: "private" | "public"): string {
  const d = text.trim();
  if (d.length > BOT_LIMITS.descriptionChars) throw new Error(`The description is up to ${BOT_LIMITS.descriptionChars} characters.`);
  if (visibility === "public" && d.length < 10) throw new Error("A public bot needs a description, so people know what they're adding.");
  return d;
}

/**
 * Make a bot. Returns its token and signing secret — the only time either is shown. The token is
 * what the bot authenticates with; the signing secret is how it knows an event really came from
 * Crystal.
 */
export const create = mutation({
  args: { name: v.string(), ...botFields },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const owned = await ctx.db.query("bots").withIndex("by_owner", (q) => q.eq("ownerId", me._id)).collect();
    if (owned.length >= BOT_LIMITS.botsPerUser) throw new Error(`You can have up to ${BOT_LIMITS.botsPerUser} bots.`);

    const name = validateBotName(args.name);
    // Asking to be public is a request: the bot is made private and the listing waits for review.
    const wantsPublic = args.visibility === "public";
    const visibility = "private" as const;
    const request = validateRequest(args.permissions ?? 0, args.scopes ?? []);
    const commands = validateCommands(args.commands ?? []);
    const imageUrl = args.imageUrl ? botImageUrl(args.imageUrl, me.clerkId) : undefined;
    const url = args.endpointUrl ? endpoint(args.endpointUrl) : undefined;
    const description = checkDescription(args.description ?? "", wantsPublic ? "public" : "private");
    const bio = checkBio(args.bio ?? "");
    const bannerUrl = args.bannerUrl ? botImageUrl(args.bannerUrl, me.clerkId) : undefined;

    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: `bot:${crypto.randomUUID()}`,
      isBot: true,
      name,
      username: await freshUsername(ctx, name),
      imageUrl,
      ...(bio ? { bio } : {}),
      ...(bannerUrl ? { bannerUrl } : {}),
    });
    const token = await uniqueToken(ctx);
    const signingSecret = generateSigningSecret();
    const botId = await ctx.db.insert("bots", {
      ownerId: me._id,
      userId,
      name,
      description,
      imageUrl,
      visibility,
      ...(wantsPublic ? { pending: { name, description, imageUrl, bio, bannerUrl, makePublic: true, submittedAt: now } } : {}),
      tokenPrefix: token.prefix,
      tokenHash: token.hash,
      tokenRotatedAt: now,
      signingSecret: await encryptSecret(signingSecret),
      endpointUrl: url,
      permissions: request.permissions,
      scopes: request.scopes,
      commands,
      redirectUris: args.redirectUris ? checkRedirectUris(args.redirectUris) : undefined,
      consecutiveFailures: 0,
      createdAt: now,
      updatedAt: now,
    });
    await audit(ctx, { botId, actorId: me._id, action: "bot.created", ok: true });
    return { botId, token: token.token, signingSecret };
  },
});

export const update = mutation({
  args: { botId: v.id("bots"), name: v.optional(v.string()), ...botFields },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const bot = await ownBot(ctx, args.botId, me._id);
    const patch: Partial<Doc<"bots">> = { updatedAt: Date.now() };

    // Checked as asked for, then split into what applies now and what waits for review (see `planBotUpdate`).
    const account = await ctx.db.get(bot.userId);
    const plan = planBotUpdate(
      { ...bot, bio: account?.bio ?? "", bannerUrl: account?.bannerUrl },
      {
        name: args.name === undefined ? undefined : validateBotName(args.name),
        description: args.description?.trim(),
        imageUrl: args.imageUrl === undefined ? undefined : args.imageUrl ? botImageUrl(args.imageUrl, me.clerkId) : null,
        bio: args.bio === undefined ? undefined : checkBio(args.bio),
        bannerUrl: args.bannerUrl === undefined ? undefined : args.bannerUrl ? botImageUrl(args.bannerUrl, me.clerkId) : null,
        visibility: args.visibility,
      },
    );
    checkDescription(plan.wanted.description, plan.wanted.public ? "public" : "private");
    // What the bot is shown as, on the account people see. Only what has been applied: a name or bio waiting
    // for review isn't on the account until staff have read it.
    Object.assign(patch, await applyPlan(ctx, account, plan, Date.now()));
    if (args.endpointUrl !== undefined) patch.endpointUrl = args.endpointUrl ? endpoint(args.endpointUrl) : undefined;
    if (args.commands !== undefined) patch.commands = validateCommands(args.commands);
    if (args.redirectUris !== undefined) patch.redirectUris = checkRedirectUris(args.redirectUris);
    if (args.permissions !== undefined || args.scopes !== undefined) {
      const request = validateRequest(args.permissions ?? bot.permissions, args.scopes ?? bot.scopes);
      patch.permissions = request.permissions;
      patch.scopes = request.scopes;
    }
    await ctx.db.patch(bot._id, patch);

    // Asking for less takes effect everywhere at once; asking for more changes nothing anywhere
    // until a manager chooses to grant it. A bot can't talk its way into more than it was given.
    const installs = await ctx.db.query("botInstalls").withIndex("by_bot", (q) => q.eq("botId", bot._id)).collect();
    for (const install of installs) {
      const permissions = install.permissions & (patch.permissions ?? bot.permissions);
      const scopes = install.scopes.filter((s) => (patch.scopes ?? bot.scopes).includes(s));
      const changed = permissions !== install.permissions || scopes.length !== install.scopes.length;
      if (changed) {
        await ctx.db.patch(install._id, { permissions, scopes });
        await ctx.db.patch(install.roleId, { permissions });
      }
      if (patch.name !== undefined) await ctx.db.patch(install.roleId, { name: patch.name });
    }
    await audit(ctx, { botId: bot._id, actorId: me._id, action: "bot.updated", ok: true });
  },
});

/** A new token; the old one stops working at once. Shown once. */
export const rotateToken = mutation({
  args: { botId: v.id("bots") },
  handler: async (ctx, { botId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const bot = await ownBot(ctx, botId, me._id);
    const token = await uniqueToken(ctx);
    await ctx.db.patch(bot._id, { tokenPrefix: token.prefix, tokenHash: token.hash, tokenRotatedAt: Date.now() });
    await audit(ctx, { botId, actorId: me._id, action: "token.rotated", ok: true });
    return { token: token.token };
  },
});

export const rotateSigningSecret = mutation({
  args: { botId: v.id("bots") },
  handler: async (ctx, { botId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const bot = await ownBot(ctx, botId, me._id);
    const signingSecret = generateSigningSecret();
    await ctx.db.patch(bot._id, { signingSecret: await encryptSecret(signingSecret) });
    await audit(ctx, { botId, actorId: me._id, action: "signing-secret.rotated", ok: true });
    return { signingSecret };
  },
});

/** Turn delivery back on after it was switched off for failing. */
export const enableEvents = mutation({
  args: { botId: v.id("bots") },
  handler: async (ctx, { botId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const bot = await ownBot(ctx, botId, me._id);
    await ctx.db.patch(bot._id, { eventsDisabledAt: undefined, consecutiveFailures: 0 });
  },
});

export const remove = mutation({
  args: { botId: v.id("bots") },
  handler: async (ctx, { botId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const bot = await ownBot(ctx, botId, me._id);
    for (const install of await ctx.db.query("botInstalls").withIndex("by_bot", (q) => q.eq("botId", botId)).collect()) {
      await removeInstall(ctx, install, bot.userId);
    }
    // Its messages stay, written by an account that now says what it is.
    await ctx.db.patch(bot.userId, { name: "Deleted bot", imageUrl: undefined });
    for (const row of await ctx.db.query("botRate").withIndex("by_bot", (q) => q.eq("botId", botId)).collect()) await ctx.db.delete(row._id);
    await ctx.db.delete(botId);
  },
});

/** The owner behind a bot, for actions that must be the author's. */
export const ownsBot = internalQuery({
  args: { botId: v.id("bots") },
  handler: async (ctx, { botId }) => {
    const me = await getCurrentUserOrNull(ctx);
    const bot = await ctx.db.get(botId);
    return !!me && !!bot && bot.ownerId === me._id;
  },
});

/** The author's "send a test event": one signed ping to the endpoint, and what came back. */
export const sendTest = action({
  args: { botId: v.id("bots") },
  handler: async (ctx, { botId }): Promise<{ ok: boolean; status?: number; error?: string; ms: number }> => {
    if (!(await ctx.runQuery(internal.bots.ownsBot, { botId }))) throw new Error("That bot isn't yours.");
    return ctx.runAction(internal.botDelivery.ping, { botId });
  },
});

// --- Finding and adding a bot -------------------------------------------------------------------

/** What a community manager is shown before adding a bot. Only for a bot they're allowed to add. */
export const installInfo = query({
  args: { botId: v.string() },
  handler: async (ctx, { botId }) => {
    const me = await getCurrentUserOrNull(ctx);
    const id = ctx.db.normalizeId("bots", botId.trim());
    const bot = id ? await ctx.db.get(id) : null;
    if (!me || !bot || bot.suspendedAt) return null;
    if (bot.visibility !== "public" && bot.ownerId !== me._id) return null;
    const owner = await ctx.db.get(bot.ownerId);
    return {
      id: bot._id,
      name: bot.name,
      description: bot.description,
      imageUrl: bot.imageUrl ?? null,
      visibility: bot.visibility,
      owner: owner ? { name: owner.name, username: owner.username } : null,
      permissions: bot.permissions,
      scopes: bot.scopes,
      commands: bot.commands,
      canReceiveEvents: hearsEvents(bot),
    };
  },
});

/**
 * Everything the install page needs about a link, in one read: the bot, whether the link's
 * `redirect_uri` is one its author registered (the page only ever redirects to the address returned
 * here, never to what was in the link), and the communities this person may add bots to, with what
 * they hold there so ungrantable permissions are shown switched off.
 */
export async function loadAuthorizeInfo(ctx: QueryCtx, me: Doc<"users">, clientId: string, redirectUri: string | null) {
  const id = ctx.db.normalizeId("bots", clientId.trim());
  const bot = id ? await ctx.db.get(id) : null;
  if (!bot || bot.suspendedAt) return null;
  if (bot.visibility !== "public" && bot.ownerId !== me._id) return null;
  const owner = await ctx.db.get(bot.ownerId);

  const memberships = await ctx.db.query("communityMembers").withIndex("by_user", (q) => q.eq("userId", me._id)).collect();
  const communities = [];
  for (const m of memberships) {
    const community = await ctx.db.get(m.communityId);
    if (!community) continue;
    const base = await getBasePermissions(ctx, community, me._id);
    if (!holds(base, MANAGE_INTEGRATIONS)) continue;
    const installed = await ctx.db.query("botInstalls").withIndex("by_community_bot", (q) => q.eq("communityId", community._id).eq("botId", bot._id)).unique();
    communities.push({ id: community._id, name: community.name, imageUrl: community.imageUrl ?? null, myPermissions: base, installed: !!installed });
  }
  communities.sort((a, b) => a.name.localeCompare(b.name));
  return {
    bot: {
      id: bot._id,
      name: bot.name,
      description: bot.description,
      imageUrl: bot.imageUrl ?? null,
      owner: owner ? { name: owner.name, username: owner.username } : null,
      permissions: bot.permissions,
      scopes: bot.scopes,
      canReceiveEvents: hearsEvents(bot),
    },
    redirectUri: redirectAllowed(bot.redirectUris ?? [], redirectUri),
    communities,
  };
}

export const authorizeInfo = query({
  args: { clientId: v.string(), redirectUri: v.optional(v.string()) },
  handler: async (ctx, { clientId, redirectUri }) => {
    const me = await getCurrentUserOrNull(ctx);
    return me ? loadAuthorizeInfo(ctx, me, clientId, redirectUri ?? null) : null;
  },
});

export const directory = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const bots = await ctx.db.query("bots").withIndex("by_visibility", (q) => q.eq("visibility", "public")).order("desc").take(60);
    const live = bots.filter((b) => !b.suspendedAt);
    return Promise.all(
      live.map(async (b) => ({
        id: b._id,
        name: b.name,
        description: b.description,
        imageUrl: b.imageUrl ?? null,
        owner: (await ctx.db.get(b.ownerId))?.username ?? null,
        permissions: b.permissions,
        scopes: b.scopes,
        commandCount: b.commands.length,
      })),
    );
  },
});

// --- Adding, changing and removing -------------------------------------------------------------

export const install = mutation({
  args: { botId: v.id("bots"), communityId: v.id("communities"), permissions: v.number(), scopes: v.array(v.string()) },
  handler: async (ctx, { botId, communityId, permissions, scopes }): Promise<Id<"botInstalls">> => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    const base = await requireIntegrationsManager(ctx, community, me._id);

    const bot = await ctx.db.get(botId);
    if (!bot || bot.suspendedAt || (bot.visibility !== "public" && bot.ownerId !== me._id)) throw new Error("That bot isn't available.");
    const existing = await ctx.db.query("botInstalls").withIndex("by_community_bot", (q) => q.eq("communityId", communityId).eq("botId", botId)).unique();
    if (existing) throw new Error("That bot is already in this community.");
    const inCommunity = await ctx.db.query("botInstalls").withIndex("by_community", (q) => q.eq("communityId", communityId)).collect();
    if (inCommunity.length >= BOT_LIMITS.botsPerCommunity) throw new Error(`A community can have up to ${BOT_LIMITS.botsPerCommunity} bots.`);
    const banned = await ctx.db.query("communityBans").withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", bot.userId)).unique();
    if (banned) throw new Error("This bot was banned from the community.");

    // The rules: no more than it asked for, no more than a bot can hold, no more than you hold.
    const grant = computeGrant({ requested: bot.permissions, wanted: permissions, authoriserBase: base, requestedScopes: bot.scopes, wantedScopes: scopes });

    // Its role goes at the bottom, just above @everyone: it can only act on members who hold no
    // role, until a manager moves it up on purpose (which the role editor already restricts to
    // people above it).
    const roles = await ctx.db.query("roles").withIndex("by_community", (q) => q.eq("communityId", communityId)).collect();
    for (const r of roles) if (!r.isEveryone) await ctx.db.patch(r._id, { position: r.position + 1 });
    const roleId = await ctx.db.insert("roles", {
      communityId,
      name: bot.name,
      permissions: grant.permissions,
      position: 1,
      isEveryone: false,
      hoist: false,
      managedBotId: bot._id,
    });

    const now = Date.now();
    await ctx.db.insert("communityMembers", { communityId, userId: bot.userId, joinedAt: now });
    await ctx.db.insert("memberRoles", { communityId, userId: bot.userId, roleId });
    const installId = await ctx.db.insert("botInstalls", {
      botId,
      communityId,
      authorisedBy: me._id,
      permissions: grant.permissions,
      scopes: grant.scopes,
      roleId,
      installedAt: now,
      authorisedAt: now,
    });
    await audit(ctx, { botId, communityId, actorId: me._id, action: "installed", ok: true, detail: `${grant.permissions} / ${grant.scopes.join(",")}` });
    if (canReceive(bot)) await sendToBot(ctx, botId, newEvent("bot.installed", { communityId, communityName: community.name, authorisedBy: { id: me._id, username: me.username } }));
    return installId;
  },
});

/**
 * Change what an installed bot may do, or take the authorisation over.
 *
 * Giving it *less* (or the same) is always allowed to a manager and leaves the authorisation where
 * it was. Giving it *more* needs you to hold all of it, and makes the authorisation yours — the
 * bot's authority is always that of one specific person. `takeOver` does that without changing
 * anything else, which is how a bot whose authoriser has left is brought back.
 */
export const updateInstall = mutation({
  args: { installId: v.id("botInstalls"), permissions: v.number(), scopes: v.array(v.string()), takeOver: v.optional(v.boolean()) },
  handler: async (ctx, { installId, permissions, scopes, takeOver }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const install = await ctx.db.get(installId);
    if (!install) throw new Error("That bot isn't in the community any more.");
    const community = await requireCommunity(ctx, install.communityId);
    const base = await requireIntegrationsManager(ctx, community, me._id);
    const bot = await ctx.db.get(install.botId);
    if (!bot) throw new Error("That bot no longer exists.");

    const adds = (permissions & ~install.permissions) !== 0 || scopes.some((s) => !install.scopes.includes(s));
    let grant: { permissions: number; scopes: string[] };
    let authorisedBy = install.authorisedBy;
    if (adds || takeOver) {
      grant = computeGrant({ requested: bot.permissions, wanted: permissions, authoriserBase: base, requestedScopes: bot.scopes, wantedScopes: scopes });
      authorisedBy = me._id;
    } else {
      // Only taking things away: nothing to hold, but nothing may be invented either.
      if ((permissions & ~install.permissions) !== 0) throw new Error("Those permissions aren't valid.");
      grant = { permissions, scopes: [...new Set(scopes)] };
    }
    await ctx.db.patch(install._id, { permissions: grant.permissions, scopes: grant.scopes, authorisedBy, ...(authorisedBy !== install.authorisedBy ? { authorisedAt: Date.now() } : {}) });
    await ctx.db.patch(install.roleId, { permissions: grant.permissions });
    await audit(ctx, { botId: bot._id, communityId: install.communityId, actorId: me._id, action: takeOver ? "reauthorised" : "permissions.changed", ok: true, detail: `${grant.permissions} / ${grant.scopes.join(",")}` });
  },
});

export const uninstall = mutation({
  args: { installId: v.id("botInstalls") },
  handler: async (ctx, { installId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const install = await ctx.db.get(installId);
    if (!install) return;
    const community = await requireCommunity(ctx, install.communityId);
    await requireIntegrationsManager(ctx, community, me._id);
    const bot = await ctx.db.get(install.botId);
    await removeInstall(ctx, install, bot?.userId ?? me._id);
    if (bot) await audit(ctx, { botId: bot._id, communityId: install.communityId, actorId: me._id, action: "removed", ok: true });
  },
});

// --- What managers see --------------------------------------------------------------------------

/** The bots in a community, who authorised each, and whether that authority still holds. Managers only. */
export const installsFor = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    const community = await ctx.db.get(communityId);
    if (!me || !community) return null;
    const mine = await getBasePermissions(ctx, community, me._id);
    if (!holds(mine, MANAGE_INTEGRATIONS)) return null;

    const installs = await ctx.db.query("botInstalls").withIndex("by_community", (q) => q.eq("communityId", communityId)).collect();
    const rows = await Promise.all(
      installs.map(async (i) => {
        const bot = await ctx.db.get(i.botId);
        if (!bot) return null;
        const [owner, authoriser, present] = await Promise.all([
          ctx.db.get(bot.ownerId),
          ctx.db.get(i.authorisedBy),
          ctx.db.query("communityMembers").withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", i.authorisedBy)).unique(),
        ]);
        const authBase = present ? await getBasePermissions(ctx, community, i.authorisedBy) : 0;
        const lost = present ? lostFromAuthoriser(i.permissions, authBase) : i.permissions;
        return {
          installId: i._id,
          bot: { id: bot._id, name: bot.name, description: bot.description, imageUrl: bot.imageUrl ?? null, owner: owner?.username ?? null, visibility: bot.visibility, suspended: !!bot.suspendedAt },
          authorisedBy: { id: i.authorisedBy, name: authoriser?.name ?? "Unknown", username: authoriser?.username ?? "", present: !!present },
          granted: i.permissions,
          scopes: i.scopes,
          requested: bot.permissions,
          requestedScopes: bot.scopes,
          effective: present ? effectivePermissions(i.permissions, authBase) : 0,
          lost,
          needsReauthorisation: !present || lost !== 0,
          events: { configured: !!bot.endpointUrl, disabled: !!bot.eventsDisabledAt, last: bot.lastDelivery ?? null },
          installedAt: i.installedAt,
        };
      }),
    );
    return rows.filter((r): r is NonNullable<typeof r> => r !== null).sort((a, b) => a.bot.name.localeCompare(b.bot.name));
  },
});

export const activityFor = query({
  args: { communityId: v.id("communities"), limit: v.optional(v.number()) },
  handler: async (ctx, { communityId, limit }) => {
    const me = await getCurrentUserOrNull(ctx);
    const community = await ctx.db.get(communityId);
    if (!me || !community) return null;
    if (!holds(await getBasePermissions(ctx, community, me._id), MANAGE_INTEGRATIONS)) return null;
    const rows = await ctx.db.query("botAudit").withIndex("by_community_at", (q) => q.eq("communityId", communityId)).order("desc").take(Math.min(Math.max(limit ?? 40, 1), 100));
    const names = new Map<string, string>();
    return Promise.all(
      rows.map(async (r) => {
        if (!names.has(r.botId)) names.set(r.botId, (await ctx.db.get(r.botId))?.name ?? "Deleted bot");
        const actor = r.actorId ? await ctx.db.get(r.actorId) : null;
        return { id: r._id, bot: names.get(r.botId)!, actor: actor?.username ?? null, action: r.action, ok: r.ok, detail: r.detail ?? null, at: r.at };
      }),
    );
  },
});

// --- Slash commands -----------------------------------------------------------------------------

/** The commands bots in this community offer, for the composer. Any member. */
export const commandsFor = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const member = await ctx.db.query("communityMembers").withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", me._id)).unique();
    if (!member) return [];
    const installs = await ctx.db.query("botInstalls").withIndex("by_community", (q) => q.eq("communityId", communityId)).collect();
    const out: { botId: Id<"bots">; botName: string; name: string; description: string }[] = [];
    for (const i of installs) {
      const bot = await ctx.db.get(i.botId);
      if (!bot || !canReceive(bot)) continue;
      for (const c of bot.commands) out.push({ botId: bot._id, botName: bot.name, name: c.name, description: c.description });
    }
    return out;
  },
});

/**
 * Run a bot's slash command: delivered to the bot as a signed event, naming the person who ran it.
 * The person has to be able to see and post in the channel themselves, so a command can't be used
 * to reach a channel they can't. Whatever the bot then does is checked against the bot's own authority.
 */
export const invokeCommand = mutation({
  args: { channelId: v.id("channels"), command: v.string(), args: v.optional(v.string()), botId: v.optional(v.id("bots")) },
  handler: async (ctx, { channelId, command, args, botId }): Promise<{ botName: string }> => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await ctx.db.get(channelId);
    if (!channel) throw new Error("Channel not found.");
    const community = await requireCommunity(ctx, channel.communityId);
    const perms = await getChannelPermissions(ctx, community, channelId, me._id);
    if (!holds(perms, PERMISSIONS.VIEW_CHANNELS) || !holds(perms, PERMISSIONS.SEND_MESSAGES)) throw new Error("You can't use commands in this channel.");

    const name = command.trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(name)) throw new Error("That isn't a command.");
    if ((args ?? "").length > 2000) throw new Error("That's too long for a command.");

    const installs = await ctx.db.query("botInstalls").withIndex("by_community", (q) => q.eq("communityId", channel.communityId)).collect();
    const matches: Doc<"bots">[] = [];
    for (const i of installs) {
      const bot = await ctx.db.get(i.botId);
      if (bot && (!botId || bot._id === botId) && canReceive(bot) && bot.commands.some((c) => c.name === name)) matches.push(bot);
    }
    if (matches.length === 0) throw new Error(`No bot here has a /${name} command.`);
    if (matches.length > 1) throw new Error(`More than one bot has /${name}. Pick one from the list.`);
    const bot = matches[0];

    // A command into a channel the bot can't see would only fail later, quietly.
    const acting = await loadActing(ctx, bot._id, channel.communityId);
    if (!holds(await permissionsIn(ctx, acting, channelId), PERMISSIONS.VIEW_CHANNELS)) throw new Error(`${bot.name} can't see this channel.`);

    // Ten a person can fire in ten seconds is plenty.
    const recent = await ctx.db.query("botAudit").withIndex("by_actor_action_at", (q) => q.eq("actorId", me._id).eq("action", "command").gt("at", Date.now() - 10_000)).collect();
    if (recent.length >= 10) throw new Error("Slow down a little.");
    await audit(ctx, { botId: bot._id, communityId: channel.communityId, actorId: me._id, action: "command", ok: true, detail: `/${name}` });

    await sendToBot(
      ctx,
      bot._id,
      newEvent("interaction.command", {
        communityId: channel.communityId,
        channelId,
        command: name,
        args: (args ?? "").trim(),
        user: { id: me._id, username: me.username, name: me.name },
      }),
      { attempts: 3 },
    );
    return { botName: bot.name };
  },
});

/** What a bot can be asked for, in the words the consent screen uses — one copy, here, so the screen can't drift from the rules. */
export const catalogue = query({
  args: {},
  handler: async () => BOT_PERMISSIONS.map((p) => ({ key: p.key, bit: p.bit, label: p.label, description: p.description, risk: p.risk })),
});

// --- Buttons ------------------------------------------------------------------------------------

/**
 * Someone pressed a button on a bot's message. Delivered to the bot that wrote the message as a
 * signed `interaction.button` event naming the person, the message and the button's customId; what
 * happens next is the bot's to decide (it answers through the Bot API like anything else).
 *
 * The press has to be real: the person must be able to see and post in the channel, the button
 * has to exist on that message and not be disabled, and the message has to be a bot's that is
 * still in the community. A person can press about once every second and a half.
 */
export const pressButton = mutation({
  args: { messageId: v.id("channelMessages"), customId: v.string() },
  handler: async (ctx, { messageId, customId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("That message is gone.");
    const channel = await ctx.db.get(message.channelId);
    if (!channel) throw new Error("That channel is gone.");
    const community = await requireCommunity(ctx, channel.communityId);
    const perms = await getChannelPermissions(ctx, community, channel._id, me._id);
    if (!holds(perms, PERMISSIONS.VIEW_CHANNELS) || !holds(perms, PERMISSIONS.SEND_MESSAGES)) throw new Error("You can't use buttons in this channel.");

    const button = message.components?.flatMap((r) => r.buttons).find((b) => b.customId === customId);
    if (!button || button.style === "link" || button.disabled) throw new Error("That button isn't available.");

    const bot = await ctx.db.query("bots").withIndex("by_user", (q) => q.eq("userId", message.authorId)).unique();
    if (!bot || !canReceive(bot)) throw new Error("The bot behind this button isn't listening right now.");
    const install = await ctx.db.query("botInstalls").withIndex("by_community_bot", (q) => q.eq("communityId", channel.communityId).eq("botId", bot._id)).unique();
    if (!install) throw new Error("That bot is no longer in this community.");

    const recent = await ctx.db.query("botAudit").withIndex("by_actor_action_at", (q) => q.eq("actorId", me._id).eq("action", "button").gt("at", Date.now() - 1500)).first();
    if (recent) throw new Error("Slow down a little.");
    await audit(ctx, { botId: bot._id, communityId: channel.communityId, actorId: me._id, action: "button", ok: true, detail: customId.slice(0, 80) });

    await sendToBot(
      ctx,
      bot._id,
      newEvent("interaction.button", {
        communityId: channel.communityId,
        channelId: channel._id,
        messageId,
        customId,
        user: { id: me._id, username: me.username, name: me.name },
      }),
      { attempts: 3 },
    );
    return { ok: true };
  },
});

// --- Review of a bot's public listing -----------------------------------------------------------------

/** Bots whose public listing — or request to be listed — is waiting to be read. */
export const adminPendingListings = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx, "system.manage");
    const bots = (await ctx.db.query("bots").order("desc").take(500)).filter((b) => b.pending);
    return Promise.all(
      bots.map(async (b) => {
        const owner = await ctx.db.get(b.ownerId);
        return {
          id: b._id,
          owner: owner?.username ?? "unknown",
          live: { name: b.name, description: b.description, imageUrl: b.imageUrl ?? null, bio: (await ctx.db.get(b.userId))?.bio ?? "", bannerUrl: (await ctx.db.get(b.userId))?.bannerUrl ?? null, visibility: b.visibility },
          pending: b.pending!,
          permissions: b.permissions,
          scopes: b.scopes,
          commands: b.commands,
          installCount: (await ctx.db.query("botInstalls").withIndex("by_bot", (q) => q.eq("botId", b._id)).collect()).length,
        };
      }),
    );
  },
});

/** Approve or turn down a bot's pending listing. Approving puts the new name, description and picture live (and in the public list, if that was asked for). */
export const adminReviewListing = mutation({
  args: { botId: v.id("bots"), approve: v.boolean(), note: v.string() },
  handler: async (ctx, { botId, approve, note }) => {
    const staff = await requireStaff(ctx, "system.manage");
    const bot = await ctx.db.get(botId);
    if (!bot?.pending) throw new Error("That bot has nothing waiting for review.");
    const reason = note.trim().slice(0, 500);
    if (!approve && reason.length < 3) throw new Error("Tell the author why, so they can fix it.");
    const now = Date.now();
    if (approve) {
      const next = await approvePending(ctx, await ctx.db.get(bot.userId), bot.pending);
      await ctx.db.patch(botId, { name: next.name, description: next.description, imageUrl: next.imageUrl, visibility: "public", pending: undefined, lastReview: { ok: true, note: reason || undefined, at: now }, updatedAt: now });
      const installs = await ctx.db.query("botInstalls").withIndex("by_bot", (q) => q.eq("botId", botId)).collect();
      for (const i of installs) await ctx.db.patch(i.roleId, { name: next.name });
    } else {
      await ctx.db.patch(botId, { pending: undefined, lastReview: { ok: false, note: reason, at: now }, updatedAt: now });
    }
    await staffAudit(ctx, staff.user._id, approve ? "bot.listing.approve" : "bot.listing.reject", { type: "bot", id: botId }, `${bot.pending.name}${reason ? ` — ${reason}` : ""}`);
  },
});

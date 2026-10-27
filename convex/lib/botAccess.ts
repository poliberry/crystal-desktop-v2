import { ConvexError } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { PERMISSIONS, getChannelPermissions } from "../permissions";
import { BOT_RATE, effectivePermissions, holds } from "./botAuth";

/**
 * What a bot may do right now, worked out from the database. Everything the Bot API does starts
 * here: `loadActing` establishes that the bot is really installed and in the community, and
 * `permissionsIn` says what the bot's own managed role allows in a particular channel.
 */

/** An error with an HTTP status, so the Bot API can answer properly. People never see these text-for-text. */
export class BotApiError extends ConvexError<{ status: number; message: string }> {
  constructor(status: number, message: string) {
    super({ status, message });
  }
}

export const fail = (status: number, message: string): never => {
  throw new BotApiError(status, message);
};

export interface Acting {
  bot: Doc<"bots">;
  botUser: Doc<"users">;
  install: Doc<"botInstalls">;
  community: Doc<"communities">;
}

/**
 * The bot and the community it is acting in — or an error saying why it has none.
 */
export async function loadActing(ctx: QueryCtx, botId: Id<"bots">, communityId: Id<"communities">): Promise<Acting> {
  const bot = await ctx.db.get(botId);
  if (!bot) return fail(401, "Unknown bot.");
  if (bot.suspendedAt) return fail(403, "This bot has been suspended.");
  const community = await ctx.db.get(communityId);
  if (!community) return fail(404, "That community doesn't exist.");
  const install = await ctx.db
    .query("botInstalls")
    .withIndex("by_community_bot", (q) => q.eq("communityId", communityId).eq("botId", botId))
    .unique();
  if (!install) return fail(403, "This bot hasn't been added to that community.");
  const botUser = await ctx.db.get(bot.userId);
  if (!botUser) return fail(401, "Unknown bot.");
  const member = await ctx.db
    .query("communityMembers")
    .withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", bot.userId))
    .unique();
  if (!member) return fail(403, "This bot was removed from that community.");

  return { bot, botUser, install, community };
}

/**
 * What the bot can do in one channel: the channel's own rules for its account, cut down to what
 * it was explicitly granted (so a default `@everyone` permission doesn't quietly become a bot's),
 * and never to another member's permissions.
 */
export async function permissionsIn(ctx: QueryCtx, acting: Acting, channelId: Id<"channels">): Promise<number> {
  const channel = await ctx.db.get(channelId);
  if (!channel || channel.communityId !== acting.community._id) return fail(404, "That channel doesn't exist in this community.");
  const here = await getChannelPermissions(ctx, acting.community, channelId, acting.bot.userId);
  return effectivePermissions(here & acting.install.permissions);
}

/** Community-wide: the grant on the bot's managed role. */
export function communityPermissions(acting: Acting): number {
  return effectivePermissions(acting.install.permissions);
}

export function requirePermission(perms: number, bit: number, what: string): void {
  if (!holds(perms, bit)) fail(403, `This bot isn't allowed to ${what} here.`);
}

export function requireScope(acting: Acting, scope: string): void {
  if (!acting.install.scopes.includes(scope)) fail(403, `This bot hasn't been given access to ${scope}.`);
}

// --- Audit and rate limits ----------------------------------------------------------------------

const AUDIT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** Record something a bot did (or was refused), or that a person did about one. Old rows are swept as new ones are written. */
export async function audit(
  ctx: MutationCtx,
  entry: { botId: Id<"bots">; communityId?: Id<"communities">; actorId?: Id<"users">; action: string; ok: boolean; detail?: string },
): Promise<void> {
  const now = Date.now();
  await ctx.db.insert("botAudit", { ...entry, detail: entry.detail?.slice(0, 300), at: now });
  const old = await ctx.db
    .query("botAudit")
    .withIndex("by_bot_at", (q) => q.eq("botId", entry.botId).lt("at", now - AUDIT_KEEP_MS))
    .take(5);
  for (const row of old) await ctx.db.delete(row._id);
}

export const RATE = BOT_RATE;

/** Count a request against the bot's minute, and refuse it once the minute's allowance is spent. */
export async function spendRate(ctx: MutationCtx, botId: Id<"bots">, kind: "request" | "send"): Promise<void> {
  const now = Date.now();
  const windowStart = now - (now % 60_000);
  const rows = await ctx.db.query("botRate").withIndex("by_bot", (q) => q.eq("botId", botId)).collect();
  let row = rows.find((r) => r.windowStart === windowStart);
  // Anything older than this minute is done with.
  for (const r of rows) if (r.windowStart < windowStart) await ctx.db.delete(r._id);
  if (!row) {
    const id = await ctx.db.insert("botRate", { botId, windowStart, requests: 0, sends: 0 });
    row = (await ctx.db.get(id))!;
  }
  if (kind === "request" && row.requests >= RATE.requestsPerMinute) return fail(429, "Slow down: too many requests this minute.");
  if (kind === "send" && row.sends >= RATE.sendsPerMinute) return fail(429, "Slow down: too many messages this minute.");
  await ctx.db.patch(row._id, kind === "request" ? { requests: row.requests + 1 } : { sends: row.sends + 1 });
}

// --- Removal ------------------------------------------------------------------------------------

/** Remove a bot from its voice channels, in LiveKit as well as in the channel's list of who is there. Does nothing for a person. */
export async function evictBotFromVoice(ctx: MutationCtx, userId: Id<"users">, channelIds?: Id<"channels">[]): Promise<void> {
  const user = await ctx.db.get(userId);
  if (!user?.isBot) return;
  const rows = await ctx.db.query("channelCallParticipants").collect();
  for (const row of rows) {
    if (row.userId !== userId || (channelIds && !channelIds.includes(row.channelId))) continue;
    await ctx.db.delete(row._id);
    await ctx.scheduler.runAfter(0, internal.botVoice.evict, { channelId: row.channelId, identity: userId });
  }
}

/**
 * Take a bot out of a community: its role, anything that role or the bot's account was given in
 * channels, its membership, and the install itself. Used when a manager removes it, when its
 * author deletes it, and when the community is deleted.
 */
export async function removeInstall(ctx: MutationCtx, install: Doc<"botInstalls">, botUserId: Id<"users">): Promise<void> {
  const { communityId, roleId } = install;
  // Out of this community's voice channels first, so it isn't left talking in one it no longer belongs to.
  const here = await ctx.db.query("channels").withIndex("by_community", (q) => q.eq("communityId", communityId)).collect();
  await evictBotFromVoice(ctx, botUserId, here.map((c) => c._id));
  for (const row of await ctx.db.query("memberRoles").withIndex("by_member", (q) => q.eq("communityId", communityId).eq("userId", botUserId)).collect()) {
    await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db.query("memberRoles").withIndex("by_role", (q) => q.eq("roleId", roleId)).collect()) {
    await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db.query("channelPermissionOverwrites").collect()) {
    if (row.roleId === roleId || row.userId === botUserId) await ctx.db.delete(row._id);
  }
  await ctx.db.delete(roleId).catch(() => undefined);
  const member = await ctx.db
    .query("communityMembers")
    .withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", botUserId))
    .unique();
  if (member) await ctx.db.delete(member._id);
  await ctx.db.delete(install._id);
}

/** A bot's own account has no right to anything a person can do outside what its install allows. */
export const MANAGE_INTEGRATIONS = PERMISSIONS.MANAGE_INTEGRATIONS;

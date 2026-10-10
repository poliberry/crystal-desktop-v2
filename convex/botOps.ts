import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  deleteChannelMessage,
  editChannelMessage,
  sendChannelMessage,
  setChannelReaction,
} from "./channelMessages";
import { createChannelRow, deleteChannelCascade } from "./channels";
import { disconnectFromAllVoice, freshInviteCode, removeMembership } from "./communities";
import { dmKeyFor } from "./conversations";
import { describeMessage, fireChannelEvent, fireVoiceEvent } from "./lib/botEvents";
import { BotApiError, audit, communityPermissions, fail, loadActing, permissionsIn, requirePermission, requireScope, spendRate, type Acting } from "./lib/botAccess";
import { applyPlan, checkBio } from "./lib/botProfile";
import { planBotUpdate } from "./lib/listingUpdate";
import { BOT_IMAGE_BYTES, BOT_LIMITS, BOT_MESSAGE, constantTimeEqual, grantableToRole, holds, isBelow, validateCommands } from "./lib/botAuth";
import { visibleActivities } from "./lib/activities";
import { validateComponents } from "./lib/components";
import { validateEmbeds } from "./lib/embeds";
import { notifyUsers } from "./notifications";
import { applyBotPresence, type BotActivity, type BotStatus } from "./presence";
import { PERMISSIONS, getBasePermissions, getHighestRolePosition, requireAbove } from "./permissions";
import { MAX_SOUND_BYTES } from "./uploadLimits";
import { effectiveFileType } from "./lib/mediaType";

/**
 * Every Bot API operation, run as ONE transaction per request: authenticate → count → check → act →
 * audit. `botHttp.ts` only turns an HTTP request into a call to `execute` and the answer back into
 * HTTP; what a bot may do is decided here and in `lib/botAccess.ts`, from the database, every time.
 *
 * Two rules every operation follows:
 *  1. **Check everything, then write.** A refusal is a `BotApiError` that is caught below so it can
 *     still be audited; that commits whatever was written before it. So no operation writes before
 *     its last check.
 *  2. **Powers that make things are bounded by the bot's own.** A role or an overwrite can only
 *     carry permissions the bot holds (`grantableToRole`), roles it touches are below its own, and
 *     moderation only reaches members below it. `communityPermissions` is already the bot's grant
 *     cut down to what the member who authorised it can still do.
 */

type Json = Record<string, unknown>;
interface Req {
  botId: Id<"bots">;
  params: Record<string, string>;
  body: Json;
  query: Record<string, string>;
}
interface Out {
  status?: number;
  data: unknown;
}
type Handler = (ctx: MutationCtx, req: Req) => Promise<Out>;

// --- Small helpers -------------------------------------------------------------------------------

type IdTable = "channels" | "communities" | "channelMessages" | "users" | "roles" | "communityEmojis" | "communitySounds" | "channelCategories";

function ident<T extends IdTable>(ctx: QueryCtx, table: T, raw: unknown, what = "That"): Id<T> {
  const id = typeof raw === "string" ? ctx.db.normalizeId(table, raw) : null;
  if (!id) return fail(404, `${what} wasn't found.`);
  return id;
}

// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/g;

function text(b: Json, key: string, opts: { max: number; min?: number; required?: boolean; trim?: boolean } = { max: 1000 }): string | undefined {
  const v0 = b[key];
  if (v0 === undefined || v0 === null) return opts.required ? fail(400, `\`${key}\` is required.`) : undefined;
  if (typeof v0 !== "string") return fail(400, `\`${key}\` has to be text.`);
  const s = (opts.trim === false ? v0 : v0.trim()).replace(CTRL, "");
  if (s.length < (opts.min ?? (opts.required ? 1 : 0))) return fail(400, `\`${key}\` is too short.`);
  if (s.length > opts.max) return fail(400, `\`${key}\` is up to ${opts.max} characters.`);
  return s;
}

function int(b: Json, key: string, opts: { min: number; max: number; required?: boolean }): number | undefined {
  const v0 = b[key];
  if (v0 === undefined || v0 === null) return opts.required ? fail(400, `\`${key}\` is required.`) : undefined;
  if (typeof v0 !== "number" || !Number.isInteger(v0) || v0 < opts.min || v0 > opts.max) return fail(400, `\`${key}\` has to be a whole number from ${opts.min} to ${opts.max}.`);
  return v0;
}

/** Validation errors from the shared validators are the caller's mistake: 400, not a crash. */
function valid<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : "That isn't valid.");
  }
}

async function community(ctx: MutationCtx, req: Req): Promise<Acting> {
  return loadActing(ctx, req.botId, ident(ctx, "communities", req.params.communityId, "That community"));
}

async function inChannel(ctx: MutationCtx, req: Req): Promise<{ acting: Acting; channel: Doc<"channels">; perms: number }> {
  const channel = await ctx.db.get(ident(ctx, "channels", req.params.channelId, "That channel"));
  if (!channel) return fail(404, "That channel wasn't found.");
  const acting = await loadActing(ctx, req.botId, channel.communityId);
  const perms = await permissionsIn(ctx, acting, channel._id);
  // A channel the bot can't see doesn't exist, as far as it is concerned.
  if (!holds(perms, PERMISSIONS.VIEW_CHANNELS)) return fail(404, "That channel wasn't found.");
  return { acting, channel, perms };
}

async function messageIn(ctx: MutationCtx, channel: Doc<"channels">, raw: string): Promise<Doc<"channelMessages">> {
  const message = await ctx.db.get(ident(ctx, "channelMessages", raw, "That message"));
  if (!message || message.channelId !== channel._id) return fail(404, "That message wasn't found.");
  return message;
}

const botRank = (ctx: QueryCtx, a: Acting) => getHighestRolePosition(ctx, a.community._id, a.bot.userId);

/** A person the bot acts on: a member, below the bot, never the owner, another bot or itself. */
async function memberBelow(ctx: MutationCtx, acting: Acting, raw: string, opts: { allowNonMember?: boolean } = {}): Promise<Id<"users">> {
  const target = ident(ctx, "users", raw, "That person");
  const user = await ctx.db.get(target);
  if (!user) return fail(404, "That person wasn't found.");
  const member = await ctx.db.query("communityMembers").withIndex("by_community_user", (q) => q.eq("communityId", acting.community._id).eq("userId", target)).unique();
  if (!member && !opts.allowNonMember) return fail(404, "That person isn't in this community.");
  if (user.isBot) return fail(403, "Bots are removed from the community's Bots settings.");
  try {
    await requireAbove(ctx, acting.community, acting.bot.userId, target);
  } catch (e) {
    return fail(403, e instanceof Error ? e.message : "This bot can't do that to them.");
  }
  return target;
}

/** A role the bot is allowed to touch: in this community, not @everyone, not a bot's own, and below the bot's. */
async function roleBelow(ctx: MutationCtx, acting: Acting, raw: string): Promise<Doc<"roles">> {
  const role = await ctx.db.get(ident(ctx, "roles", raw, "That role"));
  if (!role || role.communityId !== acting.community._id) return fail(404, "That role wasn't found.");
  if (role.isEveryone) return fail(403, "The @everyone role can't be changed this way.");
  if (role.managedBotId) return fail(403, "A bot's role is changed in the community's Bots settings.");
  if (!isBelow(role.position, await botRank(ctx, acting))) return fail(403, "That role is at or above the bot's own role.");
  return role;
}

const userBrief = (u: Doc<"users"> | null) => (u ? { id: u._id, username: u.username, name: u.name, isBot: !!u.isBot } : null);

/** What a checked upload is, and what it may be used for. A ticket is for a few minutes, so an old storage id can't be reused. */
async function checkedUpload(ctx: MutationCtx, raw: unknown, opts: { types: RegExp; maxBytes: number; what: string }): Promise<{ id: Id<"_storage">; size: number; contentType: string }> {
  const id = typeof raw === "string" ? ctx.db.system.normalizeId("_storage", raw) : null;
  if (!id) return fail(404, "That upload wasn't found. Upload the file first, then use its storageId.");
  const meta = await ctx.db.system.get(id);
  if (!meta) return fail(404, "That upload wasn't found. Upload the file first, then use its storageId.");
  if (Date.now() - meta._creationTime > 30 * 60_000) return fail(400, "That upload is too old to use. Upload it again.");
  if (!meta.contentType || !opts.types.test(meta.contentType)) return fail(400, `${opts.what} has to be one of: ${opts.types.source.replace(/[\^$()]/g, "")}.`);
  if (meta.size > opts.maxBytes) return fail(400, `${opts.what} is over ${Math.round(opts.maxBytes / 1024)} KB.`);
  return { id, size: meta.size, contentType: meta.contentType };
}

const MENTIONS_EVERYONE = /<@&[a-z0-9]+>|@(everyone|here)\b/i;
const BOT_FILE_BYTES = BOT_MESSAGE.fileBytes;

// --- Operations ---------------------------------------------------------------------------------

const ops: Record<string, Handler> = {
  // ---- identity, presence, profile ----
  async me(ctx, { botId }) {
    const bot = await ctx.db.get(botId);
    if (!bot) return fail(401, "Unknown bot.");
    const user = await ctx.db.get(bot.userId);
    const installs = await ctx.db.query("botInstalls").withIndex("by_bot", (q) => q.eq("botId", botId)).collect();
    const communities = await Promise.all(
      installs.map(async (i) => {
        const c = await ctx.db.get(i.communityId);
        let active = true;
        let reason: string | null = null;
        let effective = 0;
        try {
          effective = communityPermissions(await loadActing(ctx, botId, i.communityId));
        } catch (e) {
          active = false;
          reason = e instanceof BotApiError ? e.data.message : "Unavailable.";
        }
        return { id: i.communityId, name: c?.name ?? "", granted: i.permissions, effective, scopes: i.scopes, active, reason };
      }),
    );
    return { data: { id: bot._id, userId: bot.userId, username: user?.username ?? "", name: bot.name, bio: user?.bio ?? null, imageUrl: user?.imageUrl ?? null, communities } };
  },

  async "presence.set"(ctx, { botId, body }) {
    const bot = await ctx.db.get(botId);
    if (!bot) return fail(401, "Unknown bot.");
    let status: BotStatus | undefined;
    if (body.status !== undefined) {
      if (!["online", "idle", "dnd", "invisible"].includes(String(body.status))) return fail(400, "`status` is online, idle, dnd or invisible.");
      status = body.status as BotStatus;
    }
    let activities: BotActivity[] | undefined;
    if (body.activities !== undefined) {
      if (!Array.isArray(body.activities) || body.activities.length > 3) return fail(400, "`activities` is a list of up to 3.");
      activities = body.activities.map((a: unknown, i) => {
        const o = (a && typeof a === "object" ? a : {}) as Json;
        if (!["playing", "listening", "watching", "streaming"].includes(String(o.type))) return fail(400, `Activity ${i + 1} needs a type: playing, listening, watching or streaming.`);
        const name = text(o, "name", { max: 128, required: true })!;
        const out: BotActivity = { type: o.type as BotActivity["type"], name, startedAt: Date.now() };
        const details = text(o, "details", { max: 128 });
        const state = text(o, "state", { max: 128 });
        if (details) out.details = details;
        if (state) out.state = state;
        return out;
      });
    }
    const patch: Partial<Doc<"users">> = {};
    if (body.customStatus !== undefined) {
      if (body.customStatus === null || body.customStatus === "") {
        patch.customStatus = undefined;
        patch.customStatusExpiresAt = undefined;
      } else patch.customStatus = text(body, "customStatus", { max: 128 });
    }
    if (Object.keys(patch).length) await ctx.db.patch(bot.userId, patch);
    await applyBotPresence(ctx, bot.userId, { status, activities });
    return { data: { ok: true } };
  },

  async "presence.get"(ctx, { botId, params }) {
    const target = ident(ctx, "users", params.userId, "That person");
    const installs = await ctx.db.query("botInstalls").withIndex("by_bot", (q) => q.eq("botId", botId)).collect();
    let shared = false;
    for (const i of installs) {
      if (!i.scopes.includes("members.read")) continue;
      const m = await ctx.db.query("communityMembers").withIndex("by_community_user", (q) => q.eq("communityId", i.communityId).eq("userId", target)).unique();
      if (m) {
        shared = true;
        break;
      }
    }
    if (!shared) return fail(404, "That person wasn't found.");
    const [presence, user] = await Promise.all([ctx.db.query("presence").withIndex("by_user", (q) => q.eq("userId", target)).unique(), ctx.db.get(target)]);
    return { data: { status: presence?.effective ?? "offline", activities: visibleActivities(presence, user).map((a) => ({ type: a.type, name: a.name, details: a.details ?? null, state: a.state ?? null })), customStatus: user?.customStatus ?? null } };
  },

  async "profile.update"(ctx, { botId, body }) {
    const bot = await ctx.db.get(botId);
    if (!bot) return fail(401, "Unknown bot.");
    if (body.bio === undefined && body.avatarStorageId === undefined) return fail(400, "Nothing to change. Send `bio` and/or `avatarStorageId`.");
    const account = await ctx.db.get(bot.userId);
    const bio = body.bio === undefined ? undefined : body.bio === null ? "" : valid(() => checkBio(text(body, "bio", { max: BOT_LIMITS.bioChars }) ?? ""));
    let avatar: { id: Id<"_storage">; url: string } | undefined;
    if (body.avatarStorageId !== undefined) {
      const up = await checkedUpload(ctx, body.avatarStorageId, { types: /^image\/(png|jpeg|webp|gif)$/, maxBytes: BOT_IMAGE_BYTES.avatar, what: "An avatar" });
      const url = await ctx.storage.getUrl(up.id);
      if (!url) return fail(500, "The upload couldn't be read.");
      avatar = { id: up.id, url };
    }
    // The same rule as a change made in Studio: what a public bot's profile shows is reviewed, so a bot can't
    // change its own avatar or bio through the API and so get round it.
    const plan = planBotUpdate({ ...bot, bio: account?.bio ?? "", bannerUrl: account?.bannerUrl }, { bio, imageUrl: avatar?.url });
    const now = Date.now();
    const botPatch = await applyPlan(ctx, account, plan, now, avatar ? { avatar: avatar.id } : {});
    await ctx.db.patch(botId, { ...botPatch, updatedAt: now });
    return { data: { ok: true, pendingReview: plan.pending !== null } };
  },

  async "commands.set"(ctx, { botId, body }) {
    const commands = valid(() => validateCommands(body.commands));
    await ctx.db.patch(botId, { commands, updatedAt: Date.now() });
    return { data: { commands } };
  },

  async "upload.ticket"(ctx) {
    return { status: 201, data: { uploadUrl: await ctx.storage.generateUploadUrl(), expiresInSeconds: 600, note: "POST the file's bytes (with its Content-Type) to uploadUrl; the answer's storageId is what the other calls take. Use it within 30 minutes." } };
  },

  // ---- community ----
  async "community.get"(ctx, req) {
    const a = await community(ctx, req);
    const members = await ctx.db.query("communityMembers").withIndex("by_community", (q) => q.eq("communityId", a.community._id)).take(5001);
    return { data: { id: a.community._id, name: a.community.name, ownerId: a.community.ownerId, iconUrl: a.community.imageUrl ?? null, memberCount: Math.min(members.length, 5000), memberCountCapped: members.length > 5000, createdAt: a.community._creationTime, granted: a.install.permissions, effective: communityPermissions(a), scopes: a.install.scopes } };
  },

  async "channel.list"(ctx, req) {
    const a = await community(ctx, req);
    const all = await ctx.db.query("channels").withIndex("by_community", (q) => q.eq("communityId", a.community._id)).take(500);
    const out = [];
    for (const c of all) {
      const perms = await permissionsIn(ctx, a, c._id);
      if (!holds(perms, PERMISSIONS.VIEW_CHANNELS)) continue;
      out.push({ id: c._id, name: c.name, type: c.type, topic: c.topic ?? null, categoryId: c.categoryId ?? null, position: c.position, canSend: holds(perms, PERMISSIONS.SEND_MESSAGES) });
    }
    return { data: { channels: out } };
  },

  async "channel.get"(ctx, req) {
    const { channel, perms } = await inChannel(ctx, req);
    return { data: { id: channel._id, communityId: channel.communityId, name: channel.name, type: channel.type, topic: channel.topic ?? null, categoryId: channel.categoryId ?? null, position: channel.position, canSend: holds(perms, PERMISSIONS.SEND_MESSAGES) } };
  },

  async "channel.create"(ctx, req) {
    const a = await community(ctx, req);
    requirePermission(communityPermissions(a), PERMISSIONS.MANAGE_CHANNELS, "create channels");
    const name = text(req.body, "name", { max: 100, required: true })!;
    if (!["text", "voice"].includes(String(req.body.type ?? "text"))) return fail(400, "`type` is text or voice.");
    const type = (req.body.type ?? "text") as "text" | "voice";
    const topic = text(req.body, "topic", { max: 1024 });
    let categoryId: Id<"channelCategories"> | undefined;
    if (req.body.categoryId !== undefined && req.body.categoryId !== null) {
      categoryId = ident(ctx, "channelCategories", req.body.categoryId, "That category");
      const cat = await ctx.db.get(categoryId);
      if (!cat || cat.communityId !== a.community._id) return fail(404, "That category wasn't found.");
    }
    const existing = await ctx.db.query("channels").withIndex("by_community", (q) => q.eq("communityId", a.community._id)).take(501);
    if (existing.length >= 500) return fail(400, "A community can have up to 500 channels.");
    const id = await createChannelRow(ctx, a.community, a.bot.userId, { name, type, categoryId, topic });
    return { status: 201, data: { id } };
  },

  async "channel.update"(ctx, req) {
    const { acting, channel } = await inChannel(ctx, req);
    requirePermission(communityPermissions(acting), PERMISSIONS.MANAGE_CHANNELS, "change channels");
    const patch: { name?: string; topic?: string | undefined } = {};
    if (req.body.name !== undefined) patch.name = text(req.body, "name", { max: 100, required: true });
    if (req.body.topic !== undefined) patch.topic = req.body.topic === null ? undefined : text(req.body, "topic", { max: 1024 });
    if (Object.keys(patch).length === 0) return fail(400, "Nothing to change. Send `name` and/or `topic`.");
    await ctx.db.patch(channel._id, patch);
    const fresh = await ctx.db.get(channel._id);
    if (fresh) await fireChannelEvent(ctx, "channel.updated", fresh);
    return { data: { ok: true } };
  },

  async "channel.delete"(ctx, req) {
    const { acting, channel } = await inChannel(ctx, req);
    requirePermission(communityPermissions(acting), PERMISSIONS.MANAGE_CHANNELS, "delete channels");
    await deleteChannelCascade(ctx, channel, acting.bot.userId);
    return { data: { ok: true } };
  },

  async "overwrite.list"(ctx, req) {
    const { acting, channel } = await inChannel(ctx, req);
    requirePermission(communityPermissions(acting), PERMISSIONS.MANAGE_CHANNELS, "see a channel's permissions");
    const rows = await ctx.db.query("channelPermissionOverwrites").withIndex("by_channel", (q) => q.eq("channelId", channel._id)).collect();
    return { data: { overwrites: rows.map((o) => ({ kind: o.roleId ? "role" : "member", targetId: o.roleId ?? o.userId, allow: o.allow, deny: o.deny })) } };
  },

  async "overwrite.set"(ctx, req) {
    const { acting, channel } = await inChannel(ctx, req);
    const eff = communityPermissions(acting);
    requirePermission(eff, PERMISSIONS.MANAGE_CHANNELS, "change a channel's permissions");
    const kind = req.params.kind;
    if (kind !== "role" && kind !== "member") return fail(404, "Use /overwrites/role/:id or /overwrites/member/:id.");
    const allow = int(req.body, "allow", { min: 0, max: 0x7fffffff }) ?? 0;
    const deny = int(req.body, "deny", { min: 0, max: 0x7fffffff }) ?? 0;
    if ((allow & deny) !== 0) return fail(400, "A permission can't be both allowed and denied.");
    let roleId: Id<"roles"> | undefined;
    let userId: Id<"users"> | undefined;
    if (kind === "role") {
      roleId = ident(ctx, "roles", req.params.targetId, "That role");
      const role = await ctx.db.get(roleId);
      if (!role || role.communityId !== acting.community._id) return fail(404, "That role wasn't found.");
    } else {
      userId = ident(ctx, "users", req.params.targetId, "That person");
      const m = await ctx.db.query("communityMembers").withIndex("by_community_user", (q) => q.eq("communityId", acting.community._id).eq("userId", userId!)).unique();
      if (!m) return fail(404, "That person isn't in this community.");
    }
    const existing = (await ctx.db.query("channelPermissionOverwrites").withIndex("by_channel", (q) => q.eq("channelId", channel._id)).collect()).find((o) => (roleId ? o.roleId === roleId : o.userId === userId));
    // Only what the bot holds can be *allowed*; denying is always fine.
    const grant = grantableToRole(eff, allow, existing?.allow ?? 0);
    if (!grant.ok) return fail(403, grant.message);
    if (existing) await ctx.db.patch(existing._id, { allow, deny });
    else await ctx.db.insert("channelPermissionOverwrites", { channelId: channel._id, roleId, userId, allow, deny });
    return { data: { ok: true } };
  },

  async "overwrite.delete"(ctx, req) {
    const { acting, channel } = await inChannel(ctx, req);
    requirePermission(communityPermissions(acting), PERMISSIONS.MANAGE_CHANNELS, "change a channel's permissions");
    const kind = req.params.kind;
    const rows = await ctx.db.query("channelPermissionOverwrites").withIndex("by_channel", (q) => q.eq("channelId", channel._id)).collect();
    const hit = rows.find((o) => (kind === "role" ? o.roleId === req.params.targetId : o.userId === req.params.targetId));
    if (hit) await ctx.db.delete(hit._id);
    return { data: { ok: true } };
  },

  async typing(ctx, req) {
    const { acting, channel, perms } = await inChannel(ctx, req);
    requirePermission(perms, PERMISSIONS.SEND_MESSAGES, "type in this channel");
    const userId = acting.bot.userId;
    const existing = await ctx.db.query("typing").withIndex("by_user_channel", (q) => q.eq("userId", userId).eq("channelId", channel._id)).unique();
    if (existing?.scheduledJobId) await ctx.scheduler.cancel(existing.scheduledJobId).catch(() => undefined);
    const typingId = existing?._id ?? (await ctx.db.insert("typing", { userId, channelId: channel._id }));
    const scheduledJobId = await ctx.scheduler.runAfter(5_000, internal.typing.expire, { typingId });
    await ctx.db.patch(typingId, { scheduledJobId });
    return { data: { ok: true } };
  },

  // ---- messages ----
  async "message.list"(ctx, req) {
    const { acting, channel } = await inChannel(ctx, req);
    requireScope(acting, "messages.read");
    const cursor = req.query.before ? await ctx.db.get(ident(ctx, "channelMessages", req.query.before, "That message")) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const rows = await ctx.db.query("channelMessages").withIndex("by_channel", (q) => q.eq("channelId", channel._id)).order("desc").filter((q) => (cursor ? q.lt(q.field("_creationTime"), cursor._creationTime) : true)).take(limit);
    return { data: { messages: await Promise.all(rows.map((m) => describeMessage(ctx, m))) } };
  },

  async "message.get"(ctx, req) {
    const { acting, channel } = await inChannel(ctx, req);
    requireScope(acting, "messages.read");
    return { data: await describeMessage(ctx, await messageIn(ctx, channel, req.params.messageId)) };
  },

  async "message.send"(ctx, req) {
    const { acting, channel, perms } = await inChannel(ctx, req);
    requirePermission(perms, PERMISSIONS.SEND_MESSAGES, "send messages in this channel");
    const content = text(req.body, "content", { max: BOT_MESSAGE.content, trim: true });
    const embeds = valid(() => validateEmbeds(req.body.embeds));
    const components = valid(() => validateComponents(req.body.components));
    const filesIn = req.body.files === undefined ? [] : Array.isArray(req.body.files) ? req.body.files : fail(400, "`files` is a list.");
    if (filesIn.length > BOT_MESSAGE.files) return fail(400, `A message can carry up to ${BOT_MESSAGE.files} files.`);
    const attachments = [];
    for (const f of filesIn as Json[]) {
      const up = await checkedUpload(ctx, f?.storageId, { types: /^(image|audio|video|text|application)\/[\w.+-]+$/, maxBytes: BOT_FILE_BYTES, what: "A file" });
      const fileName = (text(f, "fileName", { max: 100, required: true })!).replace(/[\\/:*?"<>|]/g, "_");
      // Never something a browser would run if opened from our storage's address.
      if (/^(text\/html|application\/(xhtml|javascript|x-javascript)|image\/svg)/.test(up.contentType)) return fail(400, "That kind of file can't be sent.");
      attachments.push({ storageId: up.id, fileName, fileType: effectiveFileType(up.contentType, fileName), fileSize: up.size });
    }
    if (!content && !embeds.length && !components.length && !attachments.length) return fail(400, "A message needs `content`, `embeds`, `components` or `files`.");
    if (content && MENTIONS_EVERYONE.test(content)) requirePermission(perms, PERMISSIONS.MENTION_EVERYONE, "mention everyone or a role");
    const reply = typeof req.body.replyToId === "string" ? ctx.db.normalizeId("channelMessages", req.body.replyToId) : null;
    await spendRate(ctx, req.botId, "send");
    const id = await sendChannelMessage(ctx, acting.botUser, { channelId: channel._id, text: content, replyToId: reply ?? undefined, pingReply: req.body.pingReply !== false, attachments: attachments.length ? attachments : undefined }, { permissionChecked: true, embeds, components });
    return { status: 201, data: { id } };
  },

  async "message.edit"(ctx, req) {
    const { acting, channel } = await inChannel(ctx, req);
    const message = await messageIn(ctx, channel, req.params.messageId);
    if (message.authorId !== acting.bot.userId) return fail(403, "A bot can only edit its own messages.");
    const change: { text?: string; embeds?: ReturnType<typeof validateEmbeds>; components?: ReturnType<typeof validateComponents> } = {};
    if (req.body.content !== undefined) change.text = text(req.body, "content", { max: BOT_MESSAGE.content }) ?? "";
    if (req.body.embeds !== undefined) change.embeds = valid(() => validateEmbeds(req.body.embeds));
    if (req.body.components !== undefined) change.components = valid(() => validateComponents(req.body.components));
    if (Object.keys(change).length === 0) return fail(400, "Nothing to change. Send `content`, `embeds` and/or `components`.");
    try {
      await editChannelMessage(ctx, message, change);
    } catch (e) {
      return fail(400, e instanceof Error ? e.message : "That edit isn't valid.");
    }
    return { data: { ok: true } };
  },

  async "message.delete"(ctx, req) {
    const { acting, channel, perms } = await inChannel(ctx, req);
    const message = await messageIn(ctx, channel, req.params.messageId);
    if (message.authorId !== acting.bot.userId) requirePermission(perms, PERMISSIONS.MANAGE_MESSAGES, "delete other people's messages");
    await deleteChannelMessage(ctx, message, acting.bot.userId);
    return { data: { ok: true } };
  },

  async "message.bulkDelete"(ctx, req) {
    const { acting, channel, perms } = await inChannel(ctx, req);
    requirePermission(perms, PERMISSIONS.MANAGE_MESSAGES, "delete other people's messages");
    const ids = req.body.messageIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100) return fail(400, "`messageIds` is a list of 1 to 100.");
    // Everything is checked before anything is deleted: one wrong id stops the lot.
    const messages: Doc<"channelMessages">[] = [];
    for (const raw of new Set(ids as string[])) messages.push(await messageIn(ctx, channel, raw));
    for (const m of messages) await deleteChannelMessage(ctx, m, acting.bot.userId);
    return { data: { deleted: messages.length } };
  },

  async "reaction.add"(ctx, req) {
    const { acting, channel, perms } = await inChannel(ctx, req);
    requirePermission(perms, PERMISSIONS.SEND_MESSAGES, "react in this channel");
    const emoji = req.params.emoji.trim();
    if (emoji.length < 1 || emoji.length > 64 || /\s/.test(emoji)) return fail(400, "That isn't an emoji.");
    const message = await messageIn(ctx, channel, req.params.messageId);
    await spendRate(ctx, req.botId, "send");
    await setChannelReaction(ctx, message, acting.bot.userId, emoji, "add");
    return { data: { ok: true } };
  },

  async "reaction.remove"(ctx, req) {
    const { acting, channel } = await inChannel(ctx, req);
    const message = await messageIn(ctx, channel, req.params.messageId);
    await setChannelReaction(ctx, message, acting.bot.userId, req.params.emoji.trim(), "remove");
    return { data: { ok: true } };
  },

  async "reaction.clear"(ctx, req) {
    const { channel, perms } = await inChannel(ctx, req);
    requirePermission(perms, PERMISSIONS.MANAGE_MESSAGES, "clear reactions");
    const message = await messageIn(ctx, channel, req.params.messageId);
    for (const r of await ctx.db.query("channelMessageReactions").withIndex("by_message", (q) => q.eq("messageId", message._id)).collect()) await ctx.db.delete(r._id);
    return { data: { ok: true } };
  },

  async "pin.list"(ctx, req) {
    const { acting, channel } = await inChannel(ctx, req);
    requireScope(acting, "messages.read");
    const pinned = await ctx.db.query("channelMessages").withIndex("by_channel", (q) => q.eq("channelId", channel._id)).filter((q) => q.neq(q.field("pinnedAt"), undefined)).take(100);
    pinned.sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
    return { data: { messages: await Promise.all(pinned.map((m) => describeMessage(ctx, m))) } };
  },

  async "pin.add"(ctx, req) {
    const { channel, perms } = await inChannel(ctx, req);
    requirePermission(perms, PERMISSIONS.MANAGE_MESSAGES, "pin messages");
    const message = await messageIn(ctx, channel, req.params.messageId);
    await ctx.db.patch(message._id, { pinnedAt: Date.now() });
    return { data: { ok: true } };
  },

  async "pin.remove"(ctx, req) {
    const { channel, perms } = await inChannel(ctx, req);
    requirePermission(perms, PERMISSIONS.MANAGE_MESSAGES, "unpin messages");
    const message = await messageIn(ctx, channel, req.params.messageId);
    await ctx.db.patch(message._id, { pinnedAt: undefined });
    return { data: { ok: true } };
  },

  // ---- members, roles, bans ----
  async "member.list"(ctx, req) {
    const a = await community(ctx, req);
    requireScope(a, "members.read");
    const rows = await ctx.db.query("communityMembers").withIndex("by_community", (q) => q.eq("communityId", a.community._id)).take(Math.min(Math.max(Number(req.query.limit) || 100, 1), 200));
    const out = [];
    for (const m of rows) {
      const u = await ctx.db.get(m.userId);
      if (u) out.push({ ...userBrief(u), joinedAt: m.joinedAt });
    }
    return { data: { members: out } };
  },

  async "member.get"(ctx, req) {
    const a = await community(ctx, req);
    requireScope(a, "members.read");
    const id = ident(ctx, "users", req.params.userId, "That person");
    const m = await ctx.db.query("communityMembers").withIndex("by_community_user", (q) => q.eq("communityId", a.community._id).eq("userId", id)).unique();
    if (!m) return fail(404, "That person isn't in this community.");
    const [u, assigned, profile] = await Promise.all([
      ctx.db.get(id),
      ctx.db.query("memberRoles").withIndex("by_member", (q) => q.eq("communityId", a.community._id).eq("userId", id)).collect(),
      ctx.db.query("serverProfiles").withIndex("by_user_community", (q) => q.eq("userId", id).eq("communityId", a.community._id)).unique(),
    ]);
    return { data: { ...userBrief(u), nickname: profile?.displayName ?? null, joinedAt: m.joinedAt, timeoutUntil: m.timeoutUntil ?? null, roleIds: assigned.map((r) => r.roleId), isOwner: a.community.ownerId === id } };
  },

  async "member.update"(ctx, req) {
    const a = await community(ctx, req);
    const target = ident(ctx, "users", req.params.userId, "That person");
    const nickname = text(req.body, "nickname", { max: 32, required: true, min: 0 })!;
    if (target === a.bot.userId) {
      // Its own nickname needs nothing but being in the community.
    } else {
      requirePermission(communityPermissions(a), PERMISSIONS.MANAGE_NICKNAMES, "change nicknames");
      await memberBelow(ctx, a, req.params.userId);
    }
    const profile = await ctx.db.query("serverProfiles").withIndex("by_user_community", (q) => q.eq("userId", target).eq("communityId", a.community._id)).unique();
    if (profile) await ctx.db.patch(profile._id, { displayName: nickname || undefined });
    else if (nickname) await ctx.db.insert("serverProfiles", { userId: target, communityId: a.community._id, displayName: nickname });
    return { data: { ok: true } };
  },

  async "member.kick"(ctx, req) {
    const a = await community(ctx, req);
    requirePermission(communityPermissions(a), PERMISSIONS.KICK_MEMBERS, "remove members");
    const target = await memberBelow(ctx, a, req.params.userId);
    await removeMembership(ctx, a.community._id, target);
    return { data: { ok: true } };
  },

  async "member.timeout"(ctx, req) {
    const a = await community(ctx, req);
    const seconds = int(req.body, "seconds", { min: 0, max: 28 * 24 * 3600, required: true })!;
    requirePermission(communityPermissions(a), PERMISSIONS.MODERATE_MEMBERS, "time members out");
    const target = await memberBelow(ctx, a, req.params.userId);
    const member = (await ctx.db.query("communityMembers").withIndex("by_community_user", (q) => q.eq("communityId", a.community._id).eq("userId", target)).unique())!;
    await ctx.db.patch(member._id, { timeoutUntil: seconds > 0 ? Date.now() + seconds * 1000 : undefined });
    if (seconds > 0) await disconnectFromAllVoice(ctx, a.community._id, target);
    return { data: { ok: true } };
  },

  async "member.role.add"(ctx, req) {
    const a = await community(ctx, req);
    const eff = communityPermissions(a);
    requirePermission(eff, PERMISSIONS.MANAGE_ROLES, "give roles");
    const target = await memberBelow(ctx, a, req.params.userId);
    const role = await roleBelow(ctx, a, req.params.roleId);
    // Never a role stronger than the bot itself, even though it is below the bot's own.
    const g = grantableToRole(eff, role.permissions, 0);
    if (!g.ok) return fail(403, "That role has permissions the bot doesn't have, so the bot can't give it.");
    const has = (await ctx.db.query("memberRoles").withIndex("by_member", (q) => q.eq("communityId", a.community._id).eq("userId", target)).collect()).some((m) => m.roleId === role._id);
    if (!has) await ctx.db.insert("memberRoles", { communityId: a.community._id, userId: target, roleId: role._id });
    return { data: { ok: true } };
  },

  async "member.role.remove"(ctx, req) {
    const a = await community(ctx, req);
    requirePermission(communityPermissions(a), PERMISSIONS.MANAGE_ROLES, "take roles away");
    const target = await memberBelow(ctx, a, req.params.userId);
    const role = await roleBelow(ctx, a, req.params.roleId);
    const row = (await ctx.db.query("memberRoles").withIndex("by_member", (q) => q.eq("communityId", a.community._id).eq("userId", target)).collect()).find((m) => m.roleId === role._id);
    if (row) await ctx.db.delete(row._id);
    return { data: { ok: true } };
  },

  async "ban.list"(ctx, req) {
    const a = await community(ctx, req);
    requirePermission(communityPermissions(a), PERMISSIONS.BAN_MEMBERS, "see the bans");
    const rows = await ctx.db.query("communityBans").withIndex("by_community", (q) => q.eq("communityId", a.community._id)).take(200);
    return { data: { bans: await Promise.all(rows.map(async (b) => ({ user: userBrief(await ctx.db.get(b.userId)), reason: b.reason ?? null, bannedAt: b.createdAt }))) } };
  },

  async "ban.add"(ctx, req) {
    const a = await community(ctx, req);
    requirePermission(communityPermissions(a), PERMISSIONS.BAN_MEMBERS, "ban members");
    const reason = text(req.body, "reason", { max: 512 });
    const target = await memberBelow(ctx, a, req.params.userId, { allowNonMember: true });
    const existing = await ctx.db.query("communityBans").withIndex("by_community_user", (q) => q.eq("communityId", a.community._id).eq("userId", target)).unique();
    if (!existing) await ctx.db.insert("communityBans", { communityId: a.community._id, userId: target, bannedBy: a.bot.userId, reason, createdAt: Date.now() });
    await removeMembership(ctx, a.community._id, target);
    return { data: { ok: true } };
  },

  async "ban.remove"(ctx, req) {
    const a = await community(ctx, req);
    requirePermission(communityPermissions(a), PERMISSIONS.BAN_MEMBERS, "lift bans");
    const target = ident(ctx, "users", req.params.userId, "That person");
    const ban = await ctx.db.query("communityBans").withIndex("by_community_user", (q) => q.eq("communityId", a.community._id).eq("userId", target)).unique();
    if (ban) await ctx.db.delete(ban._id);
    return { data: { ok: true } };
  },

  async "invite.get"(ctx, req) {
    const a = await community(ctx, req);
    requirePermission(communityPermissions(a), PERMISSIONS.CREATE_INVITE, "create invites");
    let code = a.community.inviteCode;
    if (!code) {
      code = await freshInviteCode(ctx);
      await ctx.db.patch(a.community._id, { inviteCode: code });
    }
    return { data: { code } };
  },

  async "role.list"(ctx, req) {
    const a = await community(ctx, req);
    requireScope(a, "members.read");
    const roles = await ctx.db.query("roles").withIndex("by_community", (q) => q.eq("communityId", a.community._id)).collect();
    return { data: { roles: roles.sort((x, y) => y.position - x.position).map((r) => ({ id: r._id, name: r.name, color: r.color ?? null, permissions: r.permissions, position: r.position, hoist: !!r.hoist, isEveryone: r.isEveryone, managed: !!r.managedBotId })) } };
  },

  async "role.create"(ctx, req) {
    const a = await community(ctx, req);
    const eff = communityPermissions(a);
    requirePermission(eff, PERMISSIONS.MANAGE_ROLES, "create roles");
    const name = text(req.body, "name", { max: 100, required: true })!;
    const color = req.body.color === undefined ? undefined : /^#[0-9a-fA-F]{6}$/.test(String(req.body.color)) ? String(req.body.color) : fail(400, "`color` is #rrggbb.");
    const permissions = int(req.body, "permissions", { min: 0, max: 0x7fffffff }) ?? 0;
    const g = grantableToRole(eff, permissions, 0);
    if (!g.ok) return fail(403, g.message);
    const roles = await ctx.db.query("roles").withIndex("by_community", (q) => q.eq("communityId", a.community._id)).collect();
    if (roles.length >= 250) return fail(400, "A community can have up to 250 roles.");
    // Placed just below the bot's own role: everything from there up moves up one, in the same order.
    const rank = await botRank(ctx, a);
    for (const r of roles) if (!r.isEveryone && r.position >= rank) await ctx.db.patch(r._id, { position: r.position + 1 });
    const id = await ctx.db.insert("roles", { communityId: a.community._id, name, color, permissions, position: Math.max(rank, 1), isEveryone: false, hoist: req.body.hoist === true });
    return { status: 201, data: { id } };
  },

  async "role.update"(ctx, req) {
    const role = await ctx.db.get(ident(ctx, "roles", req.params.roleId, "That role"));
    if (!role) return fail(404, "That role wasn't found.");
    const a = await loadActing(ctx, req.botId, role.communityId);
    const eff = communityPermissions(a);
    requirePermission(eff, PERMISSIONS.MANAGE_ROLES, "edit roles");
    await roleBelow(ctx, a, req.params.roleId);
    const patch: Partial<Doc<"roles">> = {};
    if (req.body.name !== undefined) patch.name = text(req.body, "name", { max: 100, required: true });
    if (req.body.color !== undefined) patch.color = req.body.color === null ? undefined : /^#[0-9a-fA-F]{6}$/.test(String(req.body.color)) ? String(req.body.color) : fail(400, "`color` is #rrggbb.");
    if (req.body.hoist !== undefined) patch.hoist = req.body.hoist === true;
    if (req.body.permissions !== undefined) {
      const permissions = int(req.body, "permissions", { min: 0, max: 0x7fffffff, required: true })!;
      const g = grantableToRole(eff, permissions, role.permissions);
      if (!g.ok) return fail(403, g.message);
      patch.permissions = permissions;
    }
    if (Object.keys(patch).length === 0) return fail(400, "Nothing to change.");
    await ctx.db.patch(role._id, patch);
    return { data: { ok: true } };
  },

  async "role.delete"(ctx, req) {
    const role = await ctx.db.get(ident(ctx, "roles", req.params.roleId, "That role"));
    if (!role) return fail(404, "That role wasn't found.");
    const a = await loadActing(ctx, req.botId, role.communityId);
    requirePermission(communityPermissions(a), PERMISSIONS.MANAGE_ROLES, "delete roles");
    await roleBelow(ctx, a, req.params.roleId);
    for (const m of await ctx.db.query("memberRoles").withIndex("by_role", (q) => q.eq("roleId", role._id)).collect()) await ctx.db.delete(m._id);
    for (const o of await ctx.db.query("channelPermissionOverwrites").collect()) if (o.roleId === role._id) await ctx.db.delete(o._id);
    await ctx.db.delete(role._id);
    return { data: { ok: true } };
  },

  // ---- emoji and sounds ----
  async "emoji.list"(ctx, req) {
    const a = await community(ctx, req);
    const rows = await ctx.db.query("communityEmojis").withIndex("by_community", (q) => q.eq("communityId", a.community._id)).collect();
    return { data: { emojis: rows.map((e) => ({ id: e._id, name: e.name, imageUrl: e.imageUrl, mention: `<:${e.name}:${e._id}>` })) } };
  },

  async "emoji.create"(ctx, req) {
    const a = await community(ctx, req);
    requirePermission(communityPermissions(a), PERMISSIONS.MANAGE_EMOJIS, "add emojis");
    const name = (text(req.body, "name", { max: 32, required: true })!).toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (name.length < 2) return fail(400, "An emoji's name is 2 to 32 letters, numbers or underscores.");
    const up = await checkedUpload(ctx, req.body.storageId, { types: /^image\/(png|jpeg|webp|gif)$/, maxBytes: 256 * 1024, what: "An emoji" });
    const existing = await ctx.db.query("communityEmojis").withIndex("by_community", (q) => q.eq("communityId", a.community._id)).collect();
    if (existing.length >= 50) return fail(400, "This community has reached its 50 emoji limit.");
    if (existing.some((e) => e.name === name)) return fail(409, `An emoji named “${name}” already exists.`);
    const imageUrl = await ctx.storage.getUrl(up.id);
    if (!imageUrl) return fail(500, "The upload couldn't be read.");
    const id = await ctx.db.insert("communityEmojis", { communityId: a.community._id, name, imageUrl, storageId: up.id, uploadedBy: a.bot.userId, createdAt: Date.now() });
    return { status: 201, data: { id, name, imageUrl, mention: `<:${name}:${id}>` } };
  },

  async "emoji.delete"(ctx, req) {
    const a = await community(ctx, req);
    requirePermission(communityPermissions(a), PERMISSIONS.MANAGE_EMOJIS, "remove emojis");
    const e = await ctx.db.get(ident(ctx, "communityEmojis", req.params.emojiId, "That emoji"));
    if (!e || e.communityId !== a.community._id) return fail(404, "That emoji wasn't found.");
    if (e.storageId) await ctx.storage.delete(e.storageId).catch(() => undefined);
    await ctx.db.delete(e._id);
    return { data: { ok: true } };
  },

  async "sound.list"(ctx, req) {
    const a = await community(ctx, req);
    const rows = await ctx.db.query("communitySounds").withIndex("by_community", (q) => q.eq("communityId", a.community._id)).collect();
    return { data: { sounds: rows.map((s) => ({ id: s._id, name: s.name, emoji: s.emoji ?? null, soundUrl: s.soundUrl, durationMs: s.durationMs ?? null })) } };
  },

  async "sound.create"(ctx, req) {
    const a = await community(ctx, req);
    requirePermission(communityPermissions(a), PERMISSIONS.MANAGE_EMOJIS, "add soundboard clips");
    const name = text(req.body, "name", { max: 32, required: true, min: 2 })!;
    const emoji = text(req.body, "emoji", { max: 16 });
    const durationMs = int(req.body, "durationMs", { min: 1, max: 8000 });
    const up = await checkedUpload(ctx, req.body.storageId, { types: /^audio\/[\w.+-]+$/, maxBytes: MAX_SOUND_BYTES, what: "A soundboard clip" });
    const existing = await ctx.db.query("communitySounds").withIndex("by_community", (q) => q.eq("communityId", a.community._id)).collect();
    if (existing.length >= 48) return fail(400, "This community has reached its 48 soundboard slots.");
    if (existing.some((s) => s.name === name)) return fail(409, `A sound named “${name}” already exists.`);
    const soundUrl = await ctx.storage.getUrl(up.id);
    if (!soundUrl) return fail(500, "The upload couldn't be read.");
    const id = await ctx.db.insert("communitySounds", { communityId: a.community._id, name, emoji, soundUrl, storageId: up.id, durationMs, uploadedBy: a.bot.userId, createdAt: Date.now() });
    return { status: 201, data: { id, name, soundUrl } };
  },

  async "sound.delete"(ctx, req) {
    const a = await community(ctx, req);
    requirePermission(communityPermissions(a), PERMISSIONS.MANAGE_EMOJIS, "remove soundboard clips");
    const s = await ctx.db.get(ident(ctx, "communitySounds", req.params.soundId, "That sound"));
    if (!s || s.communityId !== a.community._id) return fail(404, "That sound wasn't found.");
    await ctx.storage.delete(s.storageId).catch(() => undefined);
    await ctx.db.delete(s._id);
    return { data: { ok: true } };
  },

  // ---- voice ----
  async "voice.list"(ctx, req) {
    const { channel } = await inChannel(ctx, req);
    if (channel.type !== "voice") return fail(400, "That isn't a voice channel.");
    const rows = await ctx.db.query("channelCallParticipants").withIndex("by_channel", (q) => q.eq("channelId", channel._id)).collect();
    return { data: { participants: await Promise.all(rows.map(async (r) => ({ user: userBrief(await ctx.db.get(r.userId)), joinedAt: r.joinedAt, muted: !!r.muted, deafened: !!r.deafened, streaming: !!r.streaming, serverMuted: !!r.serverMuted, serverDeafened: !!r.serverDeafened }))) } };
  },

  /** Step one of joining voice: every check, and the participant row. The LiveKit token is minted by `botVoice.join` after this answers. */
  async "voice.prepare"(ctx, req) {
    const { acting, channel, perms } = await inChannel(ctx, req);
    if (channel.type !== "voice") return fail(400, "That isn't a voice channel.");
    requirePermission(perms, PERMISSIONS.CONNECT, "join this voice channel");
    const member = await ctx.db.query("communityMembers").withIndex("by_community_user", (q) => q.eq("communityId", channel.communityId).eq("userId", acting.bot.userId)).unique();
    if (member?.timeoutUntil && member.timeoutUntil > Date.now()) return fail(403, "The bot is timed out here.");
    // A bot is in one voice channel at a time, as a person is.
    const elsewhere = await ctx.db.query("channelCallParticipants").collect();
    for (const row of elsewhere) if (row.userId === acting.bot.userId && row.channelId !== channel._id) await ctx.runMutation(internal.channels.recordVoiceLeave, { channelId: row.channelId, userId: row.userId });
    await ctx.runMutation(internal.channels.recordVoiceJoin, { channelId: channel._id, userId: acting.bot.userId });
    return { data: { channelId: channel._id, userId: acting.bot.userId, name: acting.bot.name, canSpeak: true } };
  },

  async "voice.leave"(ctx, req) {
    const channel = await ctx.db.get(ident(ctx, "channels", req.params.channelId, "That channel"));
    if (!channel) return fail(404, "That channel wasn't found.");
    const a = await loadActing(ctx, req.botId, channel.communityId);
    const remaining = await ctx.runMutation(internal.channels.recordVoiceLeave, { channelId: channel._id, userId: a.bot.userId });
    return { data: { ok: true, remaining } };
  },

  async "voice.state"(ctx, req) {
    const { acting, channel } = await inChannel(ctx, req);
    if (req.body.streaming !== undefined) return fail(400, "Bots can speak and play soundboard clips in voice, but can't stream or share video.");
    const row = await ctx.db.query("channelCallParticipants").withIndex("by_channel_user", (q) => q.eq("channelId", channel._id).eq("userId", acting.bot.userId)).unique();
    if (!row) return fail(409, "The bot isn't in this voice channel. Join it first.");
    const patch: Partial<Doc<"channelCallParticipants">> = {};
    for (const k of ["muted", "deafened"] as const) if (req.body[k] !== undefined) patch[k] = req.body[k] === true;
    if (Object.keys(patch).length === 0) return fail(400, "Send `muted` and/or `deafened`.");
    await ctx.db.patch(row._id, patch);
    return { data: { ok: true } };
  },

  async "voice.member.update"(ctx, req) {
    const { acting, channel } = await inChannel(ctx, req);
    const eff = communityPermissions(acting);
    const wantsMute = req.body.serverMuted !== undefined;
    const wantsDeaf = req.body.serverDeafened !== undefined;
    if (!wantsMute && !wantsDeaf) return fail(400, "Send `serverMuted` and/or `serverDeafened`.");
    if (wantsMute) requirePermission(eff, PERMISSIONS.MUTE_MEMBERS, "mute members in voice");
    if (wantsDeaf) requirePermission(eff, PERMISSIONS.DEAFEN_MEMBERS, "deafen members in voice");
    const target = await memberBelow(ctx, acting, req.params.userId);
    const row = await ctx.db.query("channelCallParticipants").withIndex("by_channel_user", (q) => q.eq("channelId", channel._id).eq("userId", target)).unique();
    if (!row) return fail(404, "That person isn't in this voice channel.");
    await ctx.db.patch(row._id, { ...(wantsMute ? { serverMuted: req.body.serverMuted === true } : {}), ...(wantsDeaf ? { serverDeafened: req.body.serverDeafened === true } : {}) });
    return { data: { ok: true } };
  },

  async "voice.member.disconnect"(ctx, req) {
    const { acting, channel } = await inChannel(ctx, req);
    requirePermission(communityPermissions(acting), PERMISSIONS.MOVE_MEMBERS, "disconnect members from voice");
    const target = await memberBelow(ctx, acting, req.params.userId);
    const row = await ctx.db.query("channelCallParticipants").withIndex("by_channel_user", (q) => q.eq("channelId", channel._id).eq("userId", target)).unique();
    if (row) {
      await ctx.db.delete(row._id);
      await fireVoiceEvent(ctx, channel._id, target, "left");
    }
    return { data: { ok: true } };
  },

  // ---- direct messages ----
  async "dm.send"(ctx, req) {
    const bot = await ctx.db.get(req.botId);
    if (!bot) return fail(401, "Unknown bot.");
    const target = ident(ctx, "users", req.params.userId, "That person");
    const user = await ctx.db.get(target);
    if (!user || user.isBot) return fail(404, "That person wasn't found.");
    const content = text(req.body, "content", { max: 2000, required: true })!;
    // The person has to have just used this bot — a command or a button — in a community where it
    // may send direct messages. That is the whole of the consent: without it a bot is a spam cannon.
    const since = Date.now() - 15 * 60_000;
    const interactions = [
      ...(await ctx.db.query("botAudit").withIndex("by_actor_action_at", (q) => q.eq("actorId", target).eq("action", "command").gt("at", since)).collect()),
      ...(await ctx.db.query("botAudit").withIndex("by_actor_action_at", (q) => q.eq("actorId", target).eq("action", "button").gt("at", since)).collect()),
    ].filter((r) => r.botId === req.botId && r.communityId);
    let allowed = false;
    for (const r of interactions) {
      const install = await ctx.db.query("botInstalls").withIndex("by_community_bot", (q) => q.eq("communityId", r.communityId!).eq("botId", req.botId)).unique();
      if (install?.scopes.includes("dm.send")) {
        allowed = true;
        break;
      }
    }
    if (!allowed) return fail(403, "This bot can message someone only within 15 minutes of them using one of its commands or buttons, in a community that gave it the dm.send access.");
    const recentDms = await ctx.db.query("botAudit").withIndex("by_bot_at", (q) => q.eq("botId", req.botId).gt("at", since)).filter((q) => q.and(q.eq(q.field("action"), "dm"), q.eq(q.field("detail"), String(target)))).collect();
    if (recentDms.length >= 3) return fail(429, "That's enough messages to this person for now.");
    await spendRate(ctx, req.botId, "send");

    const key = dmKeyFor(bot.userId, target);
    let conversationId = (await ctx.db.query("conversations").withIndex("by_dm_key", (q) => q.eq("dmKey", key)).unique())?._id;
    const now = Date.now();
    if (!conversationId) {
      conversationId = await ctx.db.insert("conversations", { type: "dm", dmKey: key, createdBy: bot.userId, createdAt: now });
      await ctx.db.insert("conversationMembers", { conversationId, userId: bot.userId, joinedAt: now, lastReadAt: now });
      await ctx.db.insert("conversationMembers", { conversationId, userId: target, joinedAt: now, lastReadAt: 0 });
    }
    const messageId = await ctx.db.insert("messages", { conversationId, authorId: bot.userId, text: content });
    await notifyUsers(ctx, { userIds: [target], actorId: bot.userId, type: "dm_message", conversationId, messageId, title: bot.name, body: content.slice(0, 200) });
    await audit(ctx, { botId: req.botId, actorId: target, action: "dm", ok: true, detail: String(target) });
    return { status: 201, data: { id: messageId } };
  },
};

// --- The one entry point ------------------------------------------------------------------------

/** Operations that only read: not written to the audit trail unless refused (a bot polling would bury everything). */
const READS = /^(me|presence\.get|community\.get|channel\.(list|get)|overwrite\.list|message\.(list|get)|pin\.list|member\.(list|get)|ban\.list|role\.list|emoji\.list|sound\.list|voice\.list)$/;

export type OpResult = { ok: true; status: number; data: unknown; botId: Id<"bots"> } | { ok: false; status: number; message: string };

/**
 * Authenticate, count, run one operation and audit it — in one transaction. The bot is found by
 * the public id in its token and the secret compared in constant time against a hash, always
 * against *something*, so timing doesn't say whether an id exists.
 */
export const execute = internalMutation({
  args: { prefix: v.string(), hash: v.string(), op: v.string(), params: v.record(v.string(), v.string()), body: v.any(), query: v.record(v.string(), v.string()) },
  handler: async (ctx, { prefix, hash, op, params, body, query }): Promise<OpResult> => {
    const bot = await ctx.db.query("bots").withIndex("by_token_prefix", (q) => q.eq("tokenPrefix", prefix)).first();
    if (!bot || !constantTimeEqual(bot.tokenHash, hash)) {
      if (!bot) constantTimeEqual("0".repeat(64), hash);
      return { ok: false, status: 401, message: "That token isn't valid." };
    }
    if (bot.suspendedAt) return { ok: false, status: 403, message: "This bot has been suspended." };
    const handler = ops[op];
    if (!handler) return { ok: false, status: 404, message: "There's no such endpoint." };
    try {
      await spendRate(ctx, bot._id, "request");
      const out = await handler(ctx, { botId: bot._id, params, body: body && typeof body === "object" && !Array.isArray(body) ? (body as Json) : {}, query });
      if (!READS.test(op)) await audit(ctx, { botId: bot._id, communityId: await communityOf(ctx, params), action: op, ok: true });
      return { ok: true, status: out.status ?? 200, data: out.data, botId: bot._id };
    } catch (e) {
      if (e instanceof BotApiError) {
        await audit(ctx, { botId: bot._id, communityId: await communityOf(ctx, params).catch(() => undefined), action: op, ok: false, detail: e.data.message });
        return { ok: false, status: e.data.status, message: e.data.message };
      }
      throw e;
    }
  },
});

async function communityOf(ctx: MutationCtx, params: Record<string, string>): Promise<Id<"communities"> | undefined> {
  try {
    if (params.communityId) return ctx.db.normalizeId("communities", params.communityId) ?? undefined;
    if (params.channelId) {
      const id = ctx.db.normalizeId("channels", params.channelId);
      return id ? (await ctx.db.get(id))?.communityId : undefined;
    }
  } catch {
    /* an audit row without a community is still an audit row */
  }
  return undefined;
}

export const OPERATIONS = Object.keys(ops);
void BOT_LIMITS;
void getBasePermissions;

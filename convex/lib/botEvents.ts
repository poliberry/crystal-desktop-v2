import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { PERMISSIONS } from "../permissions";
import { BotApiError, loadActing, permissionsIn } from "./botAccess";
import { holds } from "./botAuth";
import { effectiveFileType } from "./mediaType";

/**
 * Sending things to bots. An event is data about something that happened, delivered to the bot's
 * endpoint as a signed POST (see `botDelivery.ts`). A bot is only told about what it could see
 * itself: a message in a channel it has no access to is never sent, and message events need the
 * "read messages" scope as well as the permission to see the channel.
 */

export interface BotEvent {
  type: string;
  /** Unique per event, also sent as `X-Crystal-Delivery`, so a receiver can ignore a repeat. */
  id: string;
  createdAt: number;
  [key: string]: unknown;
}

export const newEvent = (type: string, data: Record<string, unknown>): BotEvent => ({
  type,
  id: `evt_${crypto.randomUUID().replace(/-/g, "")}`,
  createdAt: Date.now(),
  ...data,
});

/** Can this bot be sent events at all? Needs an address, and not to be suspended or switched off. */
export function canReceive(bot: Doc<"bots">, now = Date.now()): boolean {
  if (bot.suspendedAt) return false;
  // An endpoint is called; without one the bot has to be asking (its SDK long-polls, so "recently" is a minute or so).
  if (bot.endpointUrl) return !bot.eventsDisabledAt;
  return bot.lastPolledAt !== undefined && now - bot.lastPolledAt < POLL_ALIVE_MS;
}

/** A polling bot counts as listening for this long after it last asked. A poll waits up to 25 s. */
export const POLL_ALIVE_MS = 90_000;
/** How long an event waits for a bot to collect it, and how many may wait. */
export const QUEUE_KEEP_MS = 5 * 60_000;
export const QUEUE_MAX = 500;

export async function sendToBot(ctx: MutationCtx, botId: Id<"bots">, event: BotEvent, opts: { attempts?: number } = {}): Promise<void> {
  const bot = await ctx.db.get(botId);
  if (!bot) return;
  if (bot.endpointUrl) {
    await ctx.scheduler.runAfter(0, internal.botDelivery.deliver, { botId, event, attempt: 0, maxAttempts: opts.attempts ?? 5 });
    return;
  }
  // No endpoint: leave it for the bot to collect.
  await ctx.db.insert("botEvents", { botId, event });
  const waiting = await ctx.db.query("botEvents").withIndex("by_bot", (q) => q.eq("botId", botId)).order("asc").take(QUEUE_MAX + 1);
  if (waiting.length > QUEUE_MAX) await ctx.db.delete(waiting[0]._id);
}

/**
 * Tell each bot in the channel's community that a message was posted, if it can see that channel
 * and has been given the messages scope. Never throws: a problem with a bot must not stop anyone
 * from sending a message.
 */
export async function dispatchMessageCreated(ctx: MutationCtx, channel: Doc<"channels">, messageId: Id<"channelMessages">, author: Doc<"users">): Promise<void> {
  try {
    const installs = await ctx.db.query("botInstalls").withIndex("by_community", (q) => q.eq("communityId", channel.communityId)).collect();
    if (installs.length === 0) return;
    const message = await ctx.db.get(messageId);
    if (!message) return;
    const files = await ctx.db.query("channelMessageAttachments").withIndex("by_message", (q) => q.eq("messageId", messageId)).collect();
    const attachments = await Promise.all(
      files.map(async (f) => ({ fileName: f.fileName, fileType: effectiveFileType(f.fileType, f.fileName), fileSize: f.fileSize, url: f.cdnUrl ?? (f.storageId ? await ctx.storage.getUrl(f.storageId) : null) })),
    );
    for (const install of installs) {
      try {
        const bot = await ctx.db.get(install.botId);
        // A bot isn't told about its own messages: that would be an easy way to build a loop.
        if (!bot || bot.userId === author._id || !canReceive(bot)) continue;
        if (!install.scopes.includes("messages.read")) continue;
        const acting = await loadActing(ctx, install.botId, channel.communityId);
        if (!holds(await permissionsIn(ctx, acting, channel._id), PERMISSIONS.VIEW_CHANNELS)) continue;
        await sendToBot(
          ctx,
          bot._id,
          newEvent("message.created", {
            communityId: channel.communityId,
            channelId: channel._id,
            message: {
              id: message._id,
              text: message.text ?? "",
              replyToId: message.replyToId ?? null,
              createdAt: message._creationTime,
              author: { id: author._id, username: author.username, name: author.name, isBot: !!author.isBot },
              attachments,
            },
          }),
        );
      } catch (e) {
        // A bot that has lost its authority (or whose install is half-removed) just isn't told.
        if (!(e instanceof BotApiError)) console.warn("[bots] couldn't dispatch an event:", e);
      }
    }
  } catch (e) {
    console.warn("[bots] message dispatch failed:", e);
  }
}

// --- Gateway-style events ------------------------------------------------------------------------

export interface FireOptions {
  /** The bot must have been given this data scope. */
  scope?: "messages.read" | "members.read";
  /** The bot must be able to see this channel. */
  channelId?: Id<"channels">;
  /** Not told about its own doings (its messages, its joining voice…): an easy way to build a loop. */
  exceptUserId?: Id<"users">;
}

/**
 * Tell every bot in a community about something that happened, if it is entitled to hear it: it
 * has the scope the event needs and can see the channel it happened in. Never throws — a problem
 * with a bot must not stop the thing that happened from happening.
 *
 * This is the one place events fan out from, so "who may hear what" is decided once.
 */
export async function fireCommunityEvent(ctx: MutationCtx, communityId: Id<"communities">, type: string, data: Record<string, unknown>, opts: FireOptions = {}): Promise<void> {
  try {
    const installs = await ctx.db.query("botInstalls").withIndex("by_community", (q) => q.eq("communityId", communityId)).collect();
    if (installs.length === 0) return;
    const event = newEvent(type, { communityId, ...data });
    for (const install of installs) {
      try {
        const bot = await ctx.db.get(install.botId);
        if (!bot || !canReceive(bot)) continue;
        if (opts.exceptUserId && bot.userId === opts.exceptUserId) continue;
        if (opts.scope && !install.scopes.includes(opts.scope)) continue;
        if (opts.channelId) {
          const acting = await loadActing(ctx, install.botId, communityId);
          if (!holds(await permissionsIn(ctx, acting, opts.channelId), PERMISSIONS.VIEW_CHANNELS)) continue;
        }
        await sendToBot(ctx, bot._id, event);
      } catch (e) {
        // A bot that has lost its authority (or whose install is half-removed) just isn't told.
        if (!(e instanceof BotApiError)) console.warn("[bots] couldn't dispatch an event:", e);
      }
    }
  } catch (e) {
    console.warn("[bots] event dispatch failed:", e);
  }
}

/** The pieces of a message that events and API answers share. */
export async function describeMessage(ctx: MutationCtx, message: Doc<"channelMessages">) {
  const author = await ctx.db.get(message.authorId);
  const files = await ctx.db.query("channelMessageAttachments").withIndex("by_message", (q) => q.eq("messageId", message._id)).collect();
  return {
    id: message._id,
    text: message.text ?? "",
    replyToId: message.replyToId ?? null,
    createdAt: message._creationTime,
    editedAt: message.editedAt ?? null,
    pinned: message.pinnedAt !== undefined,
    embeds: message.embeds ?? [],
    components: message.components ?? [],
    author: author ? { id: author._id, username: author.username, name: author.name, isBot: !!author.isBot } : null,
    attachments: await Promise.all(files.map(async (f) => ({ fileName: f.fileName, fileType: effectiveFileType(f.fileType, f.fileName), fileSize: f.fileSize, url: f.cdnUrl ?? (f.storageId ? await ctx.storage.getUrl(f.storageId) : null) }))),
  };
}

/** Someone joined or left a community. Needs the member-list scope: it is the member list, as events. */
export async function fireMemberEvent(ctx: MutationCtx, communityId: Id<"communities">, type: "member.joined" | "member.left", user: Doc<"users">): Promise<void> {
  // A bot being added or removed is `bot.installed` / the Bots settings' business, not a member event.
  if (user.isBot) return;
  await fireCommunityEvent(ctx, communityId, type, { member: { id: user._id, username: user.username, name: user.name, isBot: false } }, { scope: "members.read" });
}

export async function fireChannelEvent(ctx: MutationCtx, type: "channel.created" | "channel.updated" | "channel.deleted", channel: Doc<"channels">): Promise<void> {
  await fireCommunityEvent(ctx, channel.communityId, type, { channel: { id: channel._id, name: channel.name, type: channel.type, topic: channel.topic ?? null } }, { channelId: channel._id });
}

export async function fireVoiceEvent(ctx: MutationCtx, channelId: Id<"channels">, userId: Id<"users">, action: "joined" | "left"): Promise<void> {
  const channel = await ctx.db.get(channelId);
  const user = await ctx.db.get(userId);
  if (!channel || !user) return;
  await fireCommunityEvent(ctx, channel.communityId, "voice.state", { channelId, action, user: { id: user._id, username: user.username, name: user.name, isBot: !!user.isBot } }, { channelId, exceptUserId: user.isBot ? userId : undefined });
}

import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { isMessageHidden, windowsByTarget } from "./lib/blocking";
import { PERMISSIONS, getChannelPermissions } from "./permissions";
import { getCurrentUserOrThrow } from "./users";

/**
 * "Saved for me": private bookmarks on messages, each with an optional reminder.
 *
 * Not pins. A pin (`pinnedAt` on the message) is shared with the whole room and, in a channel, needs
 * Manage Messages; a saved message belongs to one person, needs only that they can read the message,
 * and nobody else can see it.
 *
 * End-to-end encryption: a row is a reference (which message, which room, when to remind) and nothing
 * else. Reading the list hands back the message's ciphertext (`enc`) exactly as the room's own list
 * does, and the client decrypts it with the room key it already holds. The server learns that someone
 * saved a message, the same kind of metadata a reaction already is (docs/E2EE.md, "Not encrypted").
 * There is deliberately no note field: a note would be plaintext the server could read.
 *
 * Access is checked on every read, not just when saving: someone who leaves a conversation or loses a
 * channel keeps the bookmark row but stops getting the message back.
 */

const MAX_SAVED = 500;
const LIST_LIMIT = 200;
const MAX_REMINDER_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;
const PAST_SLACK_MS = 60 * 1000;

type Room =
  | { scope: "conversation"; conversationId: Id<"conversations"> }
  | { scope: "channel"; channelId: Id<"channels">; communityId: Id<"communities"> };

async function canReadConversation(ctx: QueryCtx, conversationId: Id<"conversations">, userId: Id<"users">) {
  const member = await ctx.db
    .query("conversationMembers")
    .withIndex("by_conversation_user", (q) => q.eq("conversationId", conversationId).eq("userId", userId))
    .first();
  return !!member;
}

async function canReadChannel(ctx: QueryCtx, channelId: Id<"channels">, userId: Id<"users">) {
  const channel = await ctx.db.get(channelId);
  if (!channel) return false;
  const community = await ctx.db.get(channel.communityId);
  if (!community) return false;
  const member = await ctx.db
    .query("communityMembers")
    .withIndex("by_community_user", (q) => q.eq("communityId", channel.communityId).eq("userId", userId))
    .first();
  if (!member) return false;
  return ((await getChannelPermissions(ctx, community, channelId, userId)) & PERMISSIONS.VIEW_CHANNELS) !== 0;
}

function checkRemindAt(remindAt: number | undefined) {
  if (remindAt === undefined) return;
  const now = Date.now();
  if (!Number.isFinite(remindAt) || remindAt < now - PAST_SLACK_MS || remindAt > now + MAX_REMINDER_AHEAD_MS) {
    throw new Error("Pick a reminder time within the next year.");
  }
}

async function ownRow(ctx: QueryCtx, userId: Id<"users">, messageKey: string) {
  return ctx.db
    .query("savedMessages")
    .withIndex("by_user_message", (q) => q.eq("userId", userId).eq("messageKey", messageKey))
    .first();
}

/** Save a message for yourself (or update its reminder if it's already saved). */
export const save = mutation({
  args: {
    conversationMessageId: v.optional(v.id("messages")),
    channelMessageId: v.optional(v.id("channelMessages")),
    remindAt: v.optional(v.number()),
  },
  handler: async (ctx, { conversationMessageId, channelMessageId, remindAt }) => {
    const me = await getCurrentUserOrThrow(ctx);
    if (!!conversationMessageId === !!channelMessageId) throw new Error("Say which message to save.");
    checkRemindAt(remindAt);

    let fields: Omit<Doc<"savedMessages">, "_id" | "_creationTime" | "userId" | "createdAt">;
    if (conversationMessageId) {
      const message = await ctx.db.get(conversationMessageId);
      if (!message) throw new Error("That message no longer exists.");
      if (!(await canReadConversation(ctx, message.conversationId, me._id))) throw new Error("You can't see that message.");
      fields = { scope: "conversation", messageKey: message._id, messageId: message._id, conversationId: message.conversationId };
    } else {
      const message = await ctx.db.get(channelMessageId!);
      if (!message) throw new Error("That message no longer exists.");
      const channel = await ctx.db.get(message.channelId);
      if (!channel || !(await canReadChannel(ctx, message.channelId, me._id))) throw new Error("You can't see that message.");
      fields = {
        scope: "channel",
        messageKey: message._id,
        channelMessageId: message._id,
        channelId: message.channelId,
        communityId: channel.communityId,
      };
    }

    const existing = await ownRow(ctx, me._id, fields.messageKey);
    if (existing) {
      if (remindAt !== undefined) await ctx.db.patch(existing._id, { remindAt, remindedAt: undefined });
      return existing._id;
    }

    const count = (await ctx.db.query("savedMessages").withIndex("by_user_created", (q) => q.eq("userId", me._id)).take(MAX_SAVED)).length;
    if (count >= MAX_SAVED) throw new Error(`You can keep up to ${MAX_SAVED} saved messages. Remove some to save more.`);

    return ctx.db.insert("savedMessages", {
      ...fields,
      userId: me._id,
      ...(remindAt !== undefined ? { remindAt } : {}),
      createdAt: Date.now(),
    });
  },
});

export const unsave = mutation({
  args: { messageKey: v.string() },
  handler: async (ctx, { messageKey }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const row = await ownRow(ctx, me._id, messageKey);
    if (row) await ctx.db.delete(row._id);
  },
});

/** `null` clears the reminder and keeps the message saved. */
export const setReminder = mutation({
  args: { messageKey: v.string(), remindAt: v.union(v.number(), v.null()) },
  handler: async (ctx, { messageKey, remindAt }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const row = await ownRow(ctx, me._id, messageKey);
    if (!row) throw new Error("Save the message first.");
    if (remindAt === null) {
      await ctx.db.patch(row._id, { remindAt: undefined, remindedAt: undefined });
      return;
    }
    checkRemindAt(remindAt);
    await ctx.db.patch(row._id, { remindAt, remindedAt: undefined });
  },
});

/** Whether one message is saved by you, for its menu. */
export const status = query({
  args: { messageKey: v.string() },
  handler: async (ctx, { messageKey }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const row = await ownRow(ctx, me._id, messageKey);
    return row ? { saved: true as const, remindAt: row.remindAt ?? null, remindedAt: row.remindedAt ?? null } : { saved: false as const };
  },
});

/** Reminders not yet shown, soonest first. The client keeps the timers; queries can't watch the clock. */
export const pendingReminders = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrThrow(ctx);
    const rows = await ctx.db
      .query("savedMessages")
      .withIndex("by_user_remind", (q) => q.eq("userId", me._id).gt("remindAt", 0))
      .take(50);
    // A claimed reminder has its `remindAt` cleared, so everything in this range is still to come.
    return rows.map((row) => ({ id: row._id, messageKey: row.messageKey, remindAt: row.remindAt! }));
  },
});

/**
 * Claims due reminders for display. Returns only the ones this call claimed, so with two devices open
 * a reminder is shown once.
 */
export const claimReminders = mutation({
  args: { ids: v.array(v.id("savedMessages")) },
  handler: async (ctx, { ids }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const now = Date.now();
    const claimed: Id<"savedMessages">[] = [];
    for (const id of ids.slice(0, 50)) {
      const row = await ctx.db.get(id);
      if (!row || row.userId !== me._id || row.remindAt === undefined || row.remindedAt !== undefined) continue;
      if (row.remindAt > now + PAST_SLACK_MS) continue;
      // Clearing `remindAt` takes it out of `pendingReminders`' index range for good.
      await ctx.db.patch(id, { remindAt: undefined, remindedAt: now });
      claimed.push(id);
    }
    return claimed;
  },
});

/** Your saved messages, newest saved first, with each message as ciphertext for the client to open. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrThrow(ctx);
    const rows = await ctx.db
      .query("savedMessages")
      .withIndex("by_user_created", (q) => q.eq("userId", me._id))
      .order("desc")
      .take(LIST_LIMIT);
    const hidden = await windowsByTarget(ctx, me._id);

    // Rooms and people repeat across saved messages; look each up once.
    const access = new Map<string, Promise<boolean>>();
    const labels = new Map<string, Promise<{ title: string; subtitle: string | null }>>();
    const users = new Map<string, Promise<Doc<"users"> | null>>();
    const user = (id: Id<"users">) => {
      let hit = users.get(id);
      if (!hit) users.set(id, (hit = ctx.db.get(id)));
      return hit;
    };

    const roomOf = (row: Doc<"savedMessages">): Room | null =>
      row.scope === "conversation" && row.conversationId
        ? { scope: "conversation", conversationId: row.conversationId }
        : row.scope === "channel" && row.channelId && row.communityId
          ? { scope: "channel", channelId: row.channelId, communityId: row.communityId }
          : null;

    const readable = (room: Room) => {
      const key = room.scope === "conversation" ? room.conversationId : room.channelId;
      let hit = access.get(key);
      if (!hit) {
        hit = room.scope === "conversation" ? canReadConversation(ctx, room.conversationId, me._id) : canReadChannel(ctx, room.channelId, me._id);
        access.set(key, hit);
      }
      return hit;
    };

    const label = (room: Room) => {
      const key = room.scope === "conversation" ? room.conversationId : room.channelId;
      let hit = labels.get(key);
      if (!hit) {
        hit = (async () => {
          if (room.scope === "channel") {
            const [channel, community] = await Promise.all([ctx.db.get(room.channelId), ctx.db.get(room.communityId)]);
            return { title: channel ? `#${channel.name}` : "Channel", subtitle: community?.name ?? null };
          }
          const conversation = await ctx.db.get(room.conversationId);
          if (conversation?.type === "group" && conversation.name) return { title: conversation.name, subtitle: "Group" };
          const members = await ctx.db
            .query("conversationMembers")
            .withIndex("by_conversation", (q) => q.eq("conversationId", room.conversationId))
            .take(10);
          const others = (await Promise.all(members.filter((m) => m.userId !== me._id).map((m) => user(m.userId)))).filter(
            (u): u is Doc<"users"> => !!u,
          );
          const names = others.map((u) => u.name).join(", ");
          return { title: names || "Direct message", subtitle: conversation?.type === "group" ? "Group" : "Direct message" };
        })();
        labels.set(key, hit);
      }
      return hit;
    };

    const items = await Promise.all(
      rows.map(async (row) => {
        const room = roomOf(row);
        const base = {
          id: row._id,
          messageKey: row.messageKey,
          savedAt: row.createdAt,
          remindAt: row.remindAt ?? null,
          remindedAt: row.remindedAt ?? null,
        };
        if (!room || !(await readable(room))) return { ...base, room: null, place: null, message: null, unavailable: true as const };

        const message = row.messageId ? await ctx.db.get(row.messageId) : row.channelMessageId ? await ctx.db.get(row.channelMessageId) : null;
        const place = await label(room);
        const clientRoom =
          room.scope === "conversation"
            ? { scope: "conversation" as const, conversationId: room.conversationId }
            : { scope: "channel" as const, channelId: room.channelId, communityId: room.communityId };
        if (!message || isMessageHidden(hidden, message.authorId, message._creationTime)) {
          return { ...base, room: clientRoom, place, message: null, unavailable: true as const };
        }
        const author = await user(message.authorId);
        const attachment = row.messageId
          ? await ctx.db.query("messageAttachments").withIndex("by_message", (q) => q.eq("messageId", row.messageId!)).first()
          : await ctx.db.query("channelMessageAttachments").withIndex("by_message", (q) => q.eq("messageId", row.channelMessageId!)).first();
        return {
          ...base,
          room: clientRoom,
          place,
          unavailable: false as const,
          message: {
            id: message._id as string,
            authorId: message.authorId,
            author: author ? { name: author.name, username: author.username, imageUrl: author.imageUrl ?? null } : null,
            // Ciphertext for encrypted rows; `text` only for legacy and system rows, as the room's own list returns it.
            enc: message.enc ?? null,
            text: message.text ?? null,
            createdAt: message._creationTime,
            editedAt: message.editedAt ?? null,
            hasAttachments: !!attachment,
          },
        };
      }),
    );
    return items;
  },
});

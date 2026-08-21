import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireCommunity } from "./communities";
import { notifyUsers } from "./notifications";
import { PERMISSIONS, can, getChannelPermissions } from "./permissions";
import { getCurrentUserOrThrow } from "./users";

/** Plain-text `@username` mention detection — there's no rich mention syntax
 * in the composer (desktop or mobile) yet, so this just scans the raw
 * message text for `@handle` tokens and resolves them against the channel's
 * community members. */
const MENTION_RE = /@([a-z0-9_.]{3,32})/gi;

async function resolveMentions(
  ctx: QueryCtx,
  communityId: Id<"communities">,
  text: string,
  excludeUserId: Id<"users">
): Promise<Id<"users">[]> {
  const candidates = Array.from(new Set(Array.from(text.matchAll(MENTION_RE), (m) => m[1].toLowerCase())));
  if (candidates.length === 0) return [];

  const mentioned: Id<"users">[] = [];
  for (const username of candidates) {
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
    if (!user || user._id === excludeUserId) continue;
    const membership = await ctx.db
      .query("communityMembers")
      .withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", user._id))
      .unique();
    if (membership) mentioned.push(user._id);
  }
  return mentioned;
}

async function requireChannelPerm(
  ctx: QueryCtx,
  channelId: Id<"channels">,
  userId: Id<"users">,
  flag: number
): Promise<void> {
  const channel = await ctx.db.get(channelId);
  if (!channel) throw new Error("Channel not found.");
  const community = await requireCommunity(ctx, channel.communityId);
  const perms = await getChannelPermissions(ctx, community, channelId, userId);
  if (!can(perms, flag)) throw new Error("You don't have permission to do that.");
}

async function reactionsFor(ctx: QueryCtx, messageId: Id<"channelMessages">, me: Id<"users">) {
  const rows = await ctx.db
    .query("channelMessageReactions")
    .withIndex("by_message", (q) => q.eq("messageId", messageId))
    .collect();
  const grouped = new Map<string, { emoji: string; count: number; reactedByMe: boolean }>();
  for (const row of rows) {
    const g = grouped.get(row.emoji) ?? { emoji: row.emoji, count: 0, reactedByMe: false };
    g.count += 1;
    if (row.userId === me) g.reactedByMe = true;
    grouped.set(row.emoji, g);
  }
  return Array.from(grouped.values());
}

export const list = query({
  args: { channelId: v.id("channels"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { channelId, paginationOpts }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireChannelPerm(ctx, channelId, me._id, PERMISSIONS.VIEW_CHANNELS);

    const page = await ctx.db
      .query("channelMessages")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .order("desc")
      .paginate(paginationOpts);

    const messages = await Promise.all(
      page.page.map(async (message) => {
        const author = await ctx.db.get(message.authorId);
        const attachmentRows = await ctx.db
          .query("channelMessageAttachments")
          .withIndex("by_message", (q) => q.eq("messageId", message._id))
          .collect();
        const attachments = await Promise.all(
          attachmentRows.map(async (attachment) => ({
            id: attachment._id,
            fileName: attachment.fileName,
            fileType: attachment.fileType,
            fileSize: attachment.fileSize,
            url: await ctx.storage.getUrl(attachment.storageId),
          }))
        );
        return {
          id: message._id,
          text: message.text ?? null,
          createdAt: message._creationTime,
          editedAt: message.editedAt ?? null,
          isMine: message.authorId === me._id,
          author: author
            ? { id: author._id, name: author.name, username: author.username, imageUrl: author.imageUrl, bio: author.bio, bannerUrl: author.bannerUrl, customStatus: author.customStatus }
            : null,
          attachments,
          reactions: await reactionsFor(ctx, message._id, me._id),
        };
      })
    );

    return { ...page, page: messages };
  },
});

export const send = mutation({
  args: {
    channelId: v.id("channels"),
    text: v.optional(v.string()),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id("_storage"),
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        })
      )
    ),
  },
  handler: async (ctx, { channelId, text, attachments }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireChannelPerm(ctx, channelId, me._id, PERMISSIONS.SEND_MESSAGES);

    const trimmed = text?.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) {
      throw new Error("Message needs text or an attachment.");
    }

    const messageId = await ctx.db.insert("channelMessages", {
      channelId,
      authorId: me._id,
      text: trimmed || undefined,
    });

    for (const attachment of attachments ?? []) {
      await ctx.db.insert("channelMessageAttachments", { messageId, ...attachment });
    }

    const channel = await ctx.db.get(channelId);
    if (channel && trimmed) {
      const mentioned = await resolveMentions(ctx, channel.communityId, trimmed, me._id);
      if (mentioned.length > 0) {
        await notifyUsers(ctx, {
          userIds: mentioned,
          actorId: me._id,
          type: "channel_mention",
          channelId,
          communityId: channel.communityId,
          channelMessageId: messageId,
          title: `${me.name} mentioned you in #${channel.name}`,
          body: trimmed,
        });
      }
    }

    return messageId;
  },
});

export const update = mutation({
  args: { messageId: v.id("channelMessages"), text: v.string() },
  handler: async (ctx, { messageId, text }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) return;
    if (message.authorId !== me._id) throw new Error("You can only edit your own messages.");

    const trimmed = text.trim();
    if (!trimmed) throw new Error("Message can't be empty.");
    await ctx.db.patch(messageId, { text: trimmed, editedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { messageId: v.id("channelMessages") },
  handler: async (ctx, { messageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) return;

    if (message.authorId !== me._id) {
      await requireChannelPerm(ctx, message.channelId, me._id, PERMISSIONS.MANAGE_MESSAGES);
    }

    const [attachments, reactions] = await Promise.all([
      ctx.db
        .query("channelMessageAttachments")
        .withIndex("by_message", (q) => q.eq("messageId", messageId))
        .collect(),
      ctx.db
        .query("channelMessageReactions")
        .withIndex("by_message", (q) => q.eq("messageId", messageId))
        .collect(),
    ]);
    for (const attachment of attachments) await ctx.db.delete(attachment._id);
    for (const reaction of reactions) await ctx.db.delete(reaction._id);
    await ctx.db.delete(messageId);
  },
});

export const toggleReaction = mutation({
  args: { messageId: v.id("channelMessages"), emoji: v.string() },
  handler: async (ctx, { messageId, emoji }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("Message not found.");
    await requireChannelPerm(ctx, message.channelId, me._id, PERMISSIONS.VIEW_CHANNELS);

    const existing = await ctx.db
      .query("channelMessageReactions")
      .withIndex("by_message_user_emoji", (q) =>
        q.eq("messageId", messageId).eq("userId", me._id).eq("emoji", emoji)
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    } else {
      await ctx.db.insert("channelMessageReactions", { messageId, userId: me._id, emoji });
    }
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

// --- Pinned messages (mobile "Pinned" tab) ----------------------------------

export const pin = mutation({
  args: { messageId: v.id("channelMessages") },
  handler: async (ctx, { messageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("Message not found.");
    await requireChannelPerm(ctx, message.channelId, me._id, PERMISSIONS.MANAGE_MESSAGES);
    await ctx.db.patch(messageId, { pinnedAt: Date.now() });
  },
});

export const unpin = mutation({
  args: { messageId: v.id("channelMessages") },
  handler: async (ctx, { messageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("Message not found.");
    await requireChannelPerm(ctx, message.channelId, me._id, PERMISSIONS.MANAGE_MESSAGES);
    await ctx.db.patch(messageId, { pinnedAt: undefined });
  },
});

export const listPinned = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireChannelPerm(ctx, channelId, me._id, PERMISSIONS.VIEW_CHANNELS);

    const pinned = await ctx.db
      .query("channelMessages")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .filter((q) => q.neq(q.field("pinnedAt"), undefined))
      .collect();
    pinned.sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));

    return Promise.all(
      pinned.map(async (message) => {
        const author = await ctx.db.get(message.authorId);
        return {
          id: message._id,
          text: message.text ?? null,
          createdAt: message._creationTime,
          pinnedAt: message.pinnedAt ?? null,
          author: author
            ? { id: author._id, name: author.name, username: author.username, imageUrl: author.imageUrl }
            : null,
        };
      })
    );
  },
});

// --- Attachments (mobile "Files" tab) ---------------------------------------

/** Same "flatten this page's attachments" approach as `messages.listAttachments`
 * — a page can surface zero attachments if that batch of messages happened
 * to be text-only, so the client should keep requesting more until `isDone`. */
export const listAttachments = query({
  args: { channelId: v.id("channels"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { channelId, paginationOpts }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireChannelPerm(ctx, channelId, me._id, PERMISSIONS.VIEW_CHANNELS);

    const page = await ctx.db
      .query("channelMessages")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .order("desc")
      .paginate(paginationOpts);

    const perMessage = await Promise.all(
      page.page.map(async (message) => {
        const rows = await ctx.db
          .query("channelMessageAttachments")
          .withIndex("by_message", (q) => q.eq("messageId", message._id))
          .collect();
        return Promise.all(
          rows.map(async (attachment) => ({
            id: attachment._id,
            messageId: message._id,
            fileName: attachment.fileName,
            fileType: attachment.fileType,
            fileSize: attachment.fileSize,
            url: await ctx.storage.getUrl(attachment.storageId),
            createdAt: message._creationTime,
          }))
        );
      })
    );

    return { ...page, page: perMessage.flat() };
  },
});

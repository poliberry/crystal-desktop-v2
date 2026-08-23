import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { renderMentionsAsText } from "./lib/mentions";
import { notifyUsers } from "./notifications";
import { requireWithinUploadLimit } from "./uploadLimits";
import { getCurrentUserOrThrow } from "./users";

async function requireMembership(
  ctx: QueryCtx,
  conversationId: Id<"conversations">,
  userId: Id<"users">,
) {
  const membership = await ctx.db
    .query("conversationMembers")
    .withIndex("by_conversation_user", (q) =>
      q.eq("conversationId", conversationId).eq("userId", userId),
    )
    .unique();
  if (!membership) throw new Error("Not a member of this conversation.");
  return membership;
}

async function reactionsFor(
  ctx: QueryCtx,
  messageId: Id<"messages">,
  me: Id<"users">,
) {
  const rows = await ctx.db
    .query("messageReactions")
    .withIndex("by_message", (q) => q.eq("messageId", messageId))
    .collect();
  const grouped = new Map<
    string,
    { emoji: string; count: number; reactedByMe: boolean }
  >();
  for (const row of rows) {
    const g = grouped.get(row.emoji) ?? {
      emoji: row.emoji,
      count: 0,
      reactedByMe: false,
    };
    g.count += 1;
    if (row.userId === me) g.reactedByMe = true;
    grouped.set(row.emoji, g);
  }
  return Array.from(grouped.values());
}

export const list = query({
  args: {
    conversationId: v.id("conversations"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { conversationId, paginationOpts }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMembership(ctx, conversationId, me._id);

    const page = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
      .order("desc")
      .paginate(paginationOpts);

    const messages = await Promise.all(
      page.page.map(async (message) => {
        const author = await ctx.db.get(message.authorId);
        const attachmentRows = await ctx.db
          .query("messageAttachments")
          .withIndex("by_message", (q) => q.eq("messageId", message._id))
          .collect();
        const attachments = await Promise.all(
          attachmentRows.map(async (attachment) => ({
            id: attachment._id,
            fileName: attachment.fileName,
            fileType: attachment.fileType,
            fileSize: attachment.fileSize,
            url: await ctx.storage.getUrl(attachment.storageId),
          })),
        );
        const authorPresence = await ctx.db
          .query("presence")
          .withIndex("by_user", (q) =>
            q.eq("userId", author?._id as Id<"users">),
          )
          .first();
        return {
          id: message._id,
          text: message.text ?? null,
          createdAt: message._creationTime,
          editedAt: message.editedAt ?? null,
          isMine: message.authorId === me._id,
          author: author
            ? {
                id: author._id,
                name: author.name,
                username: author.username,
                imageUrl: author.imageUrl,
                status: authorPresence?.effective,
              }
            : null,
          attachments,
          reactions: await reactionsFor(ctx, message._id, me._id),
        };
      }),
    );

    return { ...page, page: messages };
  },
});

export const send = mutation({
  args: {
    conversationId: v.id("conversations"),
    text: v.optional(v.string()),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id("_storage"),
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
  },
  handler: async (ctx, { conversationId, text, attachments }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const membership = await requireMembership(ctx, conversationId, me._id);

    const trimmed = text?.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) {
      throw new Error("Message needs text or an attachment.");
    }

    for (const attachment of attachments ?? []) {
      // Only reachable once the bytes are in storage, so it can't stop an
      // oversized upload — but it does stop it from becoming a message.
      await requireWithinUploadLimit(ctx, attachment.storageId, "Attachments");
    }

    const messageId = await ctx.db.insert("messages", {
      conversationId,
      authorId: me._id,
      text: trimmed || undefined,
    });

    for (const attachment of attachments ?? []) {
      await ctx.db.insert("messageAttachments", { messageId, ...attachment });
    }

    // I've obviously "read" up to the message I just sent.
    await ctx.db.patch(membership._id, { lastReadAt: Date.now() });

    const otherMembers = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
      .collect();
    await notifyUsers(ctx, {
      userIds: otherMembers.map((m) => m.userId),
      actorId: me._id,
      type: "dm_message",
      conversationId,
      messageId,
      title: me.name,
      body: trimmed ? await renderMentionsAsText(ctx, trimmed) : "Sent an attachment",
    });

    return messageId;
  },
});

export const update = mutation({
  args: { messageId: v.id("messages"), text: v.string() },
  handler: async (ctx, { messageId, text }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) return;
    if (message.authorId !== me._id)
      throw new Error("You can only edit your own messages.");

    const trimmed = text.trim();
    if (!trimmed) throw new Error("Message can't be empty.");
    await ctx.db.patch(messageId, { text: trimmed, editedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) return;
    if (message.authorId !== me._id)
      throw new Error("You can only delete your own messages.");

    const [attachments, reactions] = await Promise.all([
      ctx.db
        .query("messageAttachments")
        .withIndex("by_message", (q) => q.eq("messageId", messageId))
        .collect(),
      ctx.db
        .query("messageReactions")
        .withIndex("by_message", (q) => q.eq("messageId", messageId))
        .collect(),
    ]);
    for (const attachment of attachments) await ctx.db.delete(attachment._id);
    for (const reaction of reactions) await ctx.db.delete(reaction._id);
    await ctx.db.delete(messageId);
  },
});

export const toggleReaction = mutation({
  args: { messageId: v.id("messages"), emoji: v.string() },
  handler: async (ctx, { messageId, emoji }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("Message not found.");
    await requireMembership(ctx, message.conversationId, me._id);

    const existing = await ctx.db
      .query("messageReactions")
      .withIndex("by_message_user_emoji", (q) =>
        q.eq("messageId", messageId).eq("userId", me._id).eq("emoji", emoji),
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    } else {
      await ctx.db.insert("messageReactions", {
        messageId,
        userId: me._id,
        emoji,
      });
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
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("Message not found.");
    await requireMembership(ctx, message.conversationId, me._id);
    await ctx.db.patch(messageId, { pinnedAt: Date.now() });
  },
});

export const unpin = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, { messageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("Message not found.");
    await requireMembership(ctx, message.conversationId, me._id);
    await ctx.db.patch(messageId, { pinnedAt: undefined });
  },
});

export const listPinned = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMembership(ctx, conversationId, me._id);

    const pinned = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
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
            ? {
                id: author._id,
                name: author.name,
                username: author.username,
                imageUrl: author.imageUrl,
              }
            : null,
        };
      }),
    );
  },
});

// --- Attachments (mobile "Files" tab) ---------------------------------------

/** Paginates over the conversation's messages (newest first) and flattens
 * each page's attachments — a page may surface zero attachments if that
 * batch of messages happened to be text-only, so the mobile client should
 * keep requesting more pages until `isDone` to fill an empty-looking list. */
export const listAttachments = query({
  args: {
    conversationId: v.id("conversations"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { conversationId, paginationOpts }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMembership(ctx, conversationId, me._id);

    const page = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
      .order("desc")
      .paginate(paginationOpts);

    const perMessage = await Promise.all(
      page.page.map(async (message) => {
        const rows = await ctx.db
          .query("messageAttachments")
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
          })),
        );
      }),
    );

    return { ...page, page: perMessage.flat() };
  },
});

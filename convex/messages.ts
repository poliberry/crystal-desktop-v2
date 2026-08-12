import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { getCurrentUserOrThrow } from "./users";

async function requireMembership(
  ctx: QueryCtx,
  conversationId: Id<"conversations">,
  userId: Id<"users">
) {
  const membership = await ctx.db
    .query("conversationMembers")
    .withIndex("by_conversation_user", (q) =>
      q.eq("conversationId", conversationId).eq("userId", userId)
    )
    .unique();
  if (!membership) throw new Error("Not a member of this conversation.");
  return membership;
}

export const list = query({
  args: { conversationId: v.id("conversations"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { conversationId, paginationOpts }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMembership(ctx, conversationId, me._id);

    const page = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
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
          }))
        );
        return {
          id: message._id,
          text: message.text ?? null,
          createdAt: message._creationTime,
          author: author
            ? {
                id: author._id,
                name: author.name,
                username: author.username,
                imageUrl: author.imageUrl,
              }
            : null,
          attachments,
        };
      })
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
        })
      )
    ),
  },
  handler: async (ctx, { conversationId, text, attachments }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const membership = await requireMembership(ctx, conversationId, me._id);

    const trimmed = text?.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) {
      throw new Error("Message needs text or an attachment.");
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

    return messageId;
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

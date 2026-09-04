import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { effectiveDecoration, isBirthdayNow } from "./lib/birthday";
import { renderMentionsAsText } from "./lib/mentions";
import { allowsReply, loadNotificationPolicy } from "./lib/notificationPolicy";
import { notifyUsers } from "./notifications";
import { MAX_ATTACHMENT_BYTES, requireWithinUploadLimit } from "./uploadLimits";
import { getCurrentUserOrThrow } from "./users";

function cdnUrlForStorageId(storageId: string): string | null {
  const base = process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "";
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/migrated/${storageId}`;
}

function r2UrlForKey(key: string): string | null {
  const base = process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "";
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
}

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

/** Longest a reply preview snippet gets before it's cut — a preview is one
 * line, not the message. */
const REPLY_SNIPPET_MAX = 140;

/**
 * The compact "you're replying to…" card shown above a message: the target's
 * author, a one-line snippet, and whether it carried a file. A `replyToId`
 * that no longer resolves (target deleted) comes back flagged `deleted`.
 */
async function resolveReplyPreview(
  ctx: QueryCtx,
  replyToId: Id<"messages"> | undefined,
) {
  if (!replyToId) return null;
  const target = await ctx.db.get(replyToId);
  if (!target) {
    return {
      id: replyToId,
      authorName: "Unknown",
      authorImageUrl: undefined as string | undefined,
      text: null as string | null,
      hasAttachment: false,
      deleted: true,
    };
  }
  const [author, firstAttachment] = await Promise.all([
    ctx.db.get(target.authorId),
    ctx.db
      .query("messageAttachments")
      .withIndex("by_message", (q) => q.eq("messageId", target._id))
      .take(1),
  ]);
  return {
    id: target._id as string,
    authorName: author?.name ?? "Unknown",
    authorImageUrl: author?.imageUrl,
    text: target.text
      ? (await renderMentionsAsText(ctx, target.text)).slice(0, REPLY_SNIPPET_MAX)
      : null,
    hasAttachment: firstAttachment.length > 0,
    deleted: false,
  };
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

    // Redis cache for first page only (hot path) — pagination cursor = null
    const isFirstPage = !paginationOpts.cursor;
    const cacheKey = `dm:${conversationId}:messages:${paginationOpts.numItems}`;
    if (isFirstPage) {
      try {
        const { cacheGetJson } = await import("./cache");
        const cached = await cacheGetJson<any>(cacheKey);
        if (cached) return cached;
      } catch {}
    }

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
          attachmentRows.map(async (attachment) => {
            const anyAtt = attachment as unknown as { storageId?: string; cdnUrl?: string; cdnKey?: string };
            const directCdn = anyAtt.cdnUrl ?? (anyAtt.cdnKey ? r2UrlForKey(anyAtt.cdnKey) : null);
            const migratedCdn = anyAtt.storageId ? cdnUrlForStorageId(anyAtt.storageId) : null;
            const cdnUrl = directCdn ?? migratedCdn;
            const url = cdnUrl ?? (anyAtt.storageId ? await ctx.storage.getUrl(anyAtt.storageId as never) : null);
            return {
              id: attachment._id,
              fileName: attachment.fileName,
              fileType: attachment.fileType,
              fileSize: attachment.fileSize,
              url,
            };
          }),
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
          replyTo: await resolveReplyPreview(ctx, message.replyToId),
          /** The idempotency key of the send that created this row, when it
           * came through the outbox — how a client matches its own pending
           * optimistic row to the real one (see src/lib/outbox-overlay.ts). */
          clientId: message.clientId ?? null,
          /** Set when the message came from the "wish them a happy birthday"
           * prompt: the cakes fall for everyone in the conversation when one
           * of these arrives. */
          birthdayWish: message.birthdayWish === true,
          author: author
            ? {
                id: author._id,
                name: author.name,
                username: author.username,
                imageUrl: author.imageUrl,
                avatarDecoration: effectiveDecoration(author),
                isBirthday: isBirthdayNow(author),
                status: authorPresence?.effective,
              }
            : null,
          attachments,
          reactions: await reactionsFor(ctx, message._id, me._id),
        };
      }),
    );

    const result = { ...page, page: messages };
    if (isFirstPage) {
      try {
        const { cacheSetJson } = await import("./cache");
        await cacheSetJson(cacheKey, result, 30);
      } catch {}
    }
    return result;
  },
});

export const send = mutation({
  args: {
    conversationId: v.id("conversations"),
    text: v.optional(v.string()),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.optional(v.id("_storage")),
          cdnKey: v.optional(v.string()),
          cdnUrl: v.optional(v.string()),
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
    /** Sent from the birthday prompt above the composer. Only honoured when
     * somebody in the conversation is actually having a birthday — the flag is
     * what makes cakes rain down other people's windows, so it can't be
     * something a client just asserts. */
    birthdayWish: v.optional(v.boolean()),
    /** The message being replied to. Dropped silently if it isn't in this
     * conversation (stale client, deleted target) rather than failing the send. */
    replyToId: v.optional(v.id("messages")),
    /** Whether the reply notifies its target. Defaults to true (Discord's
     * behaviour); the composer's "@" toggle sends false. */
    pingReply: v.optional(v.boolean()),
    /** Idempotency key from the durable send outbox. A retry after a lost ack
     * carries the same value; when a row with this `clientId` already exists we
     * hand back its id rather than inserting a second copy. See
     * src/lib/outbox.ts. */
    clientId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { conversationId, text, attachments, birthdayWish, replyToId, pingReply, clientId },
  ) => {
    const me = await getCurrentUserOrThrow(ctx);
    const membership = await requireMembership(ctx, conversationId, me._id);

    if (clientId) {
      const existing = await ctx.db
        .query("messages")
        .withIndex("by_client_id", (q) => q.eq("clientId", clientId))
        .unique();
      if (existing) return existing._id;
    }

    const trimmed = text?.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) {
      throw new Error("Message needs text or an attachment.");
    }

    for (const attachment of attachments ?? []) {
      if (attachment.storageId) {
        await requireWithinUploadLimit(ctx, attachment.storageId, MAX_ATTACHMENT_BYTES, "Attachments");
      } else if (!attachment.cdnKey && !attachment.cdnUrl) {
        throw new Error("Attachment missing storageId/cdnKey");
      }
    }

    const otherMembers = (
      await ctx.db
        .query("conversationMembers")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conversationId),
        )
        .collect()
    ).filter((m) => m.userId !== me._id);

    let isWish = false;
    if (birthdayWish) {
      const others = await Promise.all(otherMembers.map((m) => ctx.db.get(m.userId)));
      isWish = others.some((other) => isBirthdayNow(other));
    }

    // Only honour a reply pointer that's real and in this conversation.
    const replyTarget = replyToId ? await ctx.db.get(replyToId) : null;
    const validReplyToId =
      replyTarget && replyTarget.conversationId === conversationId ? replyToId : undefined;
    // Who, if anyone, the reply itself notifies — the target's author, unless
    // that's the sender or the "@" toggle was off.
    const replyPingUserId =
      validReplyToId && pingReply !== false && replyTarget && replyTarget.authorId !== me._id
        ? replyTarget.authorId
        : null;

    const messageId = await ctx.db.insert("messages", {
      conversationId,
      authorId: me._id,
      text: trimmed || undefined,
      birthdayWish: isWish || undefined,
      replyToId: validReplyToId,
      clientId: clientId || undefined,
    });

    for (const attachment of attachments ?? []) {
      await ctx.db.insert("messageAttachments", { messageId, ...attachment });
    }

    // I've obviously "read" up to the message I just sent.
    await ctx.db.patch(membership._id, { lastReadAt: Date.now() });

    const body = trimmed ? await renderMentionsAsText(ctx, trimmed) : "Sent an attachment";

    // The reply target gets the "replied to you" notification instead of a
    // plain DM one — but only if their settings actually let a reply through.
    // Otherwise they'd get nothing, and a reply is still a DM.
    const replyReachesTarget =
      replyPingUserId !== null &&
      allowsReply(await loadNotificationPolicy(ctx, replyPingUserId));

    await notifyUsers(ctx, {
      userIds: otherMembers
        .map((m) => m.userId)
        .filter((id) => !(replyReachesTarget && id === replyPingUserId)),
      actorId: me._id,
      type: "dm_message",
      conversationId,
      messageId,
      title: me.name,
      body,
    });

    if (replyPingUserId && replyReachesTarget) {
      await notifyUsers(ctx, {
        userIds: [replyPingUserId],
        actorId: me._id,
        type: "reply",
        conversationId,
        messageId,
        title: `${me.name} replied to you`,
        body,
      });
    }

    // Invalidate Redis cache for DMs (hot path) — messages, conversations
    try {
      const { cacheInvalidateKeys } = await import("./cache");
      await cacheInvalidateKeys(`dm:${conversationId}:messages:30`, `dm:${conversationId}:messages:50`, `dm:${conversationId}:messages:20`, `dm:${conversationId}:messages:25`);
      await cacheInvalidateKeys(`user:${me._id}:conversations`);
    } catch {}
    // Also schedule internal invalidation for any prefix scan if needed
    try {
      const { internal } = await import("./_generated/api");
      await ctx.scheduler.runAfter(0, internal.cache.invalidateDmCache, { conversationId });
    } catch {}

    return messageId;
  },
});

/**
 * The newest birthday wish in this conversation, if one is near the top of it.
 *
 * A query of its own rather than something the message list reports, because
 * both people have to see the cakes fall and only one of them sent the
 * message: subscribing to "the latest wish" means the recipient's client is
 * told about it by the same mechanism as the sender's, with no notion of who
 * did what. The client decides whether it's fresh enough to play (see
 * ChatView) — a wish from last year shouldn't rain cakes on someone opening
 * the conversation.
 *
 * Only the last few messages are searched. `birthdayWish` has no index, and a
 * wish that just landed is by definition at the end; scanning a whole
 * conversation to find out that the last one was in March would cost far more
 * than the feature is worth.
 */
const WISH_SEARCH_DEPTH = 20;

export const latestBirthdayWish = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMembership(ctx, conversationId, me._id);

    const recent = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("desc")
      .take(WISH_SEARCH_DEPTH);
    const wish = recent.find((message) => message.birthdayWish === true);
    if (!wish) return null;
    return { id: wish._id, createdAt: wish._creationTime, authorId: wish.authorId };
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
    // No-op when the text is already what we'd write — makes an outbox retry
    // of the same edit converge instead of bumping `editedAt` again.
    if (message.text === trimmed) return;
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
  args: {
    messageId: v.id("messages"),
    emoji: v.string(),
    /** When set, converge to this end state rather than flipping — so an
     * outbox retry of "add 👍" can't land as a double-toggle. Absent keeps the
     * old flip behaviour for any caller that hasn't been migrated. */
    desired: v.optional(v.union(v.literal("add"), v.literal("remove"))),
  },
  handler: async (ctx, { messageId, emoji, desired }) => {
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
    const shouldExist = desired ? desired === "add" : !existing;
    if (existing && !shouldExist) {
      await ctx.db.delete(existing._id);
    } else if (!existing && shouldExist) {
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
          rows.map(async (attachment) => {
            const anyAtt = attachment as unknown as { storageId?: string; cdnUrl?: string; cdnKey?: string };
            const directCdn = anyAtt.cdnUrl ?? (anyAtt.cdnKey ? r2UrlForKey(anyAtt.cdnKey) : null);
            const migratedCdn = anyAtt.storageId ? cdnUrlForStorageId(anyAtt.storageId) : null;
            const cdnUrl = directCdn ?? migratedCdn;
            return {
              id: attachment._id,
              messageId: message._id,
              fileName: attachment.fileName,
              fileType: attachment.fileType,
              fileSize: attachment.fileSize,
              url: cdnUrl ?? (anyAtt.storageId ? await ctx.storage.getUrl(anyAtt.storageId as never) : null),
              createdAt: message._creationTime,
            };
          }),
        );
      }),
    );

    return { ...page, page: perMessage.flat() };
  },
});

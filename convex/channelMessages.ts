import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireCommunity } from "./communities";
import { notifyUsers } from "./notifications";
import { PERMISSIONS, can, getChannelPermissions } from "./permissions";
import { requireWithinUploadLimit } from "./uploadLimits";
import { getCurrentUserOrThrow } from "./users";
import { renderMentionsAsText, resolveChannelMentions } from "./lib/mentions";
import { markChannelRead } from "./channels";

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

/**
 * Per-community presentation for a message author: the nickname and avatar
 * from their server profile (falling back to their global profile), plus the
 * colour of their highest-positioned coloured role.
 *
 * Resolved once per distinct author rather than per message — a page of
 * messages is usually a handful of people talking, so this collapses dozens
 * of lookups into a few.
 */
async function communityAuthorDecorations(
  ctx: QueryCtx,
  communityId: Id<"communities">,
  userIds: Id<"users">[]
) {
  const roles = await ctx.db
    .query("roles")
    .withIndex("by_community", (q) => q.eq("communityId", communityId))
    .collect();
  const roleById = new Map(roles.map((r) => [r._id, r]));

  const entries = await Promise.all(
    userIds.map(async (userId) => {
      const [serverProfile, assigned] = await Promise.all([
        ctx.db
          .query("serverProfiles")
          .withIndex("by_user_community", (q) =>
            q.eq("userId", userId).eq("communityId", communityId)
          )
          .unique(),
        ctx.db
          .query("memberRoles")
          .withIndex("by_member", (q) =>
            q.eq("communityId", communityId).eq("userId", userId)
          )
          .collect(),
      ]);

      // Discord's rule: the name takes the colour of the highest-positioned
      // role that actually defines one, so an uncoloured role above a
      // coloured one doesn't blank the name out.
      const roleColor = assigned
        .map((m) => roleById.get(m.roleId))
        .filter((r): r is Doc<"roles"> => !!r && !!r.color)
        .sort((a, b) => b.position - a.position)[0]?.color;

      return [userId, { serverProfile, roleColor }] as const;
    })
  );
  return new Map(entries);
}

export const list = query({
  args: { channelId: v.id("channels"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { channelId, paginationOpts }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireChannelPerm(ctx, channelId, me._id, PERMISSIONS.VIEW_CHANNELS);

    const channel = await ctx.db.get(channelId);
    if (!channel) throw new Error("Channel not found.");

    const page = await ctx.db
      .query("channelMessages")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .order("desc")
      .paginate(paginationOpts);

    const decorations = await communityAuthorDecorations(
      ctx,
      channel.communityId,
      [...new Set(page.page.map((m) => m.authorId))]
    );

    const messages = await Promise.all(
      page.page.map(async (message) => {
        const author = await ctx.db.get(message.authorId);
        const decoration = decorations.get(message.authorId);
        const serverProfile = decoration?.serverProfile;
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
            ? {
                id: author._id,
                // Server profile overrides win here so a nickname/avatar set
                // for this community is what the channel actually shows.
                name: serverProfile?.displayName ?? author.name,
                username: author.username,
                imageUrl: serverProfile?.imageUrl ?? author.imageUrl,
                bio: serverProfile?.bio ?? author.bio,
                bannerUrl: serverProfile?.bannerUrl ?? author.bannerUrl,
                customStatus: serverProfile?.customStatus ?? author.customStatus,
                roleColor: decoration?.roleColor,
              }
            : null,
          attachments,
          reactions: await reactionsFor(ctx, message._id, me._id),
        };
      })
    );

    return { ...page, page: messages };
  },
});

/** Refuse the action if the member is currently timed out in this channel's
 * community. Checked server-side so hiding the composer is only a courtesy. */
async function requireNotTimedOut(
  ctx: QueryCtx,
  channelId: Id<"channels">,
  userId: Id<"users">
): Promise<void> {
  const channel = await ctx.db.get(channelId);
  if (!channel) return;
  const membership = await ctx.db
    .query("communityMembers")
    .withIndex("by_community_user", (q) =>
      q.eq("communityId", channel.communityId).eq("userId", userId)
    )
    .unique();
  if (membership?.timeoutUntil && membership.timeoutUntil > Date.now()) {
    throw new Error("You're timed out in this server.");
  }
}

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
    await requireNotTimedOut(ctx, channelId, me._id);

    const trimmed = text?.trim();
    if (!trimmed && (!attachments || attachments.length === 0)) {
      throw new Error("Message needs text or an attachment.");
    }

    for (const attachment of attachments ?? []) {
      // Only reachable once the bytes are in storage, so it can't stop an
      // oversized upload — but it does stop it from becoming a message.
      await requireWithinUploadLimit(ctx, attachment.storageId, "Attachments");
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
    // Denormalised so unread state is a field comparison rather than a
    // "newest message" query per channel — see the schema.
    if (channel) await ctx.db.patch(channelId, { lastMessageAt: Date.now() });
    // Having just written it, I've read it.
    if (channel) await markChannelRead(ctx, channelId, channel.communityId, me._id);

    if (channel && trimmed) {
      const mentioned = await resolveChannelMentions(ctx, channel.communityId, trimmed, me._id);
      if (mentioned.length > 0) {
        await notifyUsers(ctx, {
          userIds: mentioned,
          actorId: me._id,
          type: "channel_mention",
          channelId,
          communityId: channel.communityId,
          channelMessageId: messageId,
          title: `${me.name} mentioned you in #${channel.name}`,
          // Plain text, so the `<@id>` tags have to become readable names
          // here — nothing downstream of this renders them.
          body: await renderMentionsAsText(ctx, trimmed),
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

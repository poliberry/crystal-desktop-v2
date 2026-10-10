import { requireCommunityOpen } from "./lib/moderation";
import { paginationOptsValidator } from "convex/server";
import { v, type ObjectType } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireCommunity } from "./communities";
import { notifyUsers } from "./notifications";
import { PERMISSIONS, can, getChannelPermissions } from "./permissions";
import { MAX_ATTACHMENT_BYTES, requireWithinUploadLimit } from "./uploadLimits";
import { getCurrentUserOrThrow } from "./users";
import { unexpiredCustomStatus } from "./lib/activities";
import { effectiveDecoration, isBirthdayNow } from "./lib/birthday";
import { renderMentionsAsText, resolveChannelMentions } from "./lib/mentions";
import { markChannelRead } from "./channels";
import { describeMessage, dispatchMessageCreated, fireCommunityEvent } from "./lib/botEvents";
import type { ActionRow } from "./lib/components";
import type { Embed } from "./lib/embeds";
import { effectiveFileType } from "./lib/mediaType";

function r2UrlForKey(key: string): string | null {
  const base = process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "";
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
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

/** Longest a reply preview snippet gets — a preview is one line. */
const REPLY_SNIPPET_MAX = 140;

/** The compact "replying to…" card for a channel message. See the twin in
 * convex/messages.ts. */
async function resolveReplyPreview(
  ctx: QueryCtx,
  replyToId: Id<"channelMessages"> | undefined
) {
  if (!replyToId) return null;
  const target = await ctx.db.get(replyToId);
  if (!target) {
    return {
      id: replyToId as string,
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
      .query("channelMessageAttachments")
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

const EMPTY_PAGE = { page: [], isDone: true, continueCursor: "" } as const;

export const list = query({
  args: { channelId: v.id("channels"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { channelId, paginationOpts }) => {
    const me = await getCurrentUserOrThrow(ctx);

    // An empty, finished page rather than a throw when the channel is gone or
    // can't be seen any more. The data preloader keeps this subscribed for
    // recently-viewed channels, so deleting or leaving a community re-runs it
    // against a channel that no longer exists — and a throw from a query is an
    // uncaught render error for the whole app.
    const channel = await ctx.db.get(channelId);
    const community = channel ? await ctx.db.get(channel.communityId) : null;
    if (!channel || !community) return EMPTY_PAGE;
    const membership = await ctx.db
      .query("communityMembers")
      .withIndex("by_community_user", (q) => q.eq("communityId", community._id).eq("userId", me._id))
      .unique();
    if (!membership) return EMPTY_PAGE;
    const perms = await getChannelPermissions(ctx, community, channelId, me._id);
    if (!can(perms, PERMISSIONS.VIEW_CHANNELS)) return EMPTY_PAGE;

    const isFirstPage = !paginationOpts.cursor;
    const cacheKey = `channel:${channelId}:messages:${paginationOpts.numItems}`;
    if (isFirstPage) {
      try {
        const { cacheGetJson } = await import("./cache");
        const cached = await cacheGetJson<any>(cacheKey);
        if (cached) return cached;
      } catch {}
    }

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
          attachmentRows.map(async (attachment) => {
            const anyAtt = attachment as unknown as { storageId?: string; cdnUrl?: string; cdnKey?: string };
            const directCdn = anyAtt.cdnUrl ?? (anyAtt.cdnKey ? r2UrlForKey(anyAtt.cdnKey) : null);
            // Only a CDN address the attachment actually has. It used to fall back to
            // `migrated/<storageId>` for any attachment with a Convex file, which
            // is a guess that a copy exists — and 404s for every one not yet
            // copied the moment the CDN is switched on.
            const cdnUrl = directCdn;
            return {
              id: attachment._id,
              fileName: attachment.fileName,
              fileType: effectiveFileType(attachment.fileType, attachment.fileName),
              fileSize: attachment.fileSize,
              url: cdnUrl ?? (anyAtt.storageId ? await ctx.storage.getUrl(anyAtt.storageId as never) : null),
            };
          })
        );
        return {
          id: message._id,
          text: message.text ?? null,
          createdAt: message._creationTime,
          editedAt: message.editedAt ?? null,
          isMine: message.authorId === me._id,
          replyTo: await resolveReplyPreview(ctx, message.replyToId),
          /** Idempotency key of the send that made this row — see the twin in
           * convex/messages.ts and src/lib/outbox-overlay.ts. */
          clientId: message.clientId ?? null,
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
                customStatus: serverProfile?.customStatus ?? unexpiredCustomStatus(author),
                // Not overridden per server: the frame is worn by the account.
                avatarDecoration: effectiveDecoration(author),
                isBirthday: isBirthdayNow(author),
                isBot: !!author.isBot,
                roleColor: decoration?.roleColor,
              }
            : null,
          attachments,
          embeds: message.embeds ?? [],
          components: message.components ?? [],
          reactions: await reactionsFor(ctx, message._id, me._id),
        };
      })
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

/** What sending a message takes. Shared by the `send` mutation and the Bot API, so a bot's message
 * goes through exactly what a person's does: mentions, notifications, unread state, caches. */
const sendArgs = {
  channelId: v.id("channels"),
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
      })
    )
  ),
  /** The message being replied to. Dropped silently unless it's in this
   * channel. */
  replyToId: v.optional(v.id("channelMessages")),
  /** Whether the reply notifies its target — defaults to true, the "@"
   * toggle sends false. */
  pingReply: v.optional(v.boolean()),
  /** Idempotency key from the durable send outbox — see convex/messages.ts
   * and src/lib/outbox.ts. */
  clientId: v.optional(v.string()),
};
export type SendArgs = ObjectType<typeof sendArgs>;

/**
 * Post a message as `me`. The caller has already said who `me` is. Unless `permissionChecked`, this
 * checks they may send in the channel; a bot's caller has done its own check, which is stricter
 * (it also cuts the bot down to what the person who authorised it can still do).
 */
export async function sendChannelMessage(
  ctx: MutationCtx,
  me: Doc<"users">,
  { channelId, text, attachments, replyToId, pingReply, clientId }: SendArgs,
  opts: { permissionChecked?: boolean; /** Already validated by `validateEmbeds`. Only the Bot API passes these. */ embeds?: Embed[]; /** Already validated by `validateComponents`. */ components?: ActionRow[] } = {}
): Promise<Id<"channelMessages">> {
  if (!opts.permissionChecked) await requireChannelPerm(ctx, channelId, me._id, PERMISSIONS.SEND_MESSAGES);
  await requireNotTimedOut(ctx, channelId, me._id);
  {
    const channel = await ctx.db.get(channelId);
    if (channel) await requireCommunityOpen(ctx, channel.communityId, "post");
  }

  if (clientId) {
    const existing = await ctx.db
      .query("channelMessages")
      .withIndex("by_client_id", (q) => q.eq("clientId", clientId))
      .unique();
    if (existing) return existing._id;
  }

  const trimmed = text?.trim();
  if (!trimmed && (!attachments || attachments.length === 0) && !opts.embeds?.length && !opts.components?.length) {
    throw new Error("Message needs text, an attachment, an embed or buttons.");
  }

  for (const attachment of attachments ?? []) {
    if (attachment.storageId) {
      await requireWithinUploadLimit(ctx, attachment.storageId, MAX_ATTACHMENT_BYTES, "Attachments");
    } else if (!attachment.cdnKey && !attachment.cdnUrl) {
      throw new Error("Attachment missing storageId/cdnKey");
    }
  }

  const replyTarget = replyToId ? await ctx.db.get(replyToId) : null;
  const validReplyToId =
    replyTarget && replyTarget.channelId === channelId ? replyToId : undefined;
  const replyPingUserId =
    validReplyToId && pingReply !== false && replyTarget && replyTarget.authorId !== me._id
      ? replyTarget.authorId
      : null;

  const messageId = await ctx.db.insert("channelMessages", {
    channelId,
    authorId: me._id,
    text: trimmed || undefined,
    replyToId: validReplyToId,
    clientId: clientId || undefined,
    ...(opts.embeds?.length ? { embeds: opts.embeds } : {}),
    ...(opts.components?.length ? { components: opts.components } : {}),
  });

  for (const attachment of attachments ?? []) {
    await ctx.db.insert("channelMessageAttachments", { messageId, ...attachment, fileType: effectiveFileType(attachment.fileType, attachment.fileName) });
  }

  const channel = await ctx.db.get(channelId);
  // Denormalised so unread state is a field comparison rather than a
  // "newest message" query per channel — see the schema.
  if (channel) await ctx.db.patch(channelId, { lastMessageAt: Date.now() });
  // Having just written it, I've read it.
  if (channel) await markChannelRead(ctx, channelId, channel.communityId, me._id);

  if (channel && trimmed) {
    const mentioned = await resolveChannelMentions(ctx, channel.communityId, trimmed, me._id);
    // Rendered once and shared by both notifications below — it's a plain
    // text body, so the `<@id>` tags have to become readable names here;
    // nothing downstream of this renders them.
    const bodyText = await renderMentionsAsText(ctx, trimmed);

    if (mentioned.length > 0) {
      await notifyUsers(ctx, {
        userIds: mentioned,
        actorId: me._id,
        type: "channel_mention",
        channelId,
        communityId: channel.communityId,
        channelMessageId: messageId,
        title: `${me.name} mentioned you in #${channel.name}`,
        body: bodyText,
        isMention: true,
      });
    }

    // Everyone else in the channel.
    //
    // Only reaches people whose per-server setting is "all messages":
    // `notifyUsers` asks `allowsChannelMessage(policy, communityId, false)`
    // for each of them, so the default ("mentions only") is untouched and
    // nobody starts getting notified without having asked to be.
    //
    // Membership alone can't decide who this is. A private channel is
    // private because of permission overwrites, so notifying past them
    // would leak both the message and the channel's existence.
    const community = await ctx.db.get(channel.communityId);
    if (community) {
      const mentionedSet = new Set<string>(mentioned);
      const members = await ctx.db
        .query("communityMembers")
        .withIndex("by_community", (q) => q.eq("communityId", channel.communityId))
        .collect();

      const others: Id<"users">[] = [];
      for (const member of members) {
        if (member.userId === me._id || mentionedSet.has(member.userId)) continue;
        // The reply target gets the `reply` notification below instead.
        if (member.userId === replyPingUserId) continue;
        const perms = await getChannelPermissions(ctx, community, channelId, member.userId);
        if (!can(perms, PERMISSIONS.VIEW_CHANNELS)) continue;
        others.push(member.userId);
      }

      if (others.length > 0) {
        await notifyUsers(ctx, {
          userIds: others,
          actorId: me._id,
          type: "channel_mention",
          channelId,
          communityId: channel.communityId,
          channelMessageId: messageId,
          title: `${me.name} in #${channel.name}`,
          body: bodyText,
          isMention: false,
        });
      }
    }
  }

  // The reply ping — even for an attachment-only reply, and regardless of
  // the target's per-server "all messages" setting (a direct reply is
  // addressed to them). Skipped when they were also @-mentioned: that
  // notification is the more specific one.
  if (channel && replyPingUserId) {
    const mentionedReplyTarget =
      trimmed &&
      (await resolveChannelMentions(ctx, channel.communityId, trimmed, me._id)).includes(
        replyPingUserId
      );
    if (!mentionedReplyTarget) {
      await notifyUsers(ctx, {
        userIds: [replyPingUserId],
        actorId: me._id,
        type: "reply",
        channelId,
        communityId: channel.communityId,
        channelMessageId: messageId,
        title: `${me.name} replied to you in #${channel.name}`,
        body: trimmed ? await renderMentionsAsText(ctx, trimmed) : "Sent an attachment",
      });
    }
  }

  try {
    const { cacheInvalidateKeys } = await import("./cache");
    await cacheInvalidateKeys(`channel:${channelId}:messages:30`, `channel:${channelId}:messages:50`, `channel:${channelId}:messages:20`, `channel:${channelId}:messages:25`, `channel:${channelId}:meta`);
  } catch {}
  try {
    const { internal } = await import("./_generated/api");
    await ctx.scheduler.runAfter(0, internal.cache.invalidateChannelCache, { channelId });
  } catch {}

  // Bots in this community that can see the channel are told. Never allowed to get in the way.
  if (channel) await dispatchMessageCreated(ctx, channel, messageId, me);

  return messageId;
}

export const send = mutation({
  args: sendArgs,
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    return sendChannelMessage(ctx, me, args);
  },
});

/** Rewrite a message's text and/or cards. Shared by a person's edit and a bot's. */
export async function editChannelMessage(
  ctx: MutationCtx,
  message: Doc<"channelMessages">,
  change: { text?: string; embeds?: Embed[]; components?: ActionRow[] },
): Promise<void> {
  const patch: Partial<Doc<"channelMessages">> = {};
  if (change.text !== undefined) {
    const t = change.text.trim();
    if (!t && !(change.embeds ?? message.embeds)?.length && !(change.components ?? message.components)?.length) throw new Error("Message can't be empty.");
    patch.text = t || undefined;
  }
  if (change.embeds !== undefined) patch.embeds = change.embeds.length ? change.embeds : undefined;
  if (change.components !== undefined) patch.components = change.components.length ? change.components : undefined;
  // Converge rather than re-stamp `editedAt` when an outbox retry replays the same edit.
  const same = Object.entries(patch).every(([k, v]) => JSON.stringify((message as Record<string, unknown>)[k]) === JSON.stringify(v));
  if (same) return;
  await ctx.db.patch(message._id, { ...patch, editedAt: Date.now() });
  const channel = await ctx.db.get(message.channelId);
  const fresh = await ctx.db.get(message._id);
  if (channel && fresh) await fireCommunityEvent(ctx, channel.communityId, "message.updated", { channelId: channel._id, message: await describeMessage(ctx, fresh) }, { scope: "messages.read", channelId: channel._id, exceptUserId: message.authorId });
}

export const update = mutation({
  args: { messageId: v.id("channelMessages"), text: v.string() },
  handler: async (ctx, { messageId, text }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) return;
    if (message.authorId !== me._id) throw new Error("You can only edit your own messages.");
    if (!text.trim()) throw new Error("Message can't be empty.");
    await editChannelMessage(ctx, message, { text });
  },
});

/** Delete a message and what hangs off it. Shared by a person's delete, a bot's, and bulk delete. */
export async function deleteChannelMessage(ctx: MutationCtx, message: Doc<"channelMessages">, by?: Id<"users">): Promise<void> {
  const [attachments, reactions] = await Promise.all([
    ctx.db.query("channelMessageAttachments").withIndex("by_message", (q) => q.eq("messageId", message._id)).collect(),
    ctx.db.query("channelMessageReactions").withIndex("by_message", (q) => q.eq("messageId", message._id)).collect(),
  ]);
  for (const attachment of attachments) await ctx.db.delete(attachment._id);
  for (const reaction of reactions) await ctx.db.delete(reaction._id);
  await ctx.db.delete(message._id);
  const channel = await ctx.db.get(message.channelId);
  if (channel) await fireCommunityEvent(ctx, channel.communityId, "message.deleted", { channelId: channel._id, messageId: message._id }, { scope: "messages.read", channelId: channel._id, exceptUserId: by });
}

export const remove = mutation({
  args: { messageId: v.id("channelMessages") },
  handler: async (ctx, { messageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) return;

    if (message.authorId !== me._id) {
      await requireChannelPerm(ctx, message.channelId, me._id, PERMISSIONS.MANAGE_MESSAGES);
    }
    await deleteChannelMessage(ctx, message, me._id);
  },
});

/** Put a reaction in (or take it out) for `userId`. Shared by a person and a bot. Returns whether anything changed. */
export async function setChannelReaction(ctx: MutationCtx, message: Doc<"channelMessages">, userId: Id<"users">, emoji: string, desired?: "add" | "remove"): Promise<boolean> {
  const existing = await ctx.db
    .query("channelMessageReactions")
    .withIndex("by_message_user_emoji", (q) => q.eq("messageId", message._id).eq("userId", userId).eq("emoji", emoji))
    .unique();
  const shouldExist = desired ? desired === "add" : !existing;
  let changed = false;
  if (existing && !shouldExist) {
    await ctx.db.delete(existing._id);
    changed = true;
  } else if (!existing && shouldExist) {
    await ctx.db.insert("channelMessageReactions", { messageId: message._id, userId, emoji });
    changed = true;
  }
  if (changed) {
    const channel = await ctx.db.get(message.channelId);
    const user = await ctx.db.get(userId);
    if (channel && user) await fireCommunityEvent(ctx, channel.communityId, shouldExist ? "reaction.added" : "reaction.removed", { channelId: channel._id, messageId: message._id, emoji, user: { id: user._id, username: user.username, name: user.name, isBot: !!user.isBot } }, { scope: "messages.read", channelId: channel._id, exceptUserId: userId });
  }
  return changed;
}

export const toggleReaction = mutation({
  args: {
    messageId: v.id("channelMessages"),
    emoji: v.string(),
    /** Converge to this end state instead of flipping — see the twin in
     * convex/messages.ts. */
    desired: v.optional(v.union(v.literal("add"), v.literal("remove"))),
  },
  handler: async (ctx, { messageId, emoji, desired }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const message = await ctx.db.get(messageId);
    if (!message) throw new Error("Message not found.");
    await requireChannelPerm(ctx, message.channelId, me._id, PERMISSIONS.VIEW_CHANNELS);
    await setChannelReaction(ctx, message, me._id, emoji, desired);
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
          rows.map(async (attachment) => {
            const anyAtt = attachment as unknown as { storageId?: string; cdnUrl?: string; cdnKey?: string };
            const directCdn = anyAtt.cdnUrl ?? (anyAtt.cdnKey ? r2UrlForKey(anyAtt.cdnKey) : null);
            // Only a CDN address the attachment actually has. It used to fall back to
            // `migrated/<storageId>` for any attachment with a Convex file, which
            // is a guess that a copy exists — and 404s for every one not yet
            // copied the moment the CDN is switched on.
            const cdnUrl = directCdn;
            return {
              id: attachment._id,
              messageId: message._id,
              fileName: attachment.fileName,
              fileType: effectiveFileType(attachment.fileType, attachment.fileName),
              fileSize: attachment.fileSize,
              url: cdnUrl ?? (anyAtt.storageId ? await ctx.storage.getUrl(anyAtt.storageId as never) : null),
              createdAt: message._creationTime,
            };
          })
        );
      }),
    );

    return { ...page, page: perMessage.flat() };
  },
});

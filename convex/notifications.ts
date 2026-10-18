import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  allowsCallActivity,
  allowsChannelMessage,
  allowsDirectMessage,
  allowsFriendRequest,
  allowsIncomingCall,
  allowsReply,
  allowsStreamActivity,
  loadNotificationPolicy,
  type NotificationPolicy,
} from "./lib/notificationPolicy";
import { renderMentionsAsText } from "./lib/mentions";
import { e2eeEnforced, publicNotificationBody } from "./lib/e2eeEnforce";
import {
  genericNotificationBody,
  isMessageNotification,
  isSystemAuthor,
  mentionsMe as metadataMentionsMe,
  mustGenericize,
} from "./lib/e2eePure";
import { hasBlocked, isMessageHidden, isSuppressing, windowsByTarget } from "./lib/blocking";
import { PERMISSIONS, can, getChannelPermissions } from "./permissions";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";
import { lastMessageOf, markAllConversationsRead } from "./conversations";
import { deepLinkFor } from "./webPush";

type NotificationType =
  | "dm_message"
  | "channel_mention"
  | "friend_request"
  | "friend_accept"
  | "call_ring"
  | "call_started"
  | "stream_started"
  | "reply";

/** Map a notification type onto the policy question it actually asks. */
function wants(
  policy: NotificationPolicy,
  type: NotificationType,
  communityId?: Id<"communities">,
  isMention = true
): boolean {
  switch (type) {
    case "dm_message":
      return allowsDirectMessage(policy);
    case "friend_request":
    case "friend_accept":
      return allowsFriendRequest(policy);
    case "channel_mention":
      // `isMention` distinguishes the two things that reach this type: a real
      // @-mention, which every server setting short of "none" lets through,
      // and ordinary channel traffic, which only reaches people who have asked
      // for all messages. `allowsChannelMessage` has always encoded both — it
      // just never had a caller for the second until mobile needed one,
      // because desktop covers plain traffic through its own background
      // notifier instead (see `feed` below).
      return communityId
        ? allowsChannelMessage(policy, communityId, isMention)
        : !policy.suppressedBy;
    case "call_ring":
      return allowsIncomingCall(policy);
    case "call_started":
      return allowsCallActivity(policy);
    case "stream_started":
      return allowsStreamActivity(policy);
    case "reply":
      return allowsReply(policy);
  }
}

/**
 * Inserts one `notifications` row per recipient (skipping the actor, so
 * nobody gets notified about their own message/request) and schedules an
 * Expo push for each via `push.sendExpoPush`. A plain helper — not a Convex
 * mutation itself — so it runs inside the same transaction as whatever
 * triggered it (mirrors how `permissions.ts`'s `requireChannelPermission`
 * etc. are consumed directly by other mutations).
 */
export async function notifyUsers(
  ctx: MutationCtx,
  params: {
    userIds: Id<"users">[];
    type: NotificationType;
    actorId?: Id<"users">;
    conversationId?: Id<"conversations">;
    channelId?: Id<"channels">;
    communityId?: Id<"communities">;
    messageId?: Id<"messages">;
    channelMessageId?: Id<"channelMessages">;
    requestId?: Id<"friendRequests">;
    title: string;
    body?: string;
    /** Only meaningful for `channel_mention`: false means ordinary channel
     * traffic, which each recipient's per-server setting has to have opted
     * into. Defaults to true, so every existing caller is unaffected. */
    isMention?: boolean;
    /** The message this is about is end-to-end encrypted. The body is then replaced by a generic
     * one whatever the caller passed: a notification (inbox row, OS toast, push payload) must not
     * carry message text the server isn't allowed to read. */
    encrypted?: boolean;
  }
): Promise<void> {
  const { userIds, actorId, isMention = true, encrypted, ...rest } = params;
  const recipients = Array.from(new Set(userIds)).filter((id) => id !== actorId);
  const actorUser = await ctx.db.get("users", actorId as Id<"users">);
  const channel = rest.channelId ? await ctx.db.get("channels", rest.channelId) : null;
  const community = rest.communityId
    ? await ctx.db.get("communities", rest.communityId)
    : channel
      ? await ctx.db.get("communities", channel.communityId)
      : null;
  const channelLocation = [channel?.name ? `#${channel.name}` : null, community?.name]
    .filter((part): part is string => !!part)
    .join(" / ");
  const pushTitle =
    channelLocation && actorUser?.name
      ? `${actorUser.name} (${channelLocation})`
      : rest.title;

  // Once enforced, nothing but a system message (plaintext by design) may put text in a
  // notification, so a caller that forgot to say `encrypted` (the Bot API's DM send, say) can't leak
  // a body through here.
  const systemAuthored = !!actorUser && isSystemAuthor(actorUser);
  if (
    isMessageNotification(rest.type) &&
    mustGenericize({ encrypted, systemAuthored, enforced: e2eeEnforced() })
  ) {
    rest.body = genericNotificationBody(rest.type, isMention);
  }

  // The message itself, still encrypted, for the recipient's own device to decrypt when the push arrives
  // (see public/sw.js). The server passes along ciphertext and each recipient's wrapped room key; it
  // never sees the text.
  const sealedSource = isMessageNotification(rest.type) ? await sealedMessageFor(ctx, rest) : null;

  for (const userId of recipients) {
    // Checked per recipient rather than once: everyone in a channel has their
    // own DND state and their own settings for that server.
    const policy = await loadNotificationPolicy(ctx, userId);
    if (!wants(policy, rest.type, rest.communityId, isMention)) continue;
    // Nobody is notified by someone they are ignoring or have blocked — nor
    // by someone who has blocked them, since the blocker's @-mention in a
    // shared server shouldn't ping the person they blocked.
    if (
      actorId &&
      ((await isSuppressing(ctx, userId, actorId)) || (await hasBlocked(ctx, actorId, userId)))
    ) {
      continue;
    }

    await ctx.db.insert("notifications", {
      userId,
      actorId,
      read: false,
      createdAt: Date.now(),
      // Only meaningful for channel traffic — see the field in the schema.
      ...(rest.type === "channel_mention" ? { isMention } : {}),
      ...rest,
    });
    await ctx.scheduler.runAfter(0, internal.push.sendExpoPush, {
      userId,
      authorImgUrl: actorUser?.imageUrl && actorUser.imageUrl.length <= 512 ? actorUser.imageUrl : undefined,
      title: pushTitle,
      body: rest.body,
      // Include the ids the mobile app's notification-tap deep link needs
      // (dm_message -> conversationId, channel_mention -> channelId, etc.)
      // so it can navigate without a follow-up query. Additive only —
      // existing `{ type }` consumers are unaffected.
      //
      // senderId/senderName are additive for the same reason, but for the
      // mobile app's notification-service extension: it builds an
      // INSendMessageIntent from them to render the push as an iOS
      // Communication Notification (sender avatar) instead of a plain
      // alert — see crystal-mobile/targets/notification-service.
      data: {
        type: rest.type,
        conversationId: rest.conversationId,
        channelId: rest.channelId,
        communityId: rest.communityId,
        requestId: rest.requestId,
        senderId: actorId,
        senderName: actorUser?.name,
        senderAvatarUrl: actorUser?.imageUrl && actorUser.imageUrl.length <= 512 ? actorUser.imageUrl : undefined,
        channelName: channel?.name,
        communityName: community?.name,
        // So push.ts can apply the same body rule on its own (see `sendExpoPush`).
        systemAuthored,
        isMention,
        // Ciphertext plus this recipient's identity-encrypted room-key wrap.
        // Native notification handlers can decrypt while the app is closed;
        // the server still never receives plaintext.
        sealed: sealedSource ? await sealFor(ctx, sealedSource, userId) : undefined,
      },
    });
    // iPhones ring through CallKit (the system call screen, even with the app
    // closed). Only sent where the recipient's settings let the ring through,
    // which is everything checked above. No-op until APNs is configured.
    if (rest.type === "call_ring" && rest.conversationId) {
      const conversation = await ctx.db.get("conversations", rest.conversationId);
      await ctx.scheduler.runAfter(0, internal.voipNode.sendCallRing, {
        userId,
        conversationId: rest.conversationId,
        title: rest.title,
        callerName: actorUser?.name,
        isGroup: conversation?.type === "group",
      });
    }
    // The installed web app and browsers that allowed notifications. Same title and (already generic,
    // for encrypted messages) body, plus where a tap should take them.
    await ctx.scheduler.runAfter(0, internal.webPushNode.send, {
      userId,
      kind: rest.type,
      title: rest.title,
      body: rest.body,
      icon: actorUser?.imageUrl && !actorUser.imageUrl.endsWith(".svg") ? actorUser.imageUrl : undefined,
      ...deepLinkFor(rest),
      sealed: sealedSource ? await sealFor(ctx, sealedSource, userId) : undefined,
    });
  }
}

/**
 * Every role `userId` holds in a community, including @everyone's: a message that pings the
 * @everyone role pings them. Only needed to read a role mention off an encrypted message's metadata.
 */
async function myRoleIds(
  ctx: QueryCtx,
  communityId: Id<"communities">,
  userId: Id<"users">
): Promise<string[]> {
  const [assigned, everyone] = await Promise.all([
    ctx.db
      .query("memberRoles")
      .withIndex("by_member", (q) => q.eq("communityId", communityId).eq("userId", userId))
      .collect(),
    ctx.db
      .query("roles")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .filter((q) => q.eq(q.field("isEveryone"), true))
      .unique(),
  ]);
  return [...assigned.map((m) => m.roleId as string), ...(everyone ? [everyone._id as string] : [])];
}

/** What a message carried, for a toast that has to say so in one line. */
type AttachmentSummary = { fileName: string; count: number } | null;

/**
 * The files on one message, summarised.
 *
 * Both attachment tables have the same shape and the same index, so this takes
 * the table name — the alternative is the same six lines twice, differing in a
 * string.
 */
async function attachmentSummary(
  ctx: QueryCtx,
  table: "messageAttachments" | "channelMessageAttachments",
  messageId: Id<"messages"> | Id<"channelMessages">
): Promise<AttachmentSummary> {
  const rows = await ctx.db
    .query(table)
    // The union of the two id types is what the shared signature costs; each
    // table only ever sees its own.
    .withIndex("by_message", (q) => q.eq("messageId", messageId as never))
    .collect();
  return rows[0] ? { fileName: rows[0].fileName, count: rows.length } : null;
}

/**
 * One query the Electron main process's background notifier (see
 * electron/backgroundNotifier.ts) subscribes to for everything it needs to
 * decide whether to fire an OS notification: the latest message in every DM/
 * group the user's in, the latest message in every text channel they can
 * view across every community they're in, and their incoming friend
 * requests. Kept as a single query (rather than three) so the headless
 * subscriber only has one subscription to manage.
 *
 * Dedup/self-message/currently-focused-view filtering all happen client
 * side (main process) by diffing against what it saw last — this query just
 * reports current state.
 */
export const feed = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return { conversations: [], channels: [], friendRequests: [], callEvents: [] };

    // Filtering here rather than in the Electron notifier keeps that process
    // dumb, and means the suppressing statuses and the per-server settings
    // hold for push and mobile too. Do Not Disturb and Busy empty the feed
    // outright.
    const policy = await loadNotificationPolicy(ctx, me._id);
    if (policy.suppressedBy)
      return { conversations: [], channels: [], friendRequests: [], callEvents: [] };

    // Call activity (ring / join / stream) rides along on the persisted
    // notification rows `notifyUsers` already wrote — which are policy-filtered
    // at write time, so nothing has to be re-derived here. The notifier diffs
    // these by id like it does friend requests; only recent ones are worth a
    // toast (an old row is history, not an event).
    const CALL_EVENT_WINDOW_MS = 5 * 60_000;
    const recentNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_user_created", (q) => q.eq("userId", me._id))
      .order("desc")
      .take(20);
    const callEvents = await Promise.all(
      recentNotifications
        .filter(
          (n) =>
            (n.type === "call_ring" ||
              n.type === "call_started" ||
              n.type === "stream_started") &&
            Date.now() - n.createdAt < CALL_EVENT_WINDOW_MS
        )
        .map(async (n) => {
          const actor = n.actorId ? await ctx.db.get(n.actorId) : null;
          return {
            id: n._id,
            type: n.type,
            title: n.title,
            body: n.body ?? "",
            actorImageUrl: actor?.imageUrl,
            conversationId: n.conversationId,
            channelId: n.channelId,
            communityId: n.communityId,
          };
        })
    );

    // Unlike the notification rows above, this reads messages directly, so the
    // viewer's ignore/block windows have to be applied here — or the desktop
    // would toast a message the conversation itself no longer shows.
    const hidden = await windowsByTarget(ctx, me._id);
    const memberships = await ctx.db
      .query("conversationMembers")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();
    const conversations = (
      await Promise.all(
        memberships.map(async (membership) => {
          const conversation = await ctx.db.get(membership.conversationId);
          if (!conversation) return null;
          const lastMessage = await lastMessageOf(ctx, conversation._id, hidden);
          if (!lastMessage) return null;
          const author = await ctx.db.get(lastMessage.authorId);

          return {
            conversationId: conversation._id,
            conversationName:
              conversation.name ?? (conversation.type === "dm" ? (author?.name ?? "Direct message") : "Group"),
            messageId: lastMessage._id,
            authorId: lastMessage.authorId,
            authorName: author?.name ?? "Someone",
            // For the desktop toast's icon — a notification is easier to
            // place at a glance from a face than from a name.
            authorImageUrl: author?.imageUrl,
            // Legacy rows: readable rather than stored — a toast has nowhere
            // to draw a custom emoji, so `<:jeff:id>` becomes `:jeff:`. An
            // encrypted row has no text the server may read, so a client that
            // can't decrypt gets the generic line and one that can uses `enc`.
            text: lastMessage.enc
              ? genericNotificationBody("dm_message")
              : await renderMentionsAsText(ctx, lastMessage.text ?? ""),
            enc: lastMessage.enc ?? null,
            replyToId: lastMessage.replyToId ?? null,
            mentionsMe: lastMessage.enc
              ? metadataMentionsMe(lastMessage.mentions, me._id)
              : (lastMessage.text ?? "").includes(`<@${me._id}>`),
            attachment: await attachmentSummary(ctx, "messageAttachments", lastMessage._id),
            createdAt: lastMessage._creationTime,
          };
        })
      )
    ).filter((c): c is NonNullable<typeof c> => c !== null);

    const communityMemberships = await ctx.db
      .query("communityMembers")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();

    const channels: {
      channelId: Id<"channels">;
      channelName: string;
      communityId: Id<"communities">;
      communityName: string;
      messageId: Id<"channelMessages">;
      authorId: Id<"users">;
      authorName: string;
      authorImageUrl?: string;
      text: string;
      /** Ciphertext of the last message, for the client to decrypt; null for legacy rows. */
      enc: Doc<"channelMessages">["enc"] | null;
      replyToId: Id<"channelMessages"> | null;
      mentionsMe: boolean;
      attachment: AttachmentSummary;
      createdAt: number;
    }[] = [];

    for (const cm of communityMemberships) {
      const community = await ctx.db.get(cm.communityId);
      if (!community) continue;
      const communityChannels = await ctx.db
        .query("channels")
        .withIndex("by_community", (q) => q.eq("communityId", cm.communityId))
        .collect();

      for (const channel of communityChannels) {
        if (channel.type !== "text") continue;
        const perms = await getChannelPermissions(ctx, community, channel._id, me._id);
        if (!can(perms, PERMISSIONS.VIEW_CHANNELS)) continue;

        const [lastMessage] = await ctx.db
          .query("channelMessages")
          .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
          .order("desc")
          .take(1);
        if (!lastMessage) continue;
        if (isMessageHidden(hidden, lastMessage.authorId, lastMessage._creationTime)) continue;

        // An encrypted row is routed from its mention metadata (the text is
        // not the server's to parse); a legacy row keeps the old scan.
        const mentionsMe = lastMessage.enc
          ? metadataMentionsMe(
              lastMessage.mentions,
              me._id,
              lastMessage.mentions?.roles.length ? await myRoleIds(ctx, community._id, me._id) : []
            )
          : (lastMessage.text ?? "").includes(`<@${me._id}>`);
        if (!allowsChannelMessage(policy, community._id, mentionsMe)) continue;

        const author = await ctx.db.get(lastMessage.authorId);

        channels.push({
          channelId: channel._id,
          channelName: channel.name,
          communityId: community._id,
          communityName: community.name,
          messageId: lastMessage._id,
          authorId: lastMessage.authorId,
          authorName: author?.name ?? "Someone",
          authorImageUrl: author?.imageUrl,
          text: lastMessage.enc
            ? genericNotificationBody("channel_mention", mentionsMe)
            : await renderMentionsAsText(ctx, lastMessage.text ?? ""),
          enc: lastMessage.enc ?? null,
          replyToId: lastMessage.replyToId ?? null,
          mentionsMe,
          attachment: await attachmentSummary(
            ctx,
            "channelMessageAttachments",
            lastMessage._id
          ),
          createdAt: lastMessage._creationTime,
        });
      }
    }

    const incomingRequests = allowsFriendRequest(policy)
      ? await ctx.db
          .query("friendRequests")
          .withIndex("by_recipient", (q) => q.eq("recipientId", me._id))
          .collect()
      : [];
    const friendRequests = await Promise.all(
      incomingRequests.map(async (r) => {
        const requester = await ctx.db.get(r.requesterId);
        return {
          requestId: r._id,
          createdAt: r.createdAt,
          fromName: requester?.name ?? "Someone",
          fromImageUrl: requester?.imageUrl,
        };
      })
    );

    return {
      conversations: allowsDirectMessage(policy) ? conversations : [],
      channels,
      friendRequests,
      callEvents,
    };
  },
});

/**
 * The ciphertext a message notification is about, for the recipient's client to open.
 *
 * The row's `body` is generic for an encrypted message (the server can't read it), so a client
 * holding the room key decrypts this instead. Only ever the stored envelope: never plaintext, and
 * nothing at all once the caller has left the conversation or the message is gone. Channel access is
 * checked at community level only (a full permission walk per row would be the fanout this list is
 * trying to avoid); without the room key the envelope is unreadable anyway.
 */
export type NotificationMessageSource = {
  authorId: Id<"users">;
  enc: NonNullable<Doc<"messages">["enc"]>;
};

export async function encryptedSourceOf(
  ctx: QueryCtx,
  row: Pick<Doc<"notifications">, "type" | "messageId" | "channelMessageId" | "conversationId" | "channelId" | "communityId">,
  me: Id<"users">
): Promise<NotificationMessageSource | null> {
  if (!isMessageNotification(row.type)) return null;
  if (row.messageId && row.conversationId) {
    const [message, member] = await Promise.all([
      ctx.db.get(row.messageId),
      ctx.db
        .query("conversationMembers")
        .withIndex("by_conversation_user", (q) =>
          q.eq("conversationId", row.conversationId!).eq("userId", me)
        )
        .first(),
    ]);
    if (!member || !message?.enc || message.conversationId !== row.conversationId) return null;
    return { authorId: message.authorId, enc: message.enc };
  }
  if (row.channelMessageId && row.channelId) {
    const message = await ctx.db.get(row.channelMessageId);
    if (!message?.enc || message.channelId !== row.channelId) return null;
    // A community membership check is not sufficient: private-channel
    // overwrites can revoke VIEW_CHANNELS while the recipient still has a
    // previously cached room key. Re-check the current channel permission
    // before returning ciphertext for client-side decryption.
    const channel = await ctx.db.get(row.channelId);
    if (!channel) return null;
    const community = await ctx.db.get(channel.communityId);
    if (!community || (row.communityId && row.communityId !== community._id)) return null;
    const perms = await getChannelPermissions(ctx, community, channel._id, me);
    if (!can(perms, PERMISSIONS.VIEW_CHANNELS)) return null;
    return { authorId: message.authorId, enc: message.enc };
  }
  return null;
}

// --- Mobile: persisted notifications feed -----------------------------------

/** Paginated, newest-first, enriched with the actor's name/avatar and (for
 * channel mentions) the channel/community names — enough for the mobile
 * Notifications tab to render a row without a follow-up query per item. */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return { page: [], isDone: true, continueCursor: "" };

    const page = await ctx.db
      .query("notifications")
      .withIndex("by_user_created", (q) => q.eq("userId", me._id))
      .order("desc")
      .paginate(paginationOpts);

    const items = await Promise.all(
      page.page.map(async (n) => {
        const [actor, channel, community, message] = await Promise.all([
          n.actorId ? ctx.db.get(n.actorId) : null,
          n.channelId ? ctx.db.get(n.channelId) : null,
          n.communityId ? ctx.db.get(n.communityId) : null,
          encryptedSourceOf(ctx, n, me._id),
        ]);
        return {
          id: n._id,
          type: n.type,
          title: n.title,
          // Rows written before enforcement hold the message's text; once it is
          // on they are served generic (system messages excepted).
          body: publicNotificationBody(n, actor),
          read: n.read,
          createdAt: n.createdAt,
          actor: actor ? { id: actor._id, name: actor.name, imageUrl: actor.imageUrl } : null,
          conversationId: n.conversationId ?? null,
          channelId: n.channelId ?? null,
          channelName: channel?.name ?? null,
          communityId: n.communityId ?? null,
          communityName: community?.name ?? null,
          requestId: n.requestId ?? null,
          /** The encrypted message behind a message notification, for the client to decrypt in
           * place of the generic `body`. Null for legacy rows and non-message notifications. */
          message,
        };
      })
    );

    return { ...page, page: items };
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return 0;
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", me._id).eq("read", false))
      .collect();
    return unread.length;
  },
});

/** Unread messages, replies and mentions that are likely to need a response. */
export const priorityCount = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return 0;
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", me._id).eq("read", false))
      .collect();
    return unread.filter((item) => item.type === "dm_message" || item.type === "reply" || item.type === "channel_mention").length;
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const notification = await ctx.db.get(notificationId);
    if (!notification || notification.userId !== me._id) return;
    if (!notification.read) await ctx.db.patch(notificationId, { read: true });
  },
});

/**
 * Clear the inbox, and the unread DMs it was telling you about.
 *
 * The notification rows and a conversation's `lastReadAt` are separate records
 * of the same fact, so clearing only the former emptied the inbox badge while
 * leaving the DMs lit in the rail — which reads as the button not having
 * worked. Channels are deliberately left alone: their indicator means "someone
 * said something", which reading the inbox doesn't make untrue.
 */
export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrThrow(ctx);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", me._id).eq("read", false))
      .collect();
    for (const n of unread) await ctx.db.patch(n._id, { read: true });
    await markAllConversationsRead(ctx, me._id);
  },
});

/**
 * Delete the inbox outright.
 *
 * Distinct from marking read, which keeps the history and only stops it
 * nagging — this is for a user who wants the list gone. Read state elsewhere
 * (conversations, channels) is untouched: throwing away the record of being
 * told about something isn't a claim to have read it.
 */
export const clearAll = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrThrow(ctx);
    const mine = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();
    for (const notification of mine) await ctx.db.delete(notification._id);
  },
});

/**
 * The newest notification's identity, for the in-app "new message" chime.
 *
 * Deliberately tiny: the client only needs to know *that* something arrived,
 * and subscribing to the full `list` query just to detect a new head would
 * re-fetch every notification body on each change.
 */
export const latest = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    const [newest] = await ctx.db
      .query("notifications")
      .withIndex("by_user_created", (q) => q.eq("userId", me._id))
      .order("desc")
      .take(1);
    return newest ? { id: newest._id, createdAt: newest.createdAt, type: newest.type } : null;
  },
});


type SealedSource = {
  scope: "conversation" | "channel";
  targetId: string;
  authorId: string;
  keyId: Id<"e2eeKeys">;
  iv: string;
  ct: string;
};

/** Expo/FCM cap data-only pushes at about 4 KB; reserve space for the wrapped room key and sender metadata. */
const MAX_SEALED_CT = 1400;

async function sealedMessageFor(
  ctx: MutationCtx,
  n: { messageId?: Id<"messages">; channelMessageId?: Id<"channelMessages">; conversationId?: Id<"conversations">; channelId?: Id<"channels"> },
): Promise<SealedSource | null> {
  if (n.messageId) {
    const m = await ctx.db.get(n.messageId);
    if (!m?.enc || m.enc.ct.length > MAX_SEALED_CT) return null;
    return { scope: "conversation", targetId: m.conversationId, authorId: m.authorId, keyId: m.enc.keyId as Id<"e2eeKeys">, iv: m.enc.iv, ct: m.enc.ct };
  }
  if (n.channelMessageId) {
    const m = await ctx.db.get(n.channelMessageId);
    if (!m?.enc || m.enc.ct.length > MAX_SEALED_CT) return null;
    return { scope: "channel", targetId: m.channelId, authorId: m.authorId, keyId: m.enc.keyId as Id<"e2eeKeys">, iv: m.enc.iv, ct: m.enc.ct };
  }
  return null;
}

/** The sealed message plus this recipient's copy of the room key (itself encrypted to their identity key). */
async function sealFor(ctx: MutationCtx, source: SealedSource, userId: Id<"users">) {
  const wrap = await ctx.db
    .query("e2eeKeyWraps")
    .withIndex("by_key_user", (q) => q.eq("keyId", source.keyId).eq("userId", userId))
    .first();
  if (!wrap) return undefined;
  return { ...source, keyId: source.keyId as string, userId: userId as string, wrapped: wrap.wrapped };
}

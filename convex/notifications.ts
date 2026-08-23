import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import {
  allowsChannelMessage,
  allowsDirectMessage,
  allowsFriendRequest,
  loadNotificationPolicy,
  type NotificationPolicy,
} from "./lib/notificationPolicy";
import { PERMISSIONS, can, getChannelPermissions } from "./permissions";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";
import { markAllConversationsRead } from "./conversations";

type NotificationType = "dm_message" | "channel_mention" | "friend_request" | "friend_accept";

/** Map a notification type onto the policy question it actually asks. */
function wants(
  policy: NotificationPolicy,
  type: NotificationType,
  communityId?: Id<"communities">
): boolean {
  switch (type) {
    case "dm_message":
      return allowsDirectMessage(policy);
    case "friend_request":
    case "friend_accept":
      return allowsFriendRequest(policy);
    case "channel_mention":
      // Everything reaching `notifyUsers` with this type really is a mention;
      // plain channel traffic never creates a notification row, it only
      // surfaces through the desktop feed below.
      return communityId ? allowsChannelMessage(policy, communityId, true) : !policy.dnd;
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
  }
): Promise<void> {
  const { userIds, actorId, ...rest } = params;
  const recipients = Array.from(new Set(userIds)).filter((id) => id !== actorId);
  const actorUser = await ctx.db.get("users", actorId as Id<"users">);

  for (const userId of recipients) {
    // Checked per recipient rather than once: everyone in a channel has their
    // own DND state and their own settings for that server.
    const policy = await loadNotificationPolicy(ctx, userId);
    if (!wants(policy, rest.type, rest.communityId)) continue;

    await ctx.db.insert("notifications", {
      userId,
      actorId,
      read: false,
      createdAt: Date.now(),
      ...rest,
    });
    await ctx.scheduler.runAfter(0, internal.push.sendExpoPush, {
      userId,
      authorImgUrl: actorUser?.imageUrl,
      title: rest.title,
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
      },
    });
  }
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
    if (!me) return { conversations: [], channels: [], friendRequests: [] };

    // Filtering here rather than in the Electron notifier keeps that process
    // dumb, and means Do Not Disturb and the per-server settings hold for
    // push and mobile too. DND empties the feed outright.
    const policy = await loadNotificationPolicy(ctx, me._id);
    if (policy.dnd) return { conversations: [], channels: [], friendRequests: [] };

    const memberships = await ctx.db
      .query("conversationMembers")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();
    const conversations = (
      await Promise.all(
        memberships.map(async (membership) => {
          const conversation = await ctx.db.get(membership.conversationId);
          if (!conversation) return null;
          const [lastMessage] = await ctx.db
            .query("messages")
            .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
            .order("desc")
            .take(1);
          if (!lastMessage) return null;
          const author = await ctx.db.get(lastMessage.authorId);

          return {
            conversationId: conversation._id,
            conversationName:
              conversation.name ?? (conversation.type === "dm" ? (author?.name ?? "Direct message") : "Group"),
            messageId: lastMessage._id,
            authorId: lastMessage.authorId,
            authorName: author?.name ?? "Someone",
            text: lastMessage.text ?? "",
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
      text: string;
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

        const mentionsMe = (lastMessage.text ?? "").includes(`<@${me._id}>`);
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
          text: lastMessage.text ?? "",
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
        return { requestId: r._id, createdAt: r.createdAt, fromName: requester?.name ?? "Someone" };
      })
    );

    return {
      conversations: allowsDirectMessage(policy) ? conversations : [],
      channels,
      friendRequests,
    };
  },
});

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
        const [actor, channel, community] = await Promise.all([
          n.actorId ? ctx.db.get(n.actorId) : null,
          n.channelId ? ctx.db.get(n.channelId) : null,
          n.communityId ? ctx.db.get(n.communityId) : null,
        ]);
        return {
          id: n._id,
          type: n.type,
          title: n.title,
          body: n.body ?? null,
          read: n.read,
          createdAt: n.createdAt,
          actor: actor ? { id: actor._id, name: actor.name, imageUrl: actor.imageUrl } : null,
          conversationId: n.conversationId ?? null,
          channelId: n.channelId ?? null,
          channelName: channel?.name ?? null,
          communityId: n.communityId ?? null,
          communityName: community?.name ?? null,
          requestId: n.requestId ?? null,
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

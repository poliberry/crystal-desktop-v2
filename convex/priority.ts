import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { renderMentionsAsText } from "./lib/mentions";
import { allowsFriendRequest, loadNotificationPolicy } from "./lib/notificationPolicy";
import { PERMISSIONS, can, getChannelPermissions } from "./permissions";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

/**
 * The sidebar's Priority card: conversations and channels the caller has
 * marked as VIPs, and the handful of notifications that can't wait.
 *
 * Conversations come back as bare ids. The client already holds every
 * conversation with its preview, presence and unread state
 * (`conversations.listMine`), and re-deriving all of that here would be a
 * second copy that could disagree with the DM list sitting right below it.
 * Channels have no such list to lean on, so they come back resolved.
 */

/** Notifications older than this are history, not something to act on now. */
const CALL_ALERT_WINDOW_MS = 15 * 60_000;

/** The card is a glance, not an inbox — the inbox is one click away. */
const MAX_ALERTS = 6;

async function priorityRow(
  ctx: QueryCtx,
  userId: Id<"users">,
  target: { conversationId: Id<"conversations"> } | { channelId: Id<"channels"> }
): Promise<Doc<"priorityItems"> | null> {
  if ("conversationId" in target) {
    return ctx.db
      .query("priorityItems")
      .withIndex("by_user_conversation", (q) =>
        q.eq("userId", userId).eq("conversationId", target.conversationId)
      )
      .unique();
  }
  return ctx.db
    .query("priorityItems")
    .withIndex("by_user_channel", (q) => q.eq("userId", userId).eq("channelId", target.channelId))
    .unique();
}

/** Drop a conversation's priority row — for when the caller can no longer see
 * it (closing the DM), mirroring how closing also drops a pin. */
export async function clearConversationPriority(
  ctx: MutationCtx,
  userId: Id<"users">,
  conversationId: Id<"conversations">
): Promise<void> {
  const row = await priorityRow(ctx, userId, { conversationId });
  if (row) await ctx.db.delete(row._id);
}

export const setConversation = mutation({
  args: { conversationId: v.id("conversations"), priority: v.boolean() },
  handler: async (ctx, { conversationId, priority }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const existing = await priorityRow(ctx, me._id, { conversationId });

    if (!priority) {
      if (existing) await ctx.db.delete(existing._id);
      return;
    }
    if (existing) return;

    const membership = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversationId).eq("userId", me._id)
      )
      .unique();
    if (!membership) throw new Error("You're not in this conversation.");

    await ctx.db.insert("priorityItems", { userId: me._id, conversationId, createdAt: Date.now() });
  },
});

export const setChannel = mutation({
  args: { channelId: v.id("channels"), priority: v.boolean() },
  handler: async (ctx, { channelId, priority }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const existing = await priorityRow(ctx, me._id, { channelId });

    if (!priority) {
      if (existing) await ctx.db.delete(existing._id);
      return;
    }
    if (existing) return;

    const channel = await ctx.db.get(channelId);
    if (!channel) throw new Error("Channel not found.");
    const community = await ctx.db.get(channel.communityId);
    if (!community) throw new Error("Channel not found.");
    const perms = await getChannelPermissions(ctx, community, channelId, me._id);
    if (!can(perms, PERMISSIONS.VIEW_CHANNELS)) throw new Error("You can't see this channel.");

    await ctx.db.insert("priorityItems", { userId: me._id, channelId, createdAt: Date.now() });
  },
});

/** The caller's VIPs, oldest first — the order they were added in, so the card
 * doesn't reshuffle every time someone speaks. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];

    const rows = (
      await ctx.db
        .query("priorityItems")
        .withIndex("by_user", (q) => q.eq("userId", me._id))
        .collect()
    ).sort((a, b) => a.createdAt - b.createdAt);

    const unreadMentions = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", me._id).eq("read", false))
      .collect();

    const items = await Promise.all(
      rows.map(async (row) => {
        if (row.conversationId) {
          return { kind: "conversation" as const, conversationId: row.conversationId };
        }
        if (!row.channelId) return null;

        const channel = await ctx.db.get(row.channelId);
        if (!channel) return null;
        const community = await ctx.db.get(channel.communityId);
        if (!community) return null;

        // Lost access since it was marked — it stays marked, so it comes back
        // if access does, but there's nothing to show meanwhile.
        const perms = await getChannelPermissions(ctx, community, channel._id, me._id);
        if (!can(perms, PERMISSIONS.VIEW_CHANNELS)) return null;

        const [read, lastMessage] = await Promise.all([
          ctx.db
            .query("channelReads")
            .withIndex("by_user_channel", (q) => q.eq("userId", me._id).eq("channelId", channel._id))
            .unique(),
          ctx.db
            .query("channelMessages")
            .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
            .order("desc")
            .take(1)
            .then((rows) => rows[0]),
        ]);

        let last: {
          authorName: string;
          text: string;
          attachmentName: string | null;
          createdAt: number;
        } | null = null;
        if (lastMessage) {
          const [author, attachments] = await Promise.all([
            ctx.db.get(lastMessage.authorId),
            ctx.db
              .query("channelMessageAttachments")
              .withIndex("by_message", (q) => q.eq("messageId", lastMessage._id))
              .collect(),
          ]);
          last = {
            authorName: author?.name ?? "Someone",
            text: await renderMentionsAsText(ctx, lastMessage.text ?? ""),
            attachmentName: attachments[0]?.fileName ?? null,
            createdAt: lastMessage._creationTime,
          };
        }

        return {
          kind: "channel" as const,
          channelId: channel._id,
          channelName: channel.name,
          channelType: channel.type,
          communityId: community._id,
          communityName: community.name,
          communityImageUrl: community.imageUrl ?? null,
          unread:
            !!channel.lastMessageAt &&
            channel.lastMessageAt > (read?.lastReadAt ?? 0) &&
            lastMessage?.authorId !== me._id,
          mentionCount: unreadMentions.filter(
            (n) => n.type === "channel_mention" && n.channelId === channel._id
          ).length,
          last,
        };
      })
    );

    return items.filter((item): item is NonNullable<typeof item> => item !== null);
  },
});

/**
 * Things that are about now: a friend request waiting, someone pinging you, a
 * reply, a call or stream starting where you are.
 *
 * Incoming rings are not here — they already take over the screen
 * (`incoming-call.tsx`) and a second, quieter copy of an alarm is just noise.
 * Do Not Disturb and Busy empty the list, the same as they do every other
 * delivery path.
 */
export const alerts = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];

    const policy = await loadNotificationPolicy(ctx, me._id);
    if (policy.suppressedBy) return [];

    const now = Date.now();

    const [requests, unread] = await Promise.all([
      allowsFriendRequest(policy)
        ? ctx.db
            .query("friendRequests")
            .withIndex("by_recipient", (q) => q.eq("recipientId", me._id))
            .collect()
        : [],
      ctx.db
        .query("notifications")
        .withIndex("by_user_read", (q) => q.eq("userId", me._id).eq("read", false))
        .collect(),
    ]);

    type Alert = {
      id: string;
      kind: "friend_request" | "mention" | "reply" | "call" | "stream";
      title: string;
      body: string | null;
      actorName: string | null;
      actorImageUrl: string | null;
      createdAt: number;
      /** Set for notification-backed alerts, so dismissing marks it read. */
      notificationId: Id<"notifications"> | null;
      conversationId: Id<"conversations"> | null;
      channelId: Id<"channels"> | null;
      communityId: Id<"communities"> | null;
    };

    const alerts: Alert[] = [];

    for (const request of requests) {
      const requester = await ctx.db.get(request.requesterId);
      if (!requester) continue;
      alerts.push({
        id: request._id,
        kind: "friend_request",
        title: `${requester.name} sent you a friend request`,
        body: null,
        actorName: requester.name,
        actorImageUrl: requester.imageUrl ?? null,
        createdAt: request.createdAt,
        notificationId: null,
        conversationId: null,
        channelId: null,
        communityId: null,
      });
    }

    for (const n of unread) {
      let kind: Alert["kind"] | null = null;
      if (n.type === "channel_mention") {
        if (n.isMention ?? n.title.includes(" mentioned you in ")) kind = "mention";
      } else if (n.type === "reply") {
        kind = "reply";
      } else if (n.type === "call_started" && now - n.createdAt < CALL_ALERT_WINDOW_MS) {
        kind = "call";
      } else if (n.type === "stream_started" && now - n.createdAt < CALL_ALERT_WINDOW_MS) {
        kind = "stream";
      }
      if (!kind) continue;

      const actor = n.actorId ? await ctx.db.get(n.actorId) : null;
      alerts.push({
        id: n._id,
        kind,
        title: n.title,
        body: n.body ?? null,
        actorName: actor?.name ?? null,
        actorImageUrl: actor?.imageUrl ?? null,
        createdAt: n.createdAt,
        notificationId: n._id,
        conversationId: n.conversationId ?? null,
        channelId: n.channelId ?? null,
        communityId: n.communityId ?? null,
      });
    }

    return alerts.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_ALERTS);
  },
});

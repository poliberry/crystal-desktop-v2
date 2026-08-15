import type { Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { PERMISSIONS, can, getChannelPermissions } from "./permissions";
import { getCurrentUserOrNull } from "./users";

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

    const incomingRequests = await ctx.db
      .query("friendRequests")
      .withIndex("by_recipient", (q) => q.eq("recipientId", me._id))
      .collect();
    const friendRequests = await Promise.all(
      incomingRequests.map(async (r) => {
        const requester = await ctx.db.get(r.requesterId);
        return { requestId: r._id, createdAt: r.createdAt, fromName: requester?.name ?? "Someone" };
      })
    );

    return { conversations, channels, friendRequests };
  },
});

import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { notifyUsers } from "./notifications";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";
import { visibleActivities, visibleCustomStatus } from "./lib/activities";
import { effectiveDecoration, isBirthdayNow } from "./lib/birthday";

async function presenceFor(ctx: QueryCtx, userId: Id<"users">) {
  return ctx.db
    .query("presence")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

function summarize(user: Doc<"users">, presence: Doc<"presence"> | null) {
  const status = presence?.effective ?? "offline";
  return {
    id: user._id,
    name: user.name,
    username: user.username,
    imageUrl: user.imageUrl,
    /** Cosmetics and activity, so a friend row can say what they're up to
     * rather than only whether they're reachable. */
    customStatus: visibleCustomStatus(user, status),
    nameplateUrl: user.nameplateUrl,
    avatarDecoration: effectiveDecoration(user),
    isBirthday: isBirthdayNow(user),
    status,
    activities: visibleActivities(presence, user),
  };
}

export const listFriends = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const rows = await ctx.db
      .query("friendships")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .collect();
    const friends = await Promise.all(
      rows.map(async (row) => {
        const friend = await ctx.db.get(row.friendId);
        if (!friend) return null;
        return summarize(friend, await presenceFor(ctx, row.friendId));
      })
    );
    return friends.filter((f): f is NonNullable<typeof f> => f !== null);
  },
});

export const listIncomingRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const rows = await ctx.db
      .query("friendRequests")
      .withIndex("by_recipient", (q) => q.eq("recipientId", me._id))
      .collect();
    const requests = await Promise.all(
      rows.map(async (row) => {
        const requester = await ctx.db.get(row.requesterId);
        if (!requester) return null;
        return { requestId: row._id, createdAt: row.createdAt, user: summarize(requester, null) };
      })
    );
    return requests.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

export const listOutgoingRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const rows = await ctx.db
      .query("friendRequests")
      .withIndex("by_requester", (q) => q.eq("requesterId", me._id))
      .collect();
    const requests = await Promise.all(
      rows.map(async (row) => {
        const recipient = await ctx.db.get(row.recipientId);
        if (!recipient) return null;
        return { requestId: row._id, createdAt: row.createdAt, user: summarize(recipient, null) };
      })
    );
    return requests.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

/**
 * How the caller stands with another user, so a profile card can show one
 * button that means the right thing: add them, cancel a request you sent,
 * accept one they sent, or just message them.
 */
export const relationshipWith = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return { kind: "none" as const };
    if (me._id === userId) return { kind: "self" as const };

    const friendship = await ctx.db
      .query("friendships")
      .withIndex("by_owner_friend", (q) => q.eq("ownerId", me._id).eq("friendId", userId))
      .unique();
    if (friendship) return { kind: "friends" as const };

    const outgoing = await ctx.db
      .query("friendRequests")
      .withIndex("by_pair", (q) => q.eq("requesterId", me._id).eq("recipientId", userId))
      .unique();
    if (outgoing) return { kind: "outgoing" as const, requestId: outgoing._id };

    const incoming = await ctx.db
      .query("friendRequests")
      .withIndex("by_pair", (q) => q.eq("requesterId", userId).eq("recipientId", me._id))
      .unique();
    if (incoming) return { kind: "incoming" as const, requestId: incoming._id };

    return { kind: "none" as const };
  },
});

export const sendFriendRequest = mutation({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const normalized = username.trim().toLowerCase();
    if (!normalized) throw new Error("Enter a username.");

    const target = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", normalized))
      .unique();
    if (!target) throw new Error("No user found with that username.");
    if (target._id === me._id) throw new Error("You can't add yourself.");

    const alreadyFriends = await ctx.db
      .query("friendships")
      .withIndex("by_owner_friend", (q) => q.eq("ownerId", me._id).eq("friendId", target._id))
      .unique();
    if (alreadyFriends) throw new Error("You're already friends.");

    const reverseRequest = await ctx.db
      .query("friendRequests")
      .withIndex("by_pair", (q) => q.eq("requesterId", target._id).eq("recipientId", me._id))
      .unique();
    if (reverseRequest) {
      await ctx.db.delete(reverseRequest._id);
      const now = Date.now();
      await ctx.db.insert("friendships", { ownerId: me._id, friendId: target._id, createdAt: now });
      await ctx.db.insert("friendships", { ownerId: target._id, friendId: me._id, createdAt: now });
      await notifyUsers(ctx, {
        userIds: [target._id],
        actorId: me._id,
        type: "friend_accept",
        title: `You and ${me.name} are now friends`,
      });
      return { status: "accepted" as const };
    }

    const existingRequest = await ctx.db
      .query("friendRequests")
      .withIndex("by_pair", (q) => q.eq("requesterId", me._id).eq("recipientId", target._id))
      .unique();
    if (existingRequest) throw new Error("Friend request already sent.");

    const requestId = await ctx.db.insert("friendRequests", {
      requesterId: me._id,
      recipientId: target._id,
      createdAt: Date.now(),
    });
    await notifyUsers(ctx, {
      userIds: [target._id],
      actorId: me._id,
      type: "friend_request",
      requestId,
      title: `${me.name} sent you a friend request`,
    });
    return { status: "pending" as const };
  },
});

export const acceptFriendRequest = mutation({
  args: { requestId: v.id("friendRequests") },
  handler: async (ctx, { requestId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const request = await ctx.db.get(requestId);
    if (!request || request.recipientId !== me._id) throw new Error("Request not found.");

    await ctx.db.delete(request._id);
    const now = Date.now();
    await ctx.db.insert("friendships", { ownerId: me._id, friendId: request.requesterId, createdAt: now });
    await ctx.db.insert("friendships", { ownerId: request.requesterId, friendId: me._id, createdAt: now });
    await notifyUsers(ctx, {
      userIds: [request.requesterId],
      actorId: me._id,
      type: "friend_accept",
      title: `${me.name} accepted your friend request`,
    });
  },
});

export const declineFriendRequest = mutation({
  args: { requestId: v.id("friendRequests") },
  handler: async (ctx, { requestId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const request = await ctx.db.get(requestId);
    if (!request || request.recipientId !== me._id) throw new Error("Request not found.");
    await ctx.db.delete(request._id);
  },
});

export const cancelFriendRequest = mutation({
  args: { requestId: v.id("friendRequests") },
  handler: async (ctx, { requestId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const request = await ctx.db.get(requestId);
    if (!request || request.requesterId !== me._id) throw new Error("Request not found.");
    await ctx.db.delete(request._id);
  },
});

export const removeFriend = mutation({
  args: { friendId: v.id("users") },
  handler: async (ctx, { friendId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const forward = await ctx.db
      .query("friendships")
      .withIndex("by_owner_friend", (q) => q.eq("ownerId", me._id).eq("friendId", friendId))
      .unique();
    const backward = await ctx.db
      .query("friendships")
      .withIndex("by_owner_friend", (q) => q.eq("ownerId", friendId).eq("friendId", me._id))
      .unique();
    if (forward) await ctx.db.delete(forward._id);
    if (backward) await ctx.db.delete(backward._id);
  },
});

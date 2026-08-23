import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { activitiesOf } from "./lib/activities";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

async function areFriends(ctx: QueryCtx, a: Id<"users">, b: Id<"users">) {
  const row = await ctx.db
    .query("friendships")
    .withIndex("by_owner_friend", (q) => q.eq("ownerId", a).eq("friendId", b))
    .unique();
  return !!row;
}

async function summarizeUser(ctx: QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  if (!user) return null;
  const presence = await ctx.db
    .query("presence")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  return {
    id: user._id,
    name: user.name,
    username: user.username,
    imageUrl: user.imageUrl,
    customStatus: user.customStatus,
    status: presence?.effective ?? "offline",
  };
}

function dmKeyFor(a: Id<"users">, b: Id<"users">) {
  return [a, b].sort().join(":");
}

async function otherMembers(ctx: QueryCtx, conversationId: Id<"conversations">, me: Id<"users">) {
  const allMembers = await ctx.db
    .query("conversationMembers")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
    .collect();
  const others = await Promise.all(
    allMembers.filter((m) => m.userId !== me).map((m) => summarizeUser(ctx, m.userId))
  );
  return others.filter((o): o is NonNullable<typeof o> => o !== null);
}

/** Past this a count stops being informative and becomes "a lot". */
const UNREAD_COUNT_CAP = 99;

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const memberships = await ctx.db
      .query("conversationMembers")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();

    const conversations = await Promise.all(
      memberships.map(async (membership) => {
        const conversation = await ctx.db.get(membership.conversationId);
        if (!conversation) return null;

        const [lastMessage] = await ctx.db
          .query("messages")
          .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
          .order("desc")
          .take(1);

        const unread = (lastMessage?._creationTime ?? 0) > membership.lastReadAt;

        // Only counted for conversations already known to be unread, and
        // capped: an exact count of a hundred unread messages isn't more
        // useful than "99+", and this is the only unbounded read here.
        let unreadCount = 0;
        if (unread) {
          const recent = await ctx.db
            .query("messages")
            .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
            .order("desc")
            .take(UNREAD_COUNT_CAP + 1);
          unreadCount = recent.filter((m) => m._creationTime > membership.lastReadAt).length;
        }

        return {
          id: conversation._id,
          type: conversation.type,
          name: conversation.name,
          imageUrl: conversation.imageUrl,
          members: await otherMembers(ctx, conversation._id, me._id),
          lastMessageText: lastMessage?.text ?? null,
          lastMessageAt: lastMessage?._creationTime ?? conversation.createdAt,
          unread,
          unreadCount,
        };
      })
    );

    return conversations
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  },
});

export const get = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    const membership = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversationId).eq("userId", me._id)
      )
      .unique();
    if (!membership) return null;

    const conversation = await ctx.db.get(conversationId);
    if (!conversation) return null;

    return {
      id: conversation._id,
      type: conversation.type,
      name: conversation.name,
      imageUrl: conversation.imageUrl,
      members: await otherMembers(ctx, conversationId, me._id),
    };
  },
});

/** All members (including yourself) with live presence — for the group DM
 * member list, which only groups by online/offline (no roles, unlike
 * communities). */
export const listMembersWithPresence = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const membership = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversationId).eq("userId", me._id)
      )
      .unique();
    if (!membership) return [];

    const allMembers = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .collect();

    return Promise.all(
      allMembers.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        const presence = await ctx.db
          .query("presence")
          .withIndex("by_user", (q) => q.eq("userId", m.userId))
          .unique();
        return {
          userId: m.userId,
          name: user?.name ?? "Unknown",
          username: user?.username ?? "unknown",
          imageUrl: user?.imageUrl,
          bio: user?.bio,
          customStatus: user?.customStatus,
          nameplateUrl: user?.nameplateUrl,
          bannerUrl: user?.bannerUrl,
          borderGradientStart: user?.borderGradientStart,
          borderGradientEnd: user?.borderGradientEnd,
          status: presence?.effective ?? "offline",
          activities: activitiesOf(presence),
        };
      })
    );
  },
});

export const generateGroupIconUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const setGroupIcon = mutation({
  args: { conversationId: v.id("conversations"), storageId: v.id("_storage") },
  handler: async (ctx, { conversationId, storageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error("Conversation not found.");
    if (conversation.type !== "group") throw new Error("Only group conversations have an icon.");

    const membership = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversationId).eq("userId", me._id)
      )
      .unique();
    if (!membership) throw new Error("Not a member of this conversation.");

    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Icon upload failed.");
    const previous = conversation.iconStorageId;
    await ctx.db.patch(conversationId, { imageUrl: url, iconStorageId: storageId });
    if (previous && previous !== storageId) await ctx.storage.delete(previous).catch(() => {});
  },
});

export const getDirect = mutation({
  args: { friendId: v.id("users") },
  handler: async (ctx, { friendId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    if (friendId === me._id) throw new Error("You can't DM yourself.");
    if (!(await areFriends(ctx, me._id, friendId))) {
      throw new Error("You can only message friends.");
    }

    const key = dmKeyFor(me._id, friendId);
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_dm_key", (q) => q.eq("dmKey", key))
      .unique();
    if (existing) return existing._id;
  },
});

export const getOrCreateDirect = mutation({
  args: { friendId: v.id("users") },
  handler: async (ctx, { friendId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    if (friendId === me._id) throw new Error("You can't DM yourself.");
    if (!(await areFriends(ctx, me._id, friendId))) {
      throw new Error("You can only message friends.");
    }

    const key = dmKeyFor(me._id, friendId);
    const existing = await ctx.db
      .query("conversations")
      .withIndex("by_dm_key", (q) => q.eq("dmKey", key))
      .unique();
    if (existing) return existing._id;

    const now = Date.now();
    const conversationId = await ctx.db.insert("conversations", {
      type: "dm",
      dmKey: key,
      createdBy: me._id,
      createdAt: now,
    });
    await ctx.db.insert("conversationMembers", {
      conversationId,
      userId: me._id,
      joinedAt: now,
      lastReadAt: now,
    });
    await ctx.db.insert("conversationMembers", {
      conversationId,
      userId: friendId,
      joinedAt: now,
      lastReadAt: 0,
    });
    return conversationId;
  },
});

export const createGroup = mutation({
  args: { memberIds: v.array(v.id("users")), name: v.optional(v.string()) },
  handler: async (ctx, { memberIds, name }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const uniqueMemberIds = Array.from(new Set(memberIds.filter((id) => id !== me._id)));
    if (uniqueMemberIds.length < 2) {
      throw new Error("Pick at least 2 friends to start a group DM.");
    }
    for (const id of uniqueMemberIds) {
      if (!(await areFriends(ctx, me._id, id))) {
        throw new Error("You can only add friends to a group.");
      }
    }

    const now = Date.now();
    const conversationId = await ctx.db.insert("conversations", {
      type: "group",
      name,
      createdBy: me._id,
      createdAt: now,
    });
    await ctx.db.insert("conversationMembers", {
      conversationId,
      userId: me._id,
      joinedAt: now,
      lastReadAt: now,
    });
    for (const id of uniqueMemberIds) {
      await ctx.db.insert("conversationMembers", {
        conversationId,
        userId: id,
        joinedAt: now,
        lastReadAt: 0,
      });
    }
    return conversationId;
  },
});

export const markRead = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const membership = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversationId).eq("userId", me._id)
      )
      .unique();
    if (!membership) return;
    await ctx.db.patch(membership._id, { lastReadAt: Date.now() });
  },
});

import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { visibleActivities, visibleCustomStatus } from "./lib/activities";
import { effectiveDecoration, isBirthdayNow } from "./lib/birthday";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";
import { MAX_PROFILE_ASSET_BYTES, requireWithinUploadLimit } from "./uploadLimits";

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
  const status = presence?.effective ?? "offline";
  return {
    id: user._id,
    name: user.name,
    username: user.username,
    imageUrl: user.imageUrl,
    nameplateUrl: user.nameplateUrl,
    avatarDecoration: effectiveDecoration(user),
    isBirthday: isBirthdayNow(user),
    status,
    customStatus: visibleCustomStatus(user, status),
    activities: visibleActivities(presence, user),
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

/** The newest message in a conversation, or `undefined` if it has none. */
async function lastMessageOf(ctx: QueryCtx, conversationId: Id<"conversations">) {
  const [last] = await ctx.db
    .query("messages")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
    .order("desc")
    .take(1);
  return last;
}

/**
 * Whether a conversation has something waiting for `me`.
 *
 * Your own messages never count. `send` marks the author read, but its
 * `Date.now()` is the transaction's start while `_creationTime` is the
 * commit, so the message you just sent lands fractionally *after* your own
 * read mark and would otherwise light up the rail. Same rule as channels:
 * unread is what you missed.
 */
function isUnread(
  lastMessage: Doc<"messages"> | undefined,
  lastReadAt: number,
  me: Id<"users">
): boolean {
  return (
    lastMessage !== undefined &&
    lastMessage.authorId !== me &&
    lastMessage._creationTime > lastReadAt
  );
}

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

        const lastMessage = await lastMessageOf(ctx, conversation._id);
        const unread = isUnread(lastMessage, membership.lastReadAt, me._id);

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
          unreadCount = recent.filter(
            (m) => m._creationTime > membership.lastReadAt && m.authorId !== me._id
          ).length;
        }

        return {
          id: conversation._id,
          type: conversation.type,
          name: conversation.name,
          imageUrl: conversation.imageUrl,
          members: await otherMembers(ctx, conversation._id, me._id),
          lastMessageText: lastMessage?.text ?? null,
          lastMessageAt: lastMessage?._creationTime ?? conversation.createdAt,
          /** So the list can prefix the preview with "Me:" — whose turn it is
           * is most of what a one-line preview is for. */
          lastMessageMine: lastMessage?.authorId === me._id,
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
      // Carried by the read the chat view already does, so the wallpaper is
      // there on the first frame rather than fading in a beat later.
      backgroundUrl: conversation.backgroundUrl,
      backgroundOpacity: conversation.backgroundOpacity,
      members: await otherMembers(ctx, conversationId, me._id),
      /** Live, so the open chat can catch a message that arrives while
       * you're sitting in it rather than leaving the rail lit behind you. */
      unread: isUnread(
        await lastMessageOf(ctx, conversationId),
        membership.lastReadAt,
        me._id
      ),
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
          nameplateUrl: user?.nameplateUrl,
          avatarDecoration: effectiveDecoration(user),
          isBirthday: isBirthdayNow(user),
          bannerUrl: user?.bannerUrl,
          borderGradientStart: user?.borderGradientStart,
          borderGradientEnd: user?.borderGradientEnd,
          status: presence?.effective ?? "offline",
          customStatus: visibleCustomStatus(user, presence?.effective ?? "offline"),
          activities: visibleActivities(presence, user),
        };
      })
    );
  },
});

/**
 * The group everyone in it can edit.
 *
 * A group DM has no roles, so membership *is* the permission — the same
 * footing everyone joined on. One-to-one DMs are excluded: their name and
 * picture belong to the other person, not the conversation.
 */
async function requireGroupMembership(
  ctx: MutationCtx,
  conversationId: Id<"conversations">,
  userId: Id<"users">
): Promise<Doc<"conversations">> {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) throw new Error("Conversation not found.");
  if (conversation.type !== "group") throw new Error("Only groups can be renamed or re-iconed.");
  const membership = await ctx.db
    .query("conversationMembers")
    .withIndex("by_conversation_user", (q) =>
      q.eq("conversationId", conversationId).eq("userId", userId)
    )
    .unique();
  if (!membership) throw new Error("Not a member of this conversation.");
  return conversation;
}

/** Past this the name stops fitting anywhere it's shown. */
const MAX_GROUP_NAME_LENGTH = 64;

export const renameGroup = mutation({
  args: { conversationId: v.id("conversations"), name: v.string() },
  handler: async (ctx, { conversationId, name }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireGroupMembership(ctx, conversationId, me._id);

    const trimmed = name.trim();
    if (trimmed.length > MAX_GROUP_NAME_LENGTH) {
      throw new Error(`Group names are at most ${MAX_GROUP_NAME_LENGTH} characters.`);
    }
    // Clearing it is allowed and meaningful: an unnamed group falls back to
    // listing its members, which is the right title for most of them.
    await ctx.db.patch(conversationId, { name: trimmed || undefined });
  },
});

export const removeGroupIcon = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const conversation = await requireGroupMembership(ctx, conversationId, me._id);
    await ctx.db.patch(conversationId, { imageUrl: undefined, iconStorageId: undefined });
    if (conversation.iconStorageId) {
      await ctx.storage.delete(conversation.iconStorageId).catch(() => {});
    }
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
    const conversation = await requireGroupMembership(ctx, conversationId, me._id);

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

/**
 * How many people a group DM holds, the creator included.
 *
 * A ceiling rather than a technical limit: past thirty a group stops behaving
 * like a group — everyone is notified about everything, nobody can be removed,
 * and it wants the roles and channels a server already has. Mirrored in
 * src/lib/group-limits.ts, which is what the picker greys out at; this is
 * where it binds.
 */
export const MAX_GROUP_MEMBERS = 30;

export const createGroup = mutation({
  args: { memberIds: v.array(v.id("users")), name: v.optional(v.string()) },
  handler: async (ctx, { memberIds, name }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const uniqueMemberIds = Array.from(new Set(memberIds.filter((id) => id !== me._id)));
    if (uniqueMemberIds.length < 2) {
      throw new Error("Pick at least 2 friends to start a group DM.");
    }
    // `+ 1` for the creator, who is a member of the group they just made.
    if (uniqueMemberIds.length + 1 > MAX_GROUP_MEMBERS) {
      throw new Error(`A group DM can hold up to ${MAX_GROUP_MEMBERS} people.`);
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

/**
 * Catch a user up on every conversation they're in.
 *
 * Shared with the inbox's "mark all read": clearing the notification rows
 * without this would empty the badge while leaving the unread DMs lit in the
 * rail, which reads as the button not having worked.
 *
 * Only conversations actually behind are written to. `lastReadAt` moving
 * forward is always valid, so patching all of them unconditionally would be
 * correct too — it would just spend a write per conversation to say nothing.
 */
export async function markAllConversationsRead(
  ctx: MutationCtx,
  userId: Id<"users">
): Promise<void> {
  const memberships = await ctx.db
    .query("conversationMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  const now = Date.now();
  for (const membership of memberships) {
    const [lastMessage] = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", membership.conversationId))
      .order("desc")
      .take(1);
    if (!lastMessage || lastMessage._creationTime <= membership.lastReadAt) continue;
    await ctx.db.patch(membership._id, { lastReadAt: now });
  }
}

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
    // Only write when actually behind: the open chat re-runs this every time
    // its unread flag flips, and re-stamping a conversation with nothing new
    // in it spends a write to say nothing.
    const lastMessage = await lastMessageOf(ctx, conversationId);
    if (!lastMessage || lastMessage._creationTime <= membership.lastReadAt) return;
    await ctx.db.patch(membership._id, { lastReadAt: Date.now() });
  },
});

// --- Conversation background ------------------------------------------------

/**
 * The picture behind a DM or group's messages.
 *
 * Any member can set it, unlike a channel background, which needs Manage
 * Channels: a conversation has no roles, and two people sharing a room can
 * share its wallpaper. The same fields and the same component as a channel's
 * — see `channels.setBackground`, whose comments explain why `opacity` travels
 * with the image.
 */
export const setConversationBackground = mutation({
  args: {
    conversationId: v.id("conversations"),
    storageId: v.optional(v.id("_storage")),
    opacity: v.optional(v.number()),
    clear: v.optional(v.boolean()),
  },
  handler: async (ctx, { conversationId, storageId, opacity, clear }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const membership = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversationId).eq("userId", me._id)
      )
      .unique();
    if (!membership) throw new Error("You're not in that conversation.");
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new Error("Conversation not found.");

    if (clear) {
      const previous = conversation.backgroundStorageId;
      await ctx.db.patch(conversationId, {
        backgroundUrl: undefined,
        backgroundStorageId: undefined,
        backgroundOpacity: undefined,
      });
      if (previous) await ctx.storage.delete(previous).catch(() => {});
      return;
    }

    const patch: {
      backgroundUrl?: string;
      backgroundStorageId?: Id<"_storage">;
      backgroundOpacity?: number;
    } = {};

    if (storageId) {
      await requireWithinUploadLimit(
        ctx,
        storageId,
        MAX_PROFILE_ASSET_BYTES,
        "Chat backgrounds"
      );
      const url = await ctx.storage.getUrl(storageId);
      if (!url) throw new Error("Background upload failed.");
      patch.backgroundUrl = url;
      patch.backgroundStorageId = storageId;
    }
    if (opacity !== undefined) {
      patch.backgroundOpacity = Math.min(1, Math.max(0, opacity));
    }
    if (Object.keys(patch).length === 0) return;

    const previous = conversation.backgroundStorageId;
    await ctx.db.patch(conversationId, patch);
    if (storageId && previous && previous !== storageId) {
      await ctx.storage.delete(previous).catch(() => {});
    }
  },
});

/** Upload URL for a conversation background. Membership is the only gate — see
 * `setConversationBackground`. */
export const generateConversationAssetUploadUrl = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const membership = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversationId).eq("userId", me._id)
      )
      .unique();
    if (!membership) throw new Error("You're not in that conversation.");
    return ctx.storage.generateUploadUrl();
  },
});

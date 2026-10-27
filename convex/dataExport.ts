import { paginationOptsValidator } from "convex/server";

import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { getCurrentUserOrThrow } from "./users";

/**
 * "Download your data", from Settings → Privacy.
 *
 * The file is put together in the person's own app, not here: message text is end-to-end encrypted,
 * so only their device can turn it back into words. This module serves the raw material: one query
 * for everything that isn't a message, and two paginated ones for the messages they wrote. Each
 * message comes with its encrypted envelope (and legacy plain text, if any) for the client to
 * decrypt.
 *
 * Rows are the person's own, passed through `clean`, which drops what is internal or secret rather
 * than theirs to read: storage ids, password and code hashes, encrypted tokens and keys.
 */

const SECRET = /(StorageId|storageId|Cipher|cipher|Hash|hash|token|Token|secret|Secret|Prefix)$/;
const ALWAYS_DROP = new Set(["passwordHash", "keyCipher", "accessCipher", "refreshCipher", "secretCipher", "codeHash", "ipCipher", "ipHash"]);

function clean<T extends Record<string, unknown>>(row: T | null | undefined): Record<string, unknown> | null {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (ALWAYS_DROP.has(key) || SECRET.test(key)) continue;
    if (key === "_id") out.id = value;
    else if (key === "_creationTime") out.createdAt = new Date(value as number).toISOString();
    else out[key] = value;
  }
  return out;
}

async function nameOf(ctx: QueryCtx, userId: Id<"users">): Promise<{ id: Id<"users">; username: string; name: string } | null> {
  const user = await ctx.db.get(userId);
  return user ? { id: user._id, username: user.username, name: user.name } : null;
}

/** Everything except messages. Bounded per table so one huge account can't make the query fail. */
export const account = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrThrow(ctx);
    const id = me._id;
    const LIMIT = 2000;

    const memberships = await ctx.db.query("communityMembers").withIndex("by_user", (q) => q.eq("userId", id)).take(LIMIT);
    const communities = await Promise.all(
      memberships.map(async (m) => {
        const community = await ctx.db.get(m.communityId);
        const roleRows = await ctx.db.query("memberRoles").withIndex("by_member", (q) => q.eq("communityId", m.communityId).eq("userId", id)).collect();
        const roles = (await Promise.all(roleRows.map((r) => ctx.db.get(r.roleId)))).filter(Boolean).map((r) => r!.name);
        return { id: m.communityId, name: community?.name ?? null, joinedAt: m.joinedAt ? new Date(m.joinedAt).toISOString() : null, roles, isOwner: community?.ownerId === id };
      })
    );

    const conversationRows = await ctx.db.query("conversationMembers").withIndex("by_user", (q) => q.eq("userId", id)).take(LIMIT);
    const conversations = await Promise.all(
      conversationRows.map(async (row) => {
        const conversation = await ctx.db.get(row.conversationId);
        const members = await ctx.db.query("conversationMembers").withIndex("by_conversation", (q) => q.eq("conversationId", row.conversationId)).take(50);
        return {
          id: row.conversationId,
          name: (conversation as { name?: string } | null)?.name ?? null,
          members: (await Promise.all(members.map((m) => nameOf(ctx, m.userId)))).filter(Boolean),
        };
      })
    );

    const friendships = await ctx.db.query("friendships").withIndex("by_owner", (q) => q.eq("ownerId", id)).take(LIMIT);
    const sentRequests = await ctx.db.query("friendRequests").withIndex("by_requester", (q) => q.eq("requesterId", id)).take(LIMIT);
    const receivedRequests = await ctx.db.query("friendRequests").withIndex("by_recipient", (q) => q.eq("recipientId", id)).take(LIMIT);
    const suppressions = await ctx.db.query("userSuppressions").withIndex("by_user", (q) => q.eq("userId", id)).take(LIMIT);

    const orders = await ctx.db.query("orders").withIndex("by_user", (q) => q.eq("userId", id)).take(LIMIT);
    const skuName = async (skuId: Id<"skus"> | undefined) => (skuId ? ((await ctx.db.get(skuId)) as { name?: string } | null)?.name ?? null : null);

    const byUser = async <T extends "notifications" | "savedMessages" | "gameHistory" | "profileWidgets" | "profileImages" | "klipyFavourites" | "connectedAccounts" | "passkeys" | "userEmails" | "supportTickets" | "entitlements" | "notificationSettings" | "communityNotificationSettings" | "priorityItems" | "extensionInstalls" | "presence">(
      table: T,
      index: string
    ) =>
      ((await ctx.db
        .query(table)
        .withIndex(index as never, ((q: { eq: (f: string, v: unknown) => unknown }) => q.eq("userId", id)) as never)
        .take(LIMIT)) as Doc<T>[]).map((row) => clean(row as unknown as Record<string, unknown>));

    return {
      exportedAt: new Date().toISOString(),
      format: "Crystal data export, version 1",
      profile: clean(me as unknown as Record<string, unknown>),
      emails: await byUser("userEmails", "by_user"),
      security: {
        twoFactorEnabled: !!(await ctx.db.query("userTwoFactor").withIndex("by_user", (q) => q.eq("userId", id)).first()),
        passkeys: await byUser("passkeys", "by_user"),
      },
      linkedAccounts: await byUser("connectedAccounts", "by_user"),
      serverProfiles: (await ctx.db.query("serverProfiles").withIndex("by_user_community", (q) => q.eq("userId", id)).take(LIMIT)).map((r) => clean(r as unknown as Record<string, unknown>)),
      profileBoard: await byUser("profileWidgets", "by_user"),
      savedPictures: await byUser("profileImages", "by_user"),
      presence: await byUser("presence", "by_user"),
      gameHistory: await byUser("gameHistory", "by_user"),
      communities,
      conversations,
      friends: (await Promise.all(friendships.map(async (f) => ({ ...(await nameOf(ctx, f.friendId)), since: new Date(f.createdAt).toISOString() })))),
      friendRequests: {
        sent: await Promise.all(sentRequests.map(async (r) => ({ to: await nameOf(ctx, r.recipientId), createdAt: new Date(r._creationTime).toISOString() }))),
        received: await Promise.all(receivedRequests.map(async (r) => ({ from: await nameOf(ctx, r.requesterId), createdAt: new Date(r._creationTime).toISOString() }))),
      },
      blockedAndIgnored: await Promise.all(suppressions.map(async (s) => ({ ...clean(s as unknown as Record<string, unknown>), target: await nameOf(ctx, s.targetId) }))),
      savedMessages: await byUser("savedMessages", "by_user_created"),
      notifications: await byUser("notifications", "by_user"),
      notificationSettings: { global: await byUser("notificationSettings", "by_user"), perCommunity: await byUser("communityNotificationSettings", "by_user") },
      priorityList: await byUser("priorityItems", "by_user"),
      gifFavourites: await byUser("klipyFavourites", "by_user"),
      extensionsInstalled: await byUser("extensionInstalls", "by_user"),
      purchases: await Promise.all(orders.map(async (o) => ({ ...clean(o as unknown as Record<string, unknown>), item: await skuName(o.skuId) }))),
      entitlements: await byUser("entitlements", "by_user"),
      creatorEarnings: (await ctx.db.query("creatorEarnings").withIndex("by_creator", (q) => q.eq("creatorId", id)).take(LIMIT)).map((r) => clean(r as unknown as Record<string, unknown>)),
      botsOwned: (await ctx.db.query("bots").withIndex("by_owner", (q) => q.eq("ownerId", id)).take(LIMIT)).map((r) => clean(r as unknown as Record<string, unknown>)),
      reportsFiled: (await ctx.db.query("reports").withIndex("by_reporter", (q) => q.eq("reporterId", id)).take(LIMIT)).map((r) => ({
        id: r._id,
        createdAt: new Date(r.createdAt).toISOString(),
        category: r.category,
        targetType: r.targetType,
        details: r.details ?? null,
        status: r.status,
      })),
      supportTickets: await byUser("supportTickets", "by_user"),
      notIncluded: [
        "IP addresses: stored as a keyed hash and an encrypted copy. Email support@usecrystal.app if you'd like them.",
        "Reactions, forum posts, AMA questions, LFG posts and lounge chat: email support@usecrystal.app for a copy.",
        "Files are listed by link, not included. Open the links to download them.",
      ],
    };
  },
});

async function attachmentsOf(ctx: QueryCtx, table: "messageAttachments" | "channelMessageAttachments", messageId: Id<"messages"> | Id<"channelMessages">) {
  const rows = await ctx.db
    .query(table)
    .withIndex("by_message", (q) => q.eq("messageId", messageId as never))
    .collect();
  return Promise.all(
    rows.map(async (a) => ({
      fileName: a.fileName,
      fileType: a.fileType,
      fileSize: a.fileSize,
      url: a.cdnUrl ?? (a.storageId ? await ctx.storage.getUrl(a.storageId) : null),
    }))
  );
}

/** DMs and group messages you wrote, a page at a time. */
export const dmMessages = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const page = await ctx.db.query("messages").withIndex("by_author", (q) => q.eq("authorId", me._id)).paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 200) });
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (m) => ({
          id: m._id,
          conversationId: m.conversationId,
          sentAt: new Date(m._creationTime).toISOString(),
          editedAt: m.editedAt ? new Date(m.editedAt).toISOString() : null,
          text: m.text ?? null,
          enc: m.enc ?? null,
          attachments: await attachmentsOf(ctx, "messageAttachments", m._id),
        }))
      ),
    };
  },
});

/** Community messages you wrote, a page at a time, with where each was posted. */
export const channelMessages = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const page = await ctx.db.query("channelMessages").withIndex("by_author", (q) => q.eq("authorId", me._id)).paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, 200) });
    const channels = new Map<Id<"channels">, { name: string | null; communityId: Id<"communities"> | null; community: string | null }>();
    for (const m of page.page) {
      if (channels.has(m.channelId)) continue;
      const channel = await ctx.db.get(m.channelId);
      const community = channel ? await ctx.db.get(channel.communityId) : null;
      channels.set(m.channelId, { name: channel?.name ?? null, communityId: channel?.communityId ?? null, community: community?.name ?? null });
    }
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (m) => ({
          id: m._id,
          channelId: m.channelId,
          channel: channels.get(m.channelId)?.name ?? null,
          community: channels.get(m.channelId)?.community ?? null,
          sentAt: new Date(m._creationTime).toISOString(),
          editedAt: m.editedAt ? new Date(m.editedAt).toISOString() : null,
          text: m.text ?? null,
          enc: m.enc ?? null,
          attachments: await attachmentsOf(ctx, "channelMessageAttachments", m._id),
        }))
      ),
    };
  },
});


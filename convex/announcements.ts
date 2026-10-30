import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireCommunity, requireMember } from "./communities";
import { renderMentionsAsText } from "./lib/mentions";
import { r2PublicUrlForKey } from "./lib/r2";
import { historyFloorFor, withinHistory } from "./lib/history";
import { PERMISSIONS, can, getBasePermissions, getChannelPermissions, requireCommunityPermission } from "./permissions";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

/**
 * Following announcements channels (`channels.isAnnouncement`).
 *
 * A follow either puts the channel in the follower's Home newsfeed (`feed`), or copies each new
 * message into a text channel of the follower's own community (`channel`). See `channelFollows` in
 * the schema. The newsfeed reads the source channels directly; only a forward writes a row.
 */

/** How many channels one person can have in their newsfeed. */
const MAX_FEED_FOLLOWS = 50;
/** How many communities one announcements channel will deliver to per message. */
const MAX_FORWARDS = 500;
/** What the newsfeed reads from each followed channel, and returns overall. */
const FEED_PER_CHANNEL = 10;
const FEED_TOTAL = 30;

/** A channel a person may follow, or why not. */
async function requireFollowable(ctx: QueryCtx, channelId: Id<"channels">, userId: Id<"users">) {
  const channel = await ctx.db.get(channelId);
  if (!channel || !channel.isAnnouncement) throw new Error("That isn't an announcements channel.");
  await requireMember(ctx, channel.communityId, userId);
  const community = await requireCommunity(ctx, channel.communityId);
  const perms = await getChannelPermissions(ctx, community, channelId, userId);
  if (!can(perms, PERMISSIONS.VIEW_CHANNELS)) throw new Error("You can't see that channel.");
  return { channel, community };
}

/** Whether `userId` can still see `channel` — a follow made when they could goes quiet when they can't. */
async function canStillSee(ctx: QueryCtx, channel: Doc<"channels">, userId: Id<"users">): Promise<boolean> {
  const membership = await ctx.db
    .query("communityMembers")
    .withIndex("by_community_user", (q) => q.eq("communityId", channel.communityId).eq("userId", userId))
    .unique();
  if (!membership) return false;
  const community = await ctx.db.get(channel.communityId);
  if (!community) return false;
  return can(await getChannelPermissions(ctx, community, channel._id, userId), PERMISSIONS.VIEW_CHANNELS);
}

export const follow = mutation({
  args: {
    channelId: v.id("channels"),
    kind: v.union(v.literal("feed"), v.literal("channel")),
    /** For `channel`: where each message is copied to. */
    targetChannelId: v.optional(v.id("channels")),
  },
  handler: async (ctx, { channelId, kind, targetChannelId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireFollowable(ctx, channelId, me._id);

    const mine = await ctx.db
      .query("channelFollows")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();

    if (kind === "feed") {
      const already = mine.find((f) => f.kind === "feed" && f.channelId === channelId);
      if (already) return already._id;
      if (mine.filter((f) => f.kind === "feed").length >= MAX_FEED_FOLLOWS) {
        throw new Error(`Your newsfeed can follow up to ${MAX_FEED_FOLLOWS} channels.`);
      }
      return ctx.db.insert("channelFollows", { channelId, kind: "feed", userId: me._id, createdAt: Date.now() });
    }

    if (!targetChannelId) throw new Error("Choose a channel to send it to.");
    if (targetChannelId === channelId) throw new Error("A channel can't follow itself.");
    const target = await ctx.db.get(targetChannelId);
    if (!target || target.type !== "text" || target.surface) throw new Error("Choose a text channel to send it to.");
    // Who sets up a delivery into a community has to be able to run that community's channels.
    const targetCommunity = await requireCommunity(ctx, target.communityId);
    await requireMember(ctx, target.communityId, me._id);
    await requireCommunityPermission(ctx, targetCommunity, me._id, PERMISSIONS.MANAGE_CHANNELS);

    const existing = (
      await ctx.db.query("channelFollows").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect()
    ).find((f) => f.kind === "channel" && f.targetChannelId === targetChannelId);
    if (existing) return existing._id;

    return ctx.db.insert("channelFollows", {
      channelId,
      kind: "channel",
      userId: me._id,
      targetCommunityId: target.communityId,
      targetChannelId,
      createdAt: Date.now(),
    });
  },
});

export const unfollow = mutation({
  args: { followId: v.id("channelFollows") },
  handler: async (ctx, { followId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const follow = await ctx.db.get(followId);
    if (!follow) return;
    if (follow.userId !== me._id) {
      // Not theirs: whoever runs the receiving channel, or the announcements channel itself, may end it.
      const source = await ctx.db.get(follow.channelId);
      const communityIds = [follow.targetCommunityId, source?.communityId].filter(
        (id): id is Id<"communities"> => !!id,
      );
      let allowed = false;
      for (const communityId of communityIds) {
        const community = await ctx.db.get(communityId);
        if (community && can(await getBasePermissions(ctx, community, me._id), PERMISSIONS.MANAGE_CHANNELS)) {
          allowed = true;
          break;
        }
      }
      if (!allowed) throw new Error("You can't change that.");
    }
    await ctx.db.delete(followId);
  },
});

/** My follows, with names to show them by. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const follows = await ctx.db
      .query("channelFollows")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();
    const rows = await Promise.all(
      follows.map(async (f) => {
        const [channel, target] = await Promise.all([
          ctx.db.get(f.channelId),
          f.targetChannelId ? ctx.db.get(f.targetChannelId) : null,
        ]);
        if (!channel) return null;
        const [community, targetCommunity] = await Promise.all([
          ctx.db.get(channel.communityId),
          target ? ctx.db.get(target.communityId) : null,
        ]);
        return {
          id: f._id,
          kind: f.kind,
          channelId: f.channelId,
          channelName: channel.name,
          communityId: channel.communityId,
          communityName: community?.name ?? "",
          targetChannelId: f.targetChannelId ?? null,
          targetChannelName: target?.name ?? null,
          targetCommunityName: targetCommunity?.name ?? null,
        };
      }),
    );
    return rows.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

/** Everyone receiving one announcements channel, for the people who run it. */
export const listForChannel = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    const channel = await ctx.db.get(channelId);
    if (!channel?.isAnnouncement) return null;
    const community = await ctx.db.get(channel.communityId);
    if (!community) return null;
    if (!can(await getBasePermissions(ctx, community, me._id), PERMISSIONS.MANAGE_CHANNELS)) return null;

    const follows = await ctx.db
      .query("channelFollows")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .collect();
    const forwards = await Promise.all(
      follows
        .filter((f) => f.kind === "channel" && f.targetChannelId)
        .map(async (f) => {
          const target = await ctx.db.get(f.targetChannelId!);
          const targetCommunity = target ? await ctx.db.get(target.communityId) : null;
          return {
            id: f._id,
            targetChannelName: target?.name ?? "deleted channel",
            targetCommunityName: targetCommunity?.name ?? "",
          };
        }),
    );
    return { feedCount: follows.filter((f) => f.kind === "feed").length, forwards };
  },
});

/** Where a person could send an announcements channel: text channels in communities they manage channels in. */
export const followTargets = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const memberships = await ctx.db
      .query("communityMembers")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();
    const out = await Promise.all(
      memberships.map(async (m) => {
        const community = await ctx.db.get(m.communityId);
        if (!community) return null;
        if (!can(await getBasePermissions(ctx, community, me._id), PERMISSIONS.MANAGE_CHANNELS)) return null;
        const channels = await ctx.db
          .query("channels")
          .withIndex("by_community", (q) => q.eq("communityId", m.communityId))
          .collect();
        return {
          communityId: community._id,
          name: community.name,
          imageUrl: community.imageUrl,
          channels: channels
            .filter((c) => c.type === "text" && !c.surface)
            .sort((a, b) => a.position - b.position)
            .map((c) => ({ id: c._id, name: c.name, isAnnouncement: c.isAnnouncement ?? false })),
        };
      }),
    );
    return out.filter((c): c is NonNullable<typeof c> => c !== null);
  },
});

/**
 * Copy a new announcement into every channel following it.
 *
 * Runs after the post commits (see `sendChannelMessage`). A copy is a snapshot authored by whoever
 * posted the original: editing or deleting the original later doesn't reach it, and it isn't
 * delivered onward again, so two communities following each other can't loop. No notification goes
 * out for a copy — it only lights the channel up as unread.
 */
export const deliverToFollowers = internalMutation({
  args: { messageId: v.id("channelMessages") },
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    if (!message || message.forwardedFrom || message.enc) return;
    // A poll or a sticker has nothing a snapshot could carry (votes and stickers belong to this community).
    if (message.poll || message.stickerId) return;
    const source = await ctx.db.get(message.channelId);
    if (!source?.isAnnouncement) return;
    const sourceCommunity = await ctx.db.get(source.communityId);
    if (!sourceCommunity) return;

    const follows = await ctx.db
      .query("channelFollows")
      .withIndex("by_channel", (q) => q.eq("channelId", source._id))
      .take(MAX_FORWARDS);
    const forwards = follows.filter((f) => f.kind === "channel" && f.targetChannelId);
    if (forwards.length === 0) return;

    const attachments = await ctx.db
      .query("channelMessageAttachments")
      .withIndex("by_message", (q) => q.eq("messageId", message._id))
      .collect();
    // Who was tagged in the original means nothing in another community; show them as names.
    const text = message.text ? await renderMentionsAsText(ctx, message.text) : undefined;

    for (const follow of forwards) {
      const target = await ctx.db.get(follow.targetChannelId!);
      if (!target || target.type !== "text") {
        await ctx.db.delete(follow._id);
        continue;
      }
      // The follow was set up by someone with authority over both ends; if they've lost it, it ends.
      const targetCommunity = await ctx.db.get(target.communityId);
      const stillRuns =
        !!targetCommunity &&
        can(await getBasePermissions(ctx, targetCommunity, follow.userId), PERMISSIONS.MANAGE_CHANNELS) &&
        (await canStillSee(ctx, source, follow.userId));
      if (!stillRuns) {
        await ctx.db.delete(follow._id);
        continue;
      }

      const copyId = await ctx.db.insert("channelMessages", {
        channelId: target._id,
        authorId: message.authorId,
        text,
        hasAttachments: attachments.length > 0,
        ...(message.embeds?.length ? { embeds: message.embeds } : {}),
        forwardedFrom: {
          channelId: source._id,
          channelName: source.name,
          communityId: sourceCommunity._id,
          communityName: sourceCommunity.name,
        },
      });
      for (const { _id, _creationTime, messageId: _original, ...file } of attachments) {
        await ctx.db.insert("channelMessageAttachments", { messageId: copyId, ...file });
      }
      await ctx.db.patch(target._id, { lastMessageAt: Date.now() });
      try {
        await ctx.scheduler.runAfter(0, internal.cache.invalidateChannelCache, { channelId: target._id });
      } catch {}
    }
  },
});

/** The newest announcements from every channel I follow into my newsfeed, newest first. */
export const newsfeed = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const follows = (
      await ctx.db
        .query("channelFollows")
        .withIndex("by_user", (q) => q.eq("userId", me._id))
        .collect()
    ).filter((f) => f.kind === "feed");
    if (follows.length === 0) return [];

    const authors = new Map<Id<"users">, Doc<"users"> | null>();
    const perChannel = await Promise.all(
      follows.map(async (f) => {
        const channel = await ctx.db.get(f.channelId);
        // Gone, or no longer visible to me: skipped rather than shown.
        if (!channel?.isAnnouncement || !(await canStillSee(ctx, channel, me._id))) return [];
        const community = await ctx.db.get(channel.communityId);
        if (!community) return [];
        const messages = await ctx.db
          .query("channelMessages")
          .withIndex("by_channel", (q) => q.eq("channelId", channel._id))
          .order("desc")
          .take(FEED_PER_CHANNEL);
        // Following a channel doesn't give a member history the channel itself would withhold.
        const floor = await historyFloorFor(ctx, channel._id, me._id, await getChannelPermissions(ctx, community, channel._id, me._id));
        return messages
          .filter((m) => !m.enc && withinHistory(floor, m._creationTime))
          .map((message) => ({ message, channel, community }));
      }),
    );

    const newest = perChannel
      .flat()
      .sort((a, b) => b.message._creationTime - a.message._creationTime)
      .slice(0, FEED_TOTAL);

    return Promise.all(
      newest.map(async ({ message, channel, community }) => {
        if (!authors.has(message.authorId)) authors.set(message.authorId, await ctx.db.get(message.authorId));
        const author = authors.get(message.authorId) ?? null;
        const files = await ctx.db
          .query("channelMessageAttachments")
          .withIndex("by_message", (q) => q.eq("messageId", message._id))
          .take(4);
        return {
          id: message._id,
          createdAt: message._creationTime,
          text: message.text ? await renderMentionsAsText(ctx, message.text) : null,
          embeds: message.embeds ?? [],
          channelId: channel._id,
          channelName: channel.name,
          communityId: community._id,
          communityName: community.name,
          communityImageUrl: community.imageUrl ?? null,
          author: author ? { name: author.name, imageUrl: author.imageUrl ?? null } : null,
          attachments: await Promise.all(
            files.map(async (file) => ({
              id: file._id,
              fileName: file.fileName,
              fileType: file.fileType,
              url:
                file.cdnUrl ??
                (file.cdnKey ? r2PublicUrlForKey(file.cdnKey) || null : file.storageId ? await ctx.storage.getUrl(file.storageId) : null),
            })),
          ),
        };
      }),
    );
  },
});

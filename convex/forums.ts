import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { historyFloorFor } from "./lib/history";
import { requireAbility, requireCommunityOpen } from "./lib/moderation";
import { PERMISSIONS, getChannelPermissions } from "./permissions";
import { enforceSlowmode } from "./lib/slowmode";
import { isSlowmodeExempt } from "./lib/slowmodePure";
import { canDo, requireSurface } from "./lib/surfaces";
import {
  MAX_THREAD_MEMBERS,
  MODERATE_THREADS,
  canManageMembers,
  canRemoveMember,
  canReplyIn,
  canSeePost,
  createCapabilities,
  createRefusal,
  isTimedOut,
  postWithinHistory,
} from "./lib/threadAccess";

/**
 * A thread channel: a forum. Every post is a conversation of its own, listed by
 * how recently anyone said something in it. A post can be private: then only its
 * author, the people invited into it and whoever moderates threads can see it.
 */

const MAX_TITLE = 120;
const MAX_BODY = 4000;
const MAX_REPLY = 2000;
const PAGE = 40;
const PINNED = 10;
const REPLIES = 300;
/** Most rows a list reads while looking for a full page of posts the viewer may see. */
const SCAN_LIMIT = 400;
const GONE = "That thread is gone.";

async function who(ctx: { db: { get: (id: Id<"users">) => Promise<Doc<"users"> | null> } }, id: Id<"users">) {
  const user = await ctx.db.get(id);
  return { id, name: user?.name ?? "Someone", imageUrl: user?.imageUrl };
}

/** Whether the member is timed out in the community right now. */
async function timedOutNow(ctx: QueryCtx, communityId: Id<"communities">, userId: Id<"users">): Promise<boolean> {
  const membership = await ctx.db
    .query("communityMembers")
    .withIndex("by_community_user", (q) => q.eq("communityId", communityId).eq("userId", userId))
    .unique();
  return isTimedOut(membership?.timeoutUntil, Date.now());
}

async function requireNotTimedOut(ctx: QueryCtx, communityId: Id<"communities">, userId: Id<"users">): Promise<void> {
  if (await timedOutNow(ctx, communityId, userId)) throw new Error("You're timed out in this server.");
}

async function isInvited(ctx: QueryCtx, postId: Id<"forumPosts">, userId: Id<"users">): Promise<boolean> {
  const row = await ctx.db
    .query("forumPostMembers")
    .withIndex("by_post_user", (q) => q.eq("postId", postId).eq("userId", userId))
    .unique();
  return !!row;
}

/**
 * A post as the caller is allowed to see it, or null when it doesn't exist or isn't theirs to know
 * about (a private thread they aren't in, or one from before their history starts). Every function
 * that takes a post id goes through here, so a hidden post answers exactly like a missing one.
 */
async function openPost(ctx: QueryCtx, postId: Id<"forumPosts">) {
  const post = await ctx.db.get(postId);
  if (!post) return null;
  const surface = await requireSurface(ctx, post.channelId, "threads");
  const { me, perms } = surface;
  const canModerate = canDo(perms, MODERATE_THREADS);
  const invited = post.private && post.authorId !== me._id && !canModerate ? await isInvited(ctx, postId, me._id) : false;
  if (!canSeePost(post, me._id, invited, canModerate)) return null;
  const floor = await historyFloorFor(ctx, post.channelId, me._id, perms);
  if (!postWithinHistory(floor, post, me._id)) return null;
  return { post, floor, canModerate, ...surface };
}

/** Pinned posts first, then newest activity. */
export const list = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const { me, channel, perms } = await requireSurface(ctx, channelId, "threads");
    const canModerate = canDo(perms, MODERATE_THREADS);
    const floor = await historyFloorFor(ctx, channelId, me._id, perms);

    // Hidden posts are dropped as they are read, so keep reading until a page is full rather than
    // taking a fixed number and returning fewer (which would also tell the viewer something was there).
    const visible = async (p: Doc<"forumPosts">) => {
      if (!postWithinHistory(floor, p, me._id)) return false;
      const invited = p.private && p.authorId !== me._id && !canModerate ? await isInvited(ctx, p._id, me._id) : false;
      return canSeePost(p, me._id, invited, canModerate);
    };
    const gather = async (rows: AsyncIterable<Doc<"forumPosts">>, want: number) => {
      const out: Doc<"forumPosts">[] = [];
      let scanned = 0;
      for await (const p of rows) {
        if (++scanned > SCAN_LIMIT) break;
        if (await visible(p)) out.push(p);
        if (out.length >= want) break;
      }
      return out;
    };
    const pinned = await gather(
      ctx.db
        .query("forumPosts")
        .withIndex("by_channel_pinned", (q) => q.eq("channelId", channelId).eq("pinned", true))
        .order("desc"),
      PINNED,
    );
    const recent = await gather(ctx.db.query("forumPosts").withIndex("by_channel_activity", (q) => q.eq("channelId", channelId)).order("desc"), PAGE);
    const seen = new Set(pinned.map((p) => p._id));
    const rows = [...pinned, ...recent.filter((p) => !seen.has(p._id))];
    return {
      canModerate,
      ...createCapabilities(perms),
      canReply: canReplyIn(perms),
      timedOut: await timedOutNow(ctx, channel.communityId, me._id),
      slowmodeSeconds: channel.slowmodeSeconds ?? 0,
      slowmodeBypass: isSlowmodeExempt(perms),
      posts: await Promise.all(
        rows.map(async (p) => ({
          id: p._id,
          title: p.title,
          preview: p.body.slice(0, 160),
          author: await who(ctx, p.authorId),
          replyCount: p.replyCount,
          pinned: p.pinned,
          locked: p.locked,
          private: !!p.private,
          createdAt: p.createdAt,
          lastActivityAt: p.lastActivityAt,
        })),
      ),
    };
  },
});

export const get = query({
  args: { postId: v.id("forumPosts") },
  handler: async (ctx, { postId }) => {
    const open = await openPost(ctx, postId);
    if (!open) return null;
    const { post, me, perms, floor, canModerate, channel } = open;
    const replies = (
      await ctx.db
        .query("forumReplies")
        .withIndex("by_post", (q) => q.eq("postId", postId))
        .take(REPLIES)
    ).filter((r) => postWithinHistory(floor, r, me._id));
    return {
      id: post._id,
      title: post.title,
      body: post.body,
      author: await who(ctx, post.authorId),
      createdAt: post.createdAt,
      pinned: post.pinned,
      locked: post.locked,
      private: !!post.private,
      mine: post.authorId === me._id,
      canModerate,
      canManageMembers: canManageMembers(post, me._id, canModerate),
      ...createCapabilities(perms),
      canReply: canReplyIn(perms),
      timedOut: await timedOutNow(ctx, post.communityId, me._id),
      slowmodeSeconds: channel.slowmodeSeconds ?? 0,
      slowmodeBypass: isSlowmodeExempt(perms),
      replies: await Promise.all(
        replies.map(async (r) => ({
          id: r._id,
          text: r.text,
          createdAt: r.createdAt,
          author: await who(ctx, r.authorId),
          mine: r.authorId === me._id,
        })),
      ),
    };
  },
});

export const create = mutation({
  args: { channelId: v.id("channels"), title: v.string(), body: v.string(), private: v.optional(v.boolean()) },
  handler: async (ctx, { channelId, title, body, private: isPrivate }) => {
    const { me, channel, perms } = await requireSurface(ctx, channelId, "threads");
    const refusal = createRefusal(perms, !!isPrivate);
    if (refusal) throw new Error(refusal);
    requireAbility(me, "send_messages");
    await requireNotTimedOut(ctx, channel.communityId, me._id);
    await requireCommunityOpen(ctx, channel.communityId, "post");
    const t = title.trim().slice(0, MAX_TITLE);
    const b = body.trim().slice(0, MAX_BODY);
    if (t.length < 3) throw new Error("Give it a title.");
    if (!b) throw new Error("Say something in it.");
    // Last, so a post refused for any other reason doesn't use up the member's turn.
    await enforceSlowmode(ctx, channel, me._id, "post", perms);
    const now = Date.now();
    return ctx.db.insert("forumPosts", {
      channelId,
      communityId: channel.communityId,
      authorId: me._id,
      title: t,
      body: b,
      createdAt: now,
      lastActivityAt: now,
      replyCount: 0,
      pinned: false,
      locked: false,
      ...(isPrivate ? { private: true } : {}),
    });
  },
});

export const reply = mutation({
  args: { postId: v.id("forumPosts"), text: v.string() },
  handler: async (ctx, { postId, text }) => {
    const open = await openPost(ctx, postId);
    if (!open) throw new Error(GONE);
    const { post, me, perms, channel, canModerate } = open;
    if (!canReplyIn(perms)) throw new Error("You can't post here.");
    requireAbility(me, "send_messages");
    await requireNotTimedOut(ctx, post.communityId, me._id);
    await requireCommunityOpen(ctx, post.communityId, "post");
    if (post.locked && !canModerate) throw new Error("This thread is locked.");
    const body = text.trim().slice(0, MAX_REPLY);
    if (!body) throw new Error("Write something first.");
    await enforceSlowmode(ctx, channel, me._id, "reply", perms);
    const now = Date.now();
    await ctx.db.insert("forumReplies", { postId, authorId: me._id, text: body, createdAt: now });
    await ctx.db.patch(postId, { replyCount: post.replyCount + 1, lastActivityAt: now });
  },
});

/** Pin, lock or remove a thread: its author (remove only) or whoever moderates. */
export const moderate = mutation({
  args: { postId: v.id("forumPosts"), action: v.union(v.literal("pin"), v.literal("unpin"), v.literal("lock"), v.literal("unlock"), v.literal("delete")) },
  handler: async (ctx, { postId, action }) => {
    const open = await openPost(ctx, postId);
    if (!open) return;
    const { post, me, canModerate: mod } = open;
    if (action === "delete") {
      if (!mod && post.authorId !== me._id) throw new Error("That isn't yours to remove.");
      for (const r of await ctx.db.query("forumReplies").withIndex("by_post", (q) => q.eq("postId", postId)).collect()) await ctx.db.delete(r._id);
      for (const m of await ctx.db.query("forumPostMembers").withIndex("by_post", (q) => q.eq("postId", postId)).collect()) await ctx.db.delete(m._id);
      await ctx.db.delete(postId);
      return;
    }
    if (!mod) throw new Error("Only moderators can do that.");
    if (action === "pin" || action === "unpin") await ctx.db.patch(postId, { pinned: action === "pin" });
    else await ctx.db.patch(postId, { locked: action === "lock" });
  },
});

export const removeReply = mutation({
  args: { replyId: v.id("forumReplies") },
  handler: async (ctx, { replyId }) => {
    const reply = await ctx.db.get(replyId);
    if (!reply) return;
    const open = await openPost(ctx, reply.postId);
    if (!open) return;
    const { post, me, canModerate } = open;
    if (reply.authorId !== me._id && !canModerate) throw new Error("That isn't yours to remove.");
    await ctx.db.delete(replyId);
    await ctx.db.patch(post._id, { replyCount: Math.max(0, post.replyCount - 1) });
  },
});

/** Who is in a thread: its author and the people invited. Only people who can see the thread get an answer. */
export const members = query({
  args: { postId: v.id("forumPosts") },
  handler: async (ctx, { postId }) => {
    const open = await openPost(ctx, postId);
    if (!open) return null;
    const { post, me, canModerate } = open;
    const rows = post.private ? await ctx.db.query("forumPostMembers").withIndex("by_post", (q) => q.eq("postId", postId)).take(MAX_THREAD_MEMBERS + 1) : [];
    return {
      private: !!post.private,
      canInvite: canManageMembers(post, me._id, canModerate) && rows.length < MAX_THREAD_MEMBERS,
      max: MAX_THREAD_MEMBERS,
      author: await who(ctx, post.authorId),
      members: await Promise.all(
        rows.map(async (m) => ({
          ...(await who(ctx, m.userId)),
          mine: m.userId === me._id,
          canRemove: canRemoveMember(post, me._id, m.userId, canModerate),
        })),
      ),
    };
  },
});

/** Bring someone into a private thread. Its author or a moderator only, and only people who could see the channel anyway. */
export const inviteMember = mutation({
  args: { postId: v.id("forumPosts"), userId: v.id("users") },
  handler: async (ctx, { postId, userId }) => {
    const open = await openPost(ctx, postId);
    if (!open) throw new Error(GONE);
    const { post, me, community, canModerate } = open;
    if (!post.private) throw new Error("Only private threads have invited members.");
    if (!canManageMembers(post, me._id, canModerate)) throw new Error("Only the thread's author or a moderator can invite people.");
    if (userId === post.authorId) throw new Error("They started this thread.");
    const membership = await ctx.db
      .query("communityMembers")
      .withIndex("by_community_user", (q) => q.eq("communityId", post.communityId).eq("userId", userId))
      .unique();
    if (!membership) throw new Error("They aren't a member of this community.");
    const theirs = await getChannelPermissions(ctx, community, post.channelId, userId);
    if (!canDo(theirs, PERMISSIONS.VIEW_CHANNELS)) throw new Error("They can't see this channel, so they can't be added to a thread in it.");
    if (await isInvited(ctx, postId, userId)) throw new Error("They're already in this thread.");
    const current = await ctx.db.query("forumPostMembers").withIndex("by_post", (q) => q.eq("postId", postId)).take(MAX_THREAD_MEMBERS);
    if (current.length >= MAX_THREAD_MEMBERS) throw new Error(`A private thread can have at most ${MAX_THREAD_MEMBERS} invited people.`);
    await ctx.db.insert("forumPostMembers", { postId, userId, addedBy: me._id, createdAt: Date.now() });
  },
});

/** Take someone out of a private thread, or leave it yourself. */
export const removeMember = mutation({
  args: { postId: v.id("forumPosts"), userId: v.id("users") },
  handler: async (ctx, { postId, userId }) => {
    const open = await openPost(ctx, postId);
    if (!open) throw new Error(GONE);
    const { post, me, canModerate } = open;
    if (!canRemoveMember(post, me._id, userId, canModerate)) {
      throw new Error(userId === post.authorId ? "The thread's author can't be removed." : "Only the thread's author or a moderator can remove people.");
    }
    const row = await ctx.db
      .query("forumPostMembers")
      .withIndex("by_post_user", (q) => q.eq("postId", postId).eq("userId", userId))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

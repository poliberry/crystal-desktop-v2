import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { canDo, requireSurface } from "./lib/surfaces";
import { PERMISSIONS } from "./permissions";

/**
 * A thread channel: a forum. Every post is a conversation of its own, listed by
 * how recently anyone said something in it.
 */

const MAX_TITLE = 120;
const MAX_BODY = 4000;
const MAX_REPLY = 2000;
const PAGE = 40;
const REPLIES = 300;

async function who(ctx: { db: { get: (id: Id<"users">) => Promise<Doc<"users"> | null> } }, id: Id<"users">) {
  const user = await ctx.db.get(id);
  return { id, name: user?.name ?? "Someone", imageUrl: user?.imageUrl };
}

/** Pinned posts first, then newest activity. */
export const list = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const { perms } = await requireSurface(ctx, channelId, "threads");
    const pinned = await ctx.db
      .query("forumPosts")
      .withIndex("by_channel_pinned", (q) => q.eq("channelId", channelId).eq("pinned", true))
      .order("desc")
      .take(10);
    const recent = await ctx.db
      .query("forumPosts")
      .withIndex("by_channel_activity", (q) => q.eq("channelId", channelId))
      .order("desc")
      .take(PAGE);
    const seen = new Set(pinned.map((p) => p._id));
    const rows = [...pinned, ...recent.filter((p) => !seen.has(p._id))];
    return {
      canModerate: canDo(perms, PERMISSIONS.MANAGE_MESSAGES),
      posts: await Promise.all(
        rows.map(async (p) => ({
          id: p._id,
          title: p.title,
          preview: p.body.slice(0, 160),
          author: await who(ctx, p.authorId),
          replyCount: p.replyCount,
          pinned: p.pinned,
          locked: p.locked,
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
    const post = await ctx.db.get(postId);
    if (!post) return null;
    const { me, perms } = await requireSurface(ctx, post.channelId, "threads");
    const replies = await ctx.db
      .query("forumReplies")
      .withIndex("by_post", (q) => q.eq("postId", postId))
      .take(REPLIES);
    return {
      id: post._id,
      title: post.title,
      body: post.body,
      author: await who(ctx, post.authorId),
      createdAt: post.createdAt,
      pinned: post.pinned,
      locked: post.locked,
      mine: post.authorId === me._id,
      canModerate: canDo(perms, PERMISSIONS.MANAGE_MESSAGES),
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
  args: { channelId: v.id("channels"), title: v.string(), body: v.string() },
  handler: async (ctx, { channelId, title, body }) => {
    const { me, channel, perms } = await requireSurface(ctx, channelId, "threads");
    if (!canDo(perms, PERMISSIONS.SEND_MESSAGES)) throw new Error("You can't post here.");
    const t = title.trim().slice(0, MAX_TITLE);
    const b = body.trim().slice(0, MAX_BODY);
    if (t.length < 3) throw new Error("Give it a title.");
    if (!b) throw new Error("Say something in it.");
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
    });
  },
});

export const reply = mutation({
  args: { postId: v.id("forumPosts"), text: v.string() },
  handler: async (ctx, { postId, text }) => {
    const post = await ctx.db.get(postId);
    if (!post) throw new Error("That thread is gone.");
    const { me, perms } = await requireSurface(ctx, post.channelId, "threads");
    if (!canDo(perms, PERMISSIONS.SEND_MESSAGES)) throw new Error("You can't post here.");
    if (post.locked && !canDo(perms, PERMISSIONS.MANAGE_MESSAGES)) throw new Error("This thread is locked.");
    const body = text.trim().slice(0, MAX_REPLY);
    if (!body) throw new Error("Write something first.");
    const now = Date.now();
    await ctx.db.insert("forumReplies", { postId, authorId: me._id, text: body, createdAt: now });
    await ctx.db.patch(postId, { replyCount: post.replyCount + 1, lastActivityAt: now });
  },
});

/** Pin, lock or remove a thread: its author (remove only) or whoever moderates. */
export const moderate = mutation({
  args: { postId: v.id("forumPosts"), action: v.union(v.literal("pin"), v.literal("unpin"), v.literal("lock"), v.literal("unlock"), v.literal("delete")) },
  handler: async (ctx, { postId, action }) => {
    const post = await ctx.db.get(postId);
    if (!post) return;
    const { me, perms } = await requireSurface(ctx, post.channelId, "threads");
    const mod = canDo(perms, PERMISSIONS.MANAGE_MESSAGES);
    if (action === "delete") {
      if (!mod && post.authorId !== me._id) throw new Error("That isn't yours to remove.");
      for (const r of await ctx.db.query("forumReplies").withIndex("by_post", (q) => q.eq("postId", postId)).collect()) await ctx.db.delete(r._id);
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
    const post = await ctx.db.get(reply.postId);
    if (!post) return;
    const { me, perms } = await requireSurface(ctx, post.channelId, "threads");
    if (reply.authorId !== me._id && !canDo(perms, PERMISSIONS.MANAGE_MESSAGES)) throw new Error("That isn't yours to remove.");
    await ctx.db.delete(replyId);
    await ctx.db.patch(post._id, { replyCount: Math.max(0, post.replyCount - 1) });
  },
});

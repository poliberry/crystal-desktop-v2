import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { canDo, requireSurface } from "./lib/surfaces";
import { PERMISSIONS } from "./permissions";

/**
 * An AMA channel: members ask, everyone votes, and whoever runs the channel takes
 * the questions one at a time. Running it takes `MANAGE_MESSAGES` — in a creator
 * community that is the creator and their moderators.
 */

const MAX_QUESTION = 280;
const MAX_ANSWER = 1500;
const MAX_OPEN_PER_USER = 3;
const LIST_LIMIT = 100;

async function author(ctx: { db: { get: (id: Id<"users">) => Promise<Doc<"users"> | null> } }, id: Id<"users">) {
  const user = await ctx.db.get(id);
  return { id, name: user?.name ?? "Someone", imageUrl: user?.imageUrl };
}

/** The question being answered now, the open ones by votes, and what has been answered. */
export const board = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const { me, perms } = await requireSurface(ctx, channelId, "ama");
    const rows = await ctx.db
      .query("amaQuestions")
      .withIndex("by_channel_created", (q) => q.eq("channelId", channelId))
      .order("desc")
      .take(300);
    const shape = async (q: Doc<"amaQuestions">) => ({
      id: q._id,
      text: q.text,
      votes: q.votes,
      answer: q.answer,
      status: q.status,
      createdAt: q.createdAt,
      answeredAt: q.answeredAt,
      author: await author(ctx, q.authorId),
      voted:
        (await ctx.db
          .query("amaVotes")
          .withIndex("by_question_user", (x) => x.eq("questionId", q._id).eq("userId", me._id))
          .unique()) !== null,
      mine: q.authorId === me._id,
    });
    const current = rows.find((r) => r.status === "current");
    const open = rows.filter((r) => r.status === "open").sort((a, b) => b.votes - a.votes || a.createdAt - b.createdAt).slice(0, LIST_LIMIT);
    const answered = rows.filter((r) => r.status === "answered").slice(0, 40);
    return {
      canRun: canDo(perms, PERMISSIONS.MANAGE_MESSAGES),
      current: current ? await shape(current) : null,
      open: await Promise.all(open.map(shape)),
      answered: await Promise.all(answered.map(shape)),
    };
  },
});

export const ask = mutation({
  args: { channelId: v.id("channels"), text: v.string() },
  handler: async (ctx, { channelId, text }) => {
    const { me, channel } = await requireSurface(ctx, channelId, "ama");
    const body = text.trim().slice(0, MAX_QUESTION);
    if (body.length < 3) throw new Error("Ask a proper question.");
    const mine = (
      await ctx.db
        .query("amaQuestions")
        .withIndex("by_channel_created", (q) => q.eq("channelId", channelId))
        .order("desc")
        .take(200)
    ).filter((q) => q.authorId === me._id && (q.status === "open" || q.status === "current"));
    if (mine.length >= MAX_OPEN_PER_USER) throw new Error("You have a few waiting already.");
    // Asking is voting for your own question — it starts at one.
    const id = await ctx.db.insert("amaQuestions", {
      channelId,
      communityId: channel.communityId,
      authorId: me._id,
      text: body,
      votes: 1,
      status: "open",
      createdAt: Date.now(),
    });
    await ctx.db.insert("amaVotes", { questionId: id, userId: me._id });
    return id;
  },
});

export const vote = mutation({
  args: { questionId: v.id("amaQuestions") },
  handler: async (ctx, { questionId }) => {
    const question = await ctx.db.get(questionId);
    if (!question) throw new Error("That question is gone.");
    const { me } = await requireSurface(ctx, question.channelId, "ama");
    if (question.status !== "open") throw new Error("Voting on that has closed.");
    const existing = await ctx.db
      .query("amaVotes")
      .withIndex("by_question_user", (q) => q.eq("questionId", questionId).eq("userId", me._id))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
      await ctx.db.patch(questionId, { votes: Math.max(0, question.votes - 1) });
    } else {
      await ctx.db.insert("amaVotes", { questionId, userId: me._id });
      await ctx.db.patch(questionId, { votes: question.votes + 1 });
    }
  },
});

/** Take a question: it becomes the one on screen, and whatever was there goes back to open. */
export const takeQuestion = mutation({
  args: { questionId: v.id("amaQuestions") },
  handler: async (ctx, { questionId }) => {
    const question = await ctx.db.get(questionId);
    if (!question) throw new Error("That question is gone.");
    const { perms } = await requireSurface(ctx, question.channelId, "ama");
    if (!canDo(perms, PERMISSIONS.MANAGE_MESSAGES)) throw new Error("Only the people running this can do that.");
    const current = await ctx.db
      .query("amaQuestions")
      .withIndex("by_channel_status", (q) => q.eq("channelId", question.channelId).eq("status", "current"))
      .collect();
    for (const c of current) await ctx.db.patch(c._id, { status: "open" });
    await ctx.db.patch(questionId, { status: "current" });
  },
});

export const answer = mutation({
  args: { questionId: v.id("amaQuestions"), answer: v.optional(v.string()) },
  handler: async (ctx, { questionId, answer }) => {
    const question = await ctx.db.get(questionId);
    if (!question) throw new Error("That question is gone.");
    const { perms } = await requireSurface(ctx, question.channelId, "ama");
    if (!canDo(perms, PERMISSIONS.MANAGE_MESSAGES)) throw new Error("Only the people running this can do that.");
    await ctx.db.patch(questionId, {
      status: "answered",
      // Often the answer is said aloud on stream; a written one is optional.
      answer: answer?.trim().slice(0, MAX_ANSWER) || undefined,
      answeredAt: Date.now(),
    });
  },
});

export const dismiss = mutation({
  args: { questionId: v.id("amaQuestions") },
  handler: async (ctx, { questionId }) => {
    const question = await ctx.db.get(questionId);
    if (!question) return;
    const { me, perms } = await requireSurface(ctx, question.channelId, "ama");
    // The person who asked can withdraw it; the people running the channel can drop any.
    if (question.authorId !== me._id && !canDo(perms, PERMISSIONS.MANAGE_MESSAGES)) throw new Error("That isn't yours.");
    await ctx.db.patch(questionId, { status: "dismissed" });
  },
});

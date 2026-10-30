import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireCommunity } from "./communities";
import { historyFloorFor, withinHistory } from "./lib/history";
import { pollResults } from "./lib/messageExtras";
import { pollIsOpen, validateVote } from "./lib/pollPure";
import { PERMISSIONS, can, getChannelPermissions } from "./permissions";
import { getCurrentUserOrThrow } from "./users";

/**
 * Polls on channel messages (created by `channelMessages.send` with a `poll`, which takes Create
 * Polls). Voting needs only that the member can read the message; everything that decides who may
 * vote and how is checked here, never in the client.
 */

/** The message, if `userId` can read it: the channel is theirs to see and the message is within their history. */
async function readableMessage(ctx: QueryCtx, messageId: Id<"channelMessages">, userId: Id<"users">): Promise<{ message: Doc<"channelMessages">; perms: number } | null> {
  const message = await ctx.db.get(messageId);
  if (!message?.poll) return null;
  const channel = await ctx.db.get(message.channelId);
  if (!channel) return null;
  const community = await requireCommunity(ctx, channel.communityId);
  const member = await ctx.db
    .query("communityMembers")
    .withIndex("by_community_user", (q) => q.eq("communityId", channel.communityId).eq("userId", userId))
    .unique();
  if (!member) return null;
  const perms = await getChannelPermissions(ctx, community, channel._id, userId);
  if (!can(perms, PERMISSIONS.VIEW_CHANNELS)) return null;
  const floor = await historyFloorFor(ctx, channel._id, userId, perms);
  if (!withinHistory(floor, message._creationTime)) return null;
  return { message, perms };
}

/** Live counts for one poll, and the viewer's own choices. Voters are never named. */
export const results = query({
  args: { messageId: v.id("channelMessages") },
  handler: async (ctx, { messageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const found = await readableMessage(ctx, messageId, me._id);
    if (!found) return null;
    return pollResults(ctx, found.message, me._id);
  },
});

/** Set the caller's whole vote on a poll: the options chosen, replacing any before. An empty list takes the vote back. */
export const vote = mutation({
  args: { messageId: v.id("channelMessages"), optionIds: v.array(v.number()) },
  handler: async (ctx, { messageId, optionIds }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const found = await readableMessage(ctx, messageId, me._id);
    if (!found?.message.poll) throw new Error("That poll isn't there any more.");
    const chosen = validateVote(found.message.poll, optionIds, Date.now());

    const existing = await ctx.db
      .query("channelPollVotes")
      .withIndex("by_message_user", (q) => q.eq("messageId", messageId).eq("userId", me._id))
      .collect();
    const keep = new Set<number>();
    for (const row of existing) {
      if (chosen.includes(row.optionId) && !keep.has(row.optionId)) keep.add(row.optionId);
      else await ctx.db.delete(row._id);
    }
    for (const optionId of chosen) {
      if (!keep.has(optionId)) await ctx.db.insert("channelPollVotes", { messageId, userId: me._id, optionId });
    }
  },
});

/** Close a poll now: its author, or whoever manages messages in the channel. */
export const end = mutation({
  args: { messageId: v.id("channelMessages") },
  handler: async (ctx, { messageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const found = await readableMessage(ctx, messageId, me._id);
    if (!found?.message.poll) throw new Error("That poll isn't there any more.");
    const { message, perms } = found;
    if (message.authorId !== me._id && !can(perms, PERMISSIONS.MANAGE_MESSAGES)) throw new Error("Only the poll's author can end it.");
    if (!pollIsOpen(message.poll!, Date.now())) return;
    await ctx.db.patch(messageId, { poll: { ...message.poll!, endedAt: Date.now() } });
  },
});

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { pollIsOpen, tallyVotes } from "./pollPure";

/**
 * The parts of a channel message beyond its words and files — a poll with its live results, a
 * voice message's waveform, a sticker, the text-to-speech flag — as a message list shows them.
 */

/**
 * A poll as the message list shows it: what was asked, not how it is going. The results are a query
 * of their own (`polls.results`) because they change with every vote and differ per viewer, while a
 * page of messages is shared between viewers and re-run for every subscriber each time it changes.
 */
export function pollDefinition(poll: Doc<"channelMessages">["poll"]) {
  if (!poll) return null;
  return {
    multi: poll.multi,
    optionCount: poll.optionCount,
    /** Present for a plaintext poll; an encrypted poll's words are in the message's `enc`. */
    question: poll.question ?? null,
    options: poll.options ?? null,
    expiresAt: poll.expiresAt ?? null,
    endedAt: poll.endedAt ?? null,
  };
}

/** Votes, counted for `me`'s eyes. */
export async function pollResults(ctx: QueryCtx, message: Doc<"channelMessages">, me: Id<"users">) {
  const poll = message.poll;
  if (!poll) return null;
  const votes = await ctx.db
    .query("channelPollVotes")
    .withIndex("by_message", (q) => q.eq("messageId", message._id))
    .collect();
  const results = tallyVotes(poll, votes, me);
  return {
    open: pollIsOpen(poll, Date.now()),
    counts: results.counts,
    voters: results.voters,
    mine: results.mine,
    leading: results.leading,
  };
}

export async function stickerView(ctx: QueryCtx, stickerId: Id<"communityStickers"> | undefined) {
  if (!stickerId) return null;
  const sticker = await ctx.db.get(stickerId);
  if (!sticker) return { id: stickerId as string, name: "Deleted sticker", imageUrl: null as string | null, communityId: null as Id<"communities"> | null };
  return { id: sticker._id as string, name: sticker.name, imageUrl: sticker.imageUrl as string | null, communityId: sticker.communityId as Id<"communities"> | null };
}

export async function messageExtras(ctx: QueryCtx, message: Doc<"channelMessages">) {
  return {
    tts: message.tts ?? false,
    voiceMessage: message.voiceMessage ?? null,
    poll: pollDefinition(message.poll),
    sticker: await stickerView(ctx, message.stickerId),
  };
}

/** Take a message's poll votes with it when the message goes. */
export async function dropPollVotes(ctx: MutationCtx, messageId: Id<"channelMessages">): Promise<void> {
  for (const vote of await ctx.db.query("channelPollVotes").withIndex("by_message", (q) => q.eq("messageId", messageId)).collect()) {
    await ctx.db.delete(vote._id);
  }
}

/** What a channel keeps about its members' slowmode and history, gone when the channel is. */
export async function dropChannelMemberState(ctx: MutationCtx, channelId: Id<"channels">): Promise<void> {
  for (const row of await ctx.db.query("channelHistoryAnchors").withIndex("by_channel_user", (q) => q.eq("channelId", channelId)).collect()) {
    await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db.query("channelSlowmode").withIndex("by_channel_user_scope", (q) => q.eq("channelId", channelId)).collect()) {
    await ctx.db.delete(row._id);
  }
}

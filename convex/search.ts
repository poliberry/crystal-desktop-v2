import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { requireCommunity } from "./communities";
import { PERMISSIONS, can, getChannelPermissions } from "./permissions";
import { getCurrentUserOrThrow } from "./users";

/**
 * Message search, scoped to one channel, one server, or one conversation.
 *
 * Added for mobile, which moved search out of a global palette and into the
 * place you're looking at — searching a server, a channel or a DM rather than
 * a flat list of everything.
 *
 * ## Why a server search fans out over channels
 *
 * `channelMessages` rows carry a `channelId` but no `communityId`, so a search
 * index can't filter by community directly. Adding that field would mean
 * backfilling every existing message; running one search per viewable channel
 * and merging costs a handful of index reads instead and needs no migration.
 * `MAX_CHANNELS_SEARCHED` keeps that bounded on a large server.
 *
 * ## Why permissions are re-checked per channel
 *
 * A private channel is private through permission overwrites. Searching
 * without re-checking would happily return its contents — and the existence of
 * the channel — to anyone who can see the server at all.
 */

/** Results per scope. Enough to be useful in a list you scroll, small enough
 * that the per-result author/channel lookups stay cheap. */
const LIMIT = 40;

/** How many channels a single server-wide search will look at, most recently
 * active first. */
const MAX_CHANNELS_SEARCHED = 40;

export interface SearchResult {
  id: string;
  text: string;
  createdAt: number;
  author: { id: string; name: string; imageUrl?: string } | null;
  /** Set for channel results; absent for DM ones. */
  channelId?: string;
  channelName?: string;
  /** Set for DM results. */
  conversationId?: string;
}

async function decorate(
  ctx: QueryCtx,
  rows: (Doc<"channelMessages"> | Doc<"messages">)[],
  channelNames: Map<string, string>
): Promise<SearchResult[]> {
  const authorIds = [...new Set(rows.map((r) => r.authorId))];
  const authors = new Map(
    (await Promise.all(authorIds.map((id) => ctx.db.get(id)))).flatMap((user) =>
      user ? [[user._id as string, user] as const] : []
    )
  );

  return rows.map((row) => {
    const author = authors.get(row.authorId);
    const channelId = "channelId" in row ? (row.channelId as string) : undefined;
    return {
      id: row._id,
      text: row.text ?? "",
      createdAt: row._creationTime,
      author: author ? { id: author._id, name: author.name, imageUrl: author.imageUrl } : null,
      channelId,
      channelName: channelId ? channelNames.get(channelId) : undefined,
      conversationId: "conversationId" in row ? (row.conversationId as string) : undefined,
    };
  });
}

/** Everything in one text channel. */
export const inChannel = query({
  args: { channelId: v.id("channels"), query: v.string() },
  handler: async (ctx, { channelId, query: text }) => {
    const needle = text.trim();
    if (!needle) return [];

    const me = await getCurrentUserOrThrow(ctx);
    const channel = await ctx.db.get(channelId);
    if (!channel) throw new Error("Channel not found.");
    const community = await requireCommunity(ctx, channel.communityId);
    const perms = await getChannelPermissions(ctx, community, channelId, me._id);
    if (!can(perms, PERMISSIONS.VIEW_CHANNELS)) throw new Error("You don't have permission to do that.");

    const rows = await ctx.db
      .query("channelMessages")
      .withSearchIndex("search_text", (q) => q.search("text", needle).eq("channelId", channelId))
      .take(LIMIT);

    return decorate(ctx, rows, new Map([[channelId as string, channel.name]]));
  },
});

/** Every text channel in one server that the caller can actually see. */
export const inCommunity = query({
  args: { communityId: v.id("communities"), query: v.string() },
  handler: async (ctx, { communityId, query: text }) => {
    const needle = text.trim();
    if (!needle) return [];

    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);

    const channels = await ctx.db
      .query("channels")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();

    // Most recently active first, so the cap below trims the channels least
    // likely to hold what's being looked for.
    const searchable = channels
      .filter((channel) => channel.type !== "voice")
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
      .slice(0, MAX_CHANNELS_SEARCHED);

    const channelNames = new Map<string, string>();
    const rows: Doc<"channelMessages">[] = [];

    for (const channel of searchable) {
      const perms = await getChannelPermissions(ctx, community, channel._id, me._id);
      if (!can(perms, PERMISSIONS.VIEW_CHANNELS)) continue;
      channelNames.set(channel._id, channel.name);

      const found = await ctx.db
        .query("channelMessages")
        .withSearchIndex("search_text", (q) => q.search("text", needle).eq("channelId", channel._id))
        .take(LIMIT);
      rows.push(...found);
    }

    // Each channel's results arrive in relevance order but the merged list has
    // no shared ranking, so it's ordered by recency — which is also what
    // someone scanning for "that thing from yesterday" expects.
    rows.sort((a, b) => b._creationTime - a._creationTime);

    return decorate(ctx, rows.slice(0, LIMIT), channelNames);
  },
});

/** One DM or group conversation. */
export const inConversation = query({
  args: { conversationId: v.id("conversations"), query: v.string() },
  handler: async (ctx, { conversationId, query: text }) => {
    const needle = text.trim();
    if (!needle) return [];

    const me = await getCurrentUserOrThrow(ctx);
    const membership = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversationId).eq("userId", me._id)
      )
      .unique();
    if (!membership) throw new Error("Not a member of this conversation.");

    const rows = await ctx.db
      .query("messages")
      .withSearchIndex("search_text", (q) =>
        q.search("text", needle).eq("conversationId", conversationId)
      )
      .take(LIMIT);

    return decorate(ctx, rows, new Map());
  },
});

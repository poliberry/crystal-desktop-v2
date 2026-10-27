import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireCommunity, requireMember } from "./communities";
import { sanitizeClanGames } from "./lib/communityKinds";
import { PERMISSIONS, can, getBasePermissions } from "./permissions";
import { getCurrentUserOrThrow } from "./users";

/**
 * What a clan does that another community doesn't: a roster per game, and calls
 * for people to play with. Only available in a community of kind `clan`.
 */

const MAX_IGN = 40;
const MAX_RANK = 40;
const LFG_MAX_SLOTS = 9;
const LFG_LIFETIME_MS = 3 * 60 * 60 * 1000;
const MAX_OPEN_LFG_PER_USER = 3;

async function clanOf(ctx: QueryCtx, communityId: Id<"communities">): Promise<Doc<"communities">> {
  const community = await requireCommunity(ctx, communityId);
  if (community.kind !== "clan") throw new Error("That isn't a clan.");
  return community;
}

function gameOf(community: Doc<"communities">, gameId: string) {
  const game = community.clanGames?.find((g) => g.id === gameId);
  if (!game) throw new Error("The clan doesn't play that.");
  return game;
}

async function nameOf(ctx: QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  return { id: userId, name: user?.name ?? "Someone", imageUrl: user?.imageUrl };
}

// --- Roster ------------------------------------------------------------------------------

/** The clan's games, and everyone on each one's roster. */
export const roster = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const community = await clanOf(ctx, communityId);
    const games = community.clanGames ?? [];
    return Promise.all(
      games.map(async (game) => {
        const rows = await ctx.db
          .query("clanRoster")
          .withIndex("by_community_game", (q) => q.eq("communityId", communityId).eq("gameId", game.id))
          .take(200);
        const players = await Promise.all(
          rows.map(async (row) => ({
            id: row._id,
            user: await nameOf(ctx, row.userId),
            ign: row.ign,
            rank: row.rank,
            role: row.role,
            mine: row.userId === me._id,
          })),
        );
        return { game, players };
      }),
    );
  },
});

/** Put yourself on a game's roster, or change how you are listed. */
export const setRoster = mutation({
  args: {
    communityId: v.id("communities"),
    gameId: v.string(),
    ign: v.string(),
    rank: v.optional(v.string()),
    role: v.optional(v.string()),
  },
  handler: async (ctx, { communityId, gameId, ign, rank, role }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    gameOf(await clanOf(ctx, communityId), gameId);
    const name = ign.trim().slice(0, MAX_IGN);
    if (!name) throw new Error("What do you go by in the game?");
    const existing = (
      await ctx.db
        .query("clanRoster")
        .withIndex("by_member", (q) => q.eq("communityId", communityId).eq("userId", me._id))
        .collect()
    ).find((r) => r.gameId === gameId);
    const fields = {
      ign: name,
      rank: rank?.trim().slice(0, MAX_RANK) || undefined,
      role: role?.trim().slice(0, MAX_RANK) || undefined,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, fields);
    else await ctx.db.insert("clanRoster", { communityId, userId: me._id, gameId, ...fields });
  },
});

/** Take yourself off a roster — or, with the right, somebody else. */
export const leaveRoster = mutation({
  args: { rosterId: v.id("clanRoster") },
  handler: async (ctx, { rosterId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const row = await ctx.db.get(rosterId);
    if (!row) return;
    if (row.userId !== me._id) {
      const community = await requireCommunity(ctx, row.communityId);
      const perms = await getBasePermissions(ctx, community, me._id);
      if (!can(perms, PERMISSIONS.MANAGE_COMMUNITY)) throw new Error("That isn't yours to remove.");
    }
    await ctx.db.delete(rosterId);
  },
});

// --- Looking for group ---------------------------------------------------------------------

/** Open calls for people, newest first. Expired ones are filtered here and swept later. */
export const lfg = query({
  args: { communityId: v.id("communities"), gameId: v.optional(v.string()) },
  handler: async (ctx, { communityId, gameId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    await clanOf(ctx, communityId);
    const now = Date.now();
    const rows = await ctx.db
      .query("lfgPosts")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .order("desc")
      .take(60);
    const open = rows.filter((r) => !r.closedAt && r.expiresAt > now && (!gameId || r.gameId === gameId));
    return Promise.all(
      open.map(async (row) => ({
        id: row._id,
        gameId: row.gameId,
        title: row.title,
        details: row.details,
        slots: row.slots,
        author: await nameOf(ctx, row.authorId),
        joined: await Promise.all(row.joined.map((id) => nameOf(ctx, id))),
        full: row.joined.length >= row.slots,
        iJoined: row.joined.includes(me._id),
        mine: row.authorId === me._id,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      })),
    );
  },
});

export const postLfg = mutation({
  args: {
    communityId: v.id("communities"),
    gameId: v.string(),
    title: v.string(),
    details: v.optional(v.string()),
    slots: v.number(),
  },
  handler: async (ctx, { communityId, gameId, title, details, slots }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    gameOf(await clanOf(ctx, communityId), gameId);
    const text = title.trim().slice(0, 80);
    if (!text) throw new Error("Say what you're looking for.");
    if (!Number.isInteger(slots) || slots < 1 || slots > LFG_MAX_SLOTS) throw new Error(`Ask for between 1 and ${LFG_MAX_SLOTS} people.`);

    const now = Date.now();
    const mine = await ctx.db
      .query("lfgPosts")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .order("desc")
      .take(80);
    const open = mine.filter((p) => p.authorId === me._id && !p.closedAt && p.expiresAt > now);
    if (open.length >= MAX_OPEN_LFG_PER_USER) throw new Error("You already have a few open. Close one first.");

    return ctx.db.insert("lfgPosts", {
      communityId,
      gameId,
      authorId: me._id,
      title: text,
      details: details?.trim().slice(0, 300) || undefined,
      slots,
      joined: [],
      createdAt: now,
      expiresAt: now + LFG_LIFETIME_MS,
    });
  },
});

async function openPost(ctx: MutationCtx, postId: Id<"lfgPosts">, userId: Id<"users">) {
  const post = await ctx.db.get(postId);
  if (!post) throw new Error("That post is gone.");
  await requireMember(ctx, post.communityId, userId);
  if (post.closedAt || post.expiresAt <= Date.now()) throw new Error("That one has closed.");
  return post;
}

export const joinLfg = mutation({
  args: { postId: v.id("lfgPosts") },
  handler: async (ctx, { postId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const post = await openPost(ctx, postId, me._id);
    if (post.authorId === me._id) throw new Error("It's your own post.");
    if (post.joined.includes(me._id)) return;
    if (post.joined.length >= post.slots) throw new Error("It's full.");
    await ctx.db.patch(postId, { joined: [...post.joined, me._id] });
  },
});

export const leaveLfg = mutation({
  args: { postId: v.id("lfgPosts") },
  handler: async (ctx, { postId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const post = await ctx.db.get(postId);
    if (!post) return;
    await ctx.db.patch(postId, { joined: post.joined.filter((id) => id !== me._id) });
  },
});

/** Close a post: the author, or anyone who manages the community. */
export const closeLfg = mutation({
  args: { postId: v.id("lfgPosts") },
  handler: async (ctx, { postId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const post = await ctx.db.get(postId);
    if (!post || post.closedAt) return;
    if (post.authorId !== me._id) {
      const community = await requireCommunity(ctx, post.communityId);
      const perms = await getBasePermissions(ctx, community, me._id);
      if (!can(perms, PERMISSIONS.MANAGE_MESSAGES)) throw new Error("That isn't yours to close.");
    }
    await ctx.db.patch(postId, { closedAt: Date.now() });
  },
});

/** Change which games the clan plays. Removing one doesn't delete its roster or
 * channels — those stay, and a game added back finds them again. */
export const setGames = mutation({
  args: { communityId: v.id("communities"), games: v.array(v.object({ id: v.optional(v.string()), name: v.string() })) },
  handler: async (ctx, { communityId, games }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await clanOf(ctx, communityId);
    const perms = await getBasePermissions(ctx, community, me._id);
    if (!can(perms, PERMISSIONS.MANAGE_COMMUNITY)) throw new Error("Only the people who run the clan can change its games.");
    await ctx.db.patch(communityId, { clanGames: sanitizeClanGames(games) });
    try {
      const { cacheInvalidateKeys } = await import("./cache");
      await cacheInvalidateKeys(`community:${communityId}:user:${me._id}:data`);
    } catch {}
  },
});

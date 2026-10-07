import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireCommunity, requireMember } from "./communities";
import { PERMISSIONS, can, getBasePermissions, requireCommunityPermission } from "./permissions";
import { getCurrentUserOrThrow } from "./users";

/**
 * A community's calendar: events, scrims and streams, with sign-ups. Used by clans
 * and creator communities; a standard community has no calendar channel.
 */

const MAX_TITLE = 80;
const MAX_DETAILS = 800;
const MAX_UPCOMING = 200;
/** Furthest ahead something can be scheduled. */
const HORIZON_MS = 400 * 24 * 60 * 60 * 1000;

const kindValidator = v.union(v.literal("event"), v.literal("scrim"), v.literal("stream"));

/** Events starting in a window, with who is going and what the caller said. */
export const list = query({
  args: { communityId: v.id("communities"), from: v.number(), to: v.number() },
  handler: async (ctx, { communityId, from, to }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const rows = await ctx.db
      .query("communityEvents")
      .withIndex("by_community_start", (q) => q.eq("communityId", communityId).gte("startsAt", from).lt("startsAt", to))
      .take(MAX_UPCOMING);
    return Promise.all(
      rows.map(async (event) => {
        const rsvps = await ctx.db
          .query("eventRsvps")
          .withIndex("by_event", (q) => q.eq("eventId", event._id))
          .take(300);
        const people = await Promise.all(
          rsvps.map(async (r) => {
            const user = await ctx.db.get(r.userId);
            return { id: r.userId, name: user?.name ?? "Someone", imageUrl: user?.imageUrl, status: r.status, starter: r.starter === true };
          }),
        );
        return {
          id: event._id,
          kind: event.kind,
          title: event.title,
          details: event.details,
          gameId: event.gameId,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          capacity: event.capacity,
          cancelled: event.cancelledAt !== undefined,
          going: people.filter((p) => p.status === "going"),
          maybe: people.filter((p) => p.status === "maybe"),
          mine: rsvps.find((r) => r.userId === me._id)?.status ?? null,
          createdBy: event.createdBy,
        };
      }),
    );
  },
});

function checkWhen(startsAt: number, endsAt: number | undefined) {
  const now = Date.now();
  if (!Number.isFinite(startsAt) || startsAt < now - 60_000 || startsAt > now + HORIZON_MS) throw new Error("Pick a time in the next year or so.");
  if (endsAt !== undefined && (!Number.isFinite(endsAt) || endsAt <= startsAt || endsAt - startsAt > 7 * 24 * 60 * 60 * 1000)) {
    throw new Error("It has to end after it starts, within a week.");
  }
}

export const create = mutation({
  args: {
    communityId: v.id("communities"),
    kind: kindValidator,
    title: v.string(),
    details: v.optional(v.string()),
    gameId: v.optional(v.string()),
    startsAt: v.number(),
    endsAt: v.optional(v.number()),
    capacity: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"communityEvents">> => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, args.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_EVENTS);
    if (!community.kind) throw new Error("A calendar is for clans and creator communities.");
    const title = args.title.trim().slice(0, MAX_TITLE);
    if (!title) throw new Error("Give it a title.");
    checkWhen(args.startsAt, args.endsAt);
    if (args.gameId && !community.clanGames?.some((g) => g.id === args.gameId)) throw new Error("The clan doesn't play that.");
    if (args.kind === "scrim" && args.capacity !== undefined && (!Number.isInteger(args.capacity) || args.capacity < 1 || args.capacity > 100)) {
      throw new Error("A scrim fields between 1 and 100 people.");
    }
    return ctx.db.insert("communityEvents", {
      communityId: args.communityId,
      kind: args.kind,
      title,
      details: args.details?.trim().slice(0, MAX_DETAILS) || undefined,
      gameId: args.gameId,
      startsAt: args.startsAt,
      endsAt: args.endsAt,
      capacity: args.kind === "scrim" ? args.capacity : undefined,
      createdBy: me._id,
      createdAt: Date.now(),
    });
  },
});

export const cancel = mutation({
  args: { eventId: v.id("communityEvents") },
  handler: async (ctx, { eventId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const event = await ctx.db.get(eventId);
    if (!event) return;
    const community = await requireCommunity(ctx, event.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_EVENTS);
    await ctx.db.patch(eventId, { cancelledAt: Date.now() });
  },
});

/** Say you're going, maybe going, or (with `null`) not going. */
export const rsvp = mutation({
  args: { eventId: v.id("communityEvents"), status: v.union(v.literal("going"), v.literal("maybe"), v.null()) },
  handler: async (ctx, { eventId, status }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const event = await ctx.db.get(eventId);
    if (!event || event.cancelledAt) throw new Error("That event isn't on any more.");
    await requireMember(ctx, event.communityId, me._id);
    const existing = await ctx.db
      .query("eventRsvps")
      .withIndex("by_event_user", (q) => q.eq("eventId", eventId).eq("userId", me._id))
      .unique();
    if (status === null) {
      if (existing) await ctx.db.delete(existing._id);
      return;
    }
    if (event.capacity !== undefined && status === "going" && existing?.status !== "going") {
      const going = (await ctx.db.query("eventRsvps").withIndex("by_event", (q) => q.eq("eventId", eventId)).take(300)).filter(
        (r) => r.status === "going",
      );
      if (going.length >= event.capacity) throw new Error("It's full — you can still put yourself down as maybe.");
    }
    if (existing) await ctx.db.patch(existing._id, { status });
    else await ctx.db.insert("eventRsvps", { eventId, communityId: event.communityId, userId: me._id, status, createdAt: Date.now() });
  },
});

/** Pick the lineup for a scrim. */
export const setStarter = mutation({
  args: { eventId: v.id("communityEvents"), userId: v.id("users"), starter: v.boolean() },
  handler: async (ctx, { eventId, userId, starter }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error("That event is gone.");
    const community = await requireCommunity(ctx, event.communityId);
    const perms = await getBasePermissions(ctx, community, me._id);
    if (!can(perms, PERMISSIONS.MANAGE_EVENTS)) throw new Error("You can't pick the lineup.");
    const row = await ctx.db
      .query("eventRsvps")
      .withIndex("by_event_user", (q) => q.eq("eventId", eventId).eq("userId", userId))
      .unique();
    if (!row || row.status !== "going") throw new Error("They haven't said they're going.");
    await ctx.db.patch(row._id, { starter });
  },
});

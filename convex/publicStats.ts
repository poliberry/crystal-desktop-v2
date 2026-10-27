import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, query } from "./_generated/server";

/**
 * The two numbers the public landing page shows: how many people have a Crystal account, and how many
 * of them are online right now.
 *
 * Counted by a cron rather than on read. The landing page is the most-visited thing there is and is
 * served to people who aren't signed in, so it must not be able to make the database walk the users
 * table; it reads one small row instead. The count pages through users in an action so it keeps
 * working past what a single query is allowed to read. Bots, the system account and guests are not
 * people with accounts, so none of them count.
 */

const KEY = "global";
const PAGE = 2000;
/** Matches `STALE_MS` in presence.ts: a heartbeat older than this isn't "online". */
const ONLINE_WINDOW_MS = 60_000;

export const get = query({
  args: {},
  handler: async (ctx): Promise<{ members: number; online: number; updatedAt: number } | null> => {
    const row = await ctx.db.query("publicStats").withIndex("by_key", (q) => q.eq("key", KEY)).unique();
    return row ? { members: row.members, online: row.online, updatedAt: row.updatedAt } : null;
  },
});

export const countUsersPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("users").paginate({ cursor, numItems: PAGE });
    const people = page.page.filter((user) => !user.isBot && !user.isGuest && !user.clerkId?.startsWith("system:")).length;
    return { people, cursor: page.continueCursor, done: page.isDone };
  },
});

export const countOnline = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("presence")
      .withIndex("by_last_heartbeat", (q) => q.gt("lastHeartbeat", Date.now() - ONLINE_WINDOW_MS))
      .collect();
    let online = 0;
    for (const row of rows) {
      if (row.effective === "offline") continue;
      const user = await ctx.db.get(row.userId);
      if (user && !user.isBot && !user.isGuest) online++;
    }
    return online;
  },
});

export const store = internalMutation({
  args: { members: v.number(), online: v.number() },
  handler: async (ctx, { members, online }) => {
    const row = await ctx.db.query("publicStats").withIndex("by_key", (q) => q.eq("key", KEY)).unique();
    const fields = { members, online, updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, fields);
    else await ctx.db.insert("publicStats", { key: KEY, ...fields });
  },
});

export const refresh = internalAction({
  args: {},
  handler: async (ctx): Promise<{ members: number; online: number }> => {
    let members = 0;
    let cursor: string | null = null;
    for (;;) {
      const page: { people: number; cursor: string; done: boolean } = await ctx.runQuery(internal.publicStats.countUsersPage, { cursor });
      members += page.people;
      if (page.done) break;
      cursor = page.cursor;
    }
    const online: number = await ctx.runQuery(internal.publicStats.countOnline, {});
    await ctx.runMutation(internal.publicStats.store, { members, online });
    return { members, online };
  },
});

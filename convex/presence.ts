import { v } from "convex/values";

import { internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

const STALE_MS = 60_000;

const manualStatusValidator = v.union(
  v.literal("online"),
  v.literal("idle"),
  v.literal("dnd"),
  v.literal("invisible")
);

function computeEffective(manualStatus: "online" | "idle" | "dnd" | "invisible", isIdle: boolean) {
  if (manualStatus === "invisible") return "offline" as const;
  if (manualStatus === "dnd") return "dnd" as const;
  if (manualStatus === "idle") return "idle" as const;
  return isIdle ? ("idle" as const) : ("online" as const);
}

export const getMine = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    return ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .unique();
  },
});

export const heartbeat = mutation({
  args: { isIdle: v.boolean() },
  handler: async (ctx, { isIdle }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return;

    const existing = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .unique();
    const manualStatus = existing?.manualStatus ?? "online";
    const effective = computeEffective(manualStatus, isIdle);

    if (existing) {
      await ctx.db.patch(existing._id, { isIdle, lastHeartbeat: Date.now(), effective });
    } else {
      await ctx.db.insert("presence", {
        userId: me._id,
        manualStatus,
        isIdle,
        lastHeartbeat: Date.now(),
        effective,
      });
    }
  },
});

export const setStatus = mutation({
  args: { manualStatus: manualStatusValidator },
  handler: async (ctx, { manualStatus }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .unique();
    const isIdle = existing?.isIdle ?? false;
    const effective = computeEffective(manualStatus, isIdle);

    if (existing) {
      await ctx.db.patch(existing._id, { manualStatus, effective, lastHeartbeat: Date.now() });
    } else {
      await ctx.db.insert("presence", {
        userId: me._id,
        manualStatus,
        isIdle,
        lastHeartbeat: Date.now(),
        effective,
      });
    }
  },
});

export const sweepStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_MS;
    const stale = await ctx.db
      .query("presence")
      .withIndex("by_last_heartbeat", (q) => q.lt("lastHeartbeat", cutoff))
      .collect();
    for (const row of stale) {
      if (row.effective !== "offline") {
        await ctx.db.patch(row._id, { effective: "offline" });
      }
    }
  },
});

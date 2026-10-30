import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, query } from "./_generated/server";
import { requireCommunity, requireMember } from "./communities";
import {
  INSIGHT_KEEP_DAYS,
  VOICE_TICK_MINUTES,
  buildSeries,
  clampRange,
  dayOf,
  recordVoiceMinutes,
  totalsOf,
  voiceMinutesByCommunity,
} from "./lib/communityInsights";
import { PERMISSIONS, can, getBasePermissions } from "./permissions";
import { getCurrentUserOrThrow } from "./users";

/**
 * What the Insights page shows. The numbers are counters kept as things happen
 * (convex/lib/communityInsights.ts), so this reads at most `days` x a few small rows however big
 * the community is.
 */
export const overview = query({
  args: { communityId: v.id("communities"), days: v.number() },
  handler: async (ctx, { communityId, days }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireMember(ctx, communityId, me._id);
    if (!can(await getBasePermissions(ctx, community, me._id), PERMISSIONS.VIEW_INSIGHTS)) {
      throw new Error("You don't have permission to see this community's insights.");
    }

    const range = clampRange(days);
    const today = dayOf(Date.now());
    // Twice the range, so the page can say how this period compares with the one before it.
    const rows = await ctx.db
      .query("communityInsightsDaily")
      .withIndex("by_community_day_shard", (q) => q.eq("communityId", communityId).gte("day", today - range * 2 + 1))
      .collect();
    const both = buildSeries(rows, today, range * 2);
    const series = both.slice(range);
    return { range, series, totals: totalsOf(series), previous: totalsOf(both.slice(0, range)) };
  },
});

/**
 * Credit everyone in a call at this moment with the length of a tick. Run on a schedule; it reads
 * only the live participant rows, which are as many as there are people in calls right now.
 */
export const tickVoice = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("channelCallParticipants").collect();
    if (rows.length === 0) return;
    const communityOf = new Map<string, string | null>();
    for (const row of rows) {
      if (communityOf.has(row.channelId)) continue;
      communityOf.set(row.channelId, (await ctx.db.get(row.channelId))?.communityId ?? null);
    }
    const minutes = voiceMinutesByCommunity((id) => communityOf.get(id) ?? null, rows.map((r) => r.channelId), VOICE_TICK_MINUTES);
    for (const [communityId, amount] of minutes) await recordVoiceMinutes(ctx, communityId as Id<"communities">, amount);
  },
});

const SWEEP_BATCH = 500;

/** Drop the "already counted today" rows once the day is over, and counters past the retention window. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const today = dayOf(Date.now());
    const seen = await ctx.db.query("communityInsightsActive").withIndex("by_day", (q) => q.lt("day", today - 1)).take(SWEEP_BATCH);
    for (const row of seen) await ctx.db.delete(row._id);
    const old = await ctx.db.query("communityInsightsDaily").withIndex("by_day", (q) => q.lt("day", today - INSIGHT_KEEP_DAYS)).take(SWEEP_BATCH);
    for (const row of old) await ctx.db.delete(row._id);
    // More than a batch left over: pick up again straight away rather than waiting for the next run.
    if (seen.length === SWEEP_BATCH || old.length === SWEEP_BATCH) await ctx.scheduler.runAfter(0, internal.communityInsights.sweep, {});
  },
});

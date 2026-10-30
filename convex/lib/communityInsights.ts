import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Community insights: daily counters kept up to date as things happen, so the Insights page reads
 * a few dozen small rows instead of counting members, messages or call minutes.
 *
 * One bucket is one UTC day. A bucket is split into a few `shard` rows that writers pick between
 * at random, because every message in a busy community bumps the same day's counter and a single
 * row would turn that into a queue of conflicting writes; the reader adds the shards back up.
 * "Active members" is the number of different people who wrote a message that day, which needs to
 * know who already counted — `communityInsightsActive` holds one row per person per day for that,
 * and is swept out after a couple of days since only today's matters.
 *
 * Nothing here ever reads message content, and only counts are kept. The pure part (days, shards,
 * summing) comes first and is tested in scripts/tests/community-insights.test.mts.
 */

export const DAY_MS = 86_400_000;
export const INSIGHT_SHARDS = 4;
/** The ranges the page offers. */
export const INSIGHT_RANGES = [7, 30, 90] as const;
/** Buckets older than this are deleted by the daily sweep. */
export const INSIGHT_KEEP_DAYS = 400;
/** How often the voice tick runs (convex/crons.ts), and so how many minutes each person in a call is credited per tick. */
export const VOICE_TICK_MINUTES = 5;

export type InsightCounter = "joined" | "left" | "messages" | "active" | "voiceMinutes";

export interface InsightRow {
  day: number;
  joined?: number;
  left?: number;
  messages?: number;
  active?: number;
  voiceMinutes?: number;
}

export interface InsightDay {
  day: number;
  /** ISO date, `2026-10-30`. */
  date: string;
  joined: number;
  left: number;
  messages: number;
  active: number;
  voiceMinutes: number;
}

/** Whole days since the epoch, UTC. */
export const dayOf = (ms: number): number => Math.floor(ms / DAY_MS);

export const dateOfDay = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** Which shard a write goes to. `random` is in [0, 1). */
export const pickShard = (random: number): number => Math.min(INSIGHT_SHARDS - 1, Math.max(0, Math.floor(random * INSIGHT_SHARDS)));

/** Snap a requested range to one the page offers. */
export function clampRange(days: number): number {
  return (INSIGHT_RANGES as readonly number[]).includes(days) ? days : 30;
}

/**
 * Voice minutes per community for one tick: everyone in a call at the moment of the tick is credited
 * the tick's length. Sampling is what makes this cheap — a call can end in half a dozen ways (leave,
 * disconnect, kick, the reconciliation sweep) and counting at each would miss some — at the price of
 * being right to within one tick per stay.
 */
export function voiceMinutesByCommunity(channelCommunity: (channelId: string) => string | null, presentChannelIds: string[], tickMinutes = VOICE_TICK_MINUTES): Map<string, number> {
  const out = new Map<string, number>();
  for (const channelId of presentChannelIds) {
    const communityId = channelCommunity(channelId);
    if (communityId) out.set(communityId, (out.get(communityId) ?? 0) + tickMinutes);
  }
  return out;
}

/**
 * The last `days` days up to and including `today`, one entry each, with every shard of a day added
 * together. Days with nothing recorded are zeros rather than missing, so the chart has no gaps.
 */
export function buildSeries(rows: InsightRow[], today: number, days: number): InsightDay[] {
  const first = today - days + 1;
  const byDay = new Map<number, InsightDay>();
  for (let d = first; d <= today; d++) {
    byDay.set(d, { day: d, date: dateOfDay(d), joined: 0, left: 0, messages: 0, active: 0, voiceMinutes: 0 });
  }
  for (const row of rows) {
    const entry = byDay.get(row.day);
    if (!entry) continue;
    entry.joined += row.joined ?? 0;
    entry.left += row.left ?? 0;
    entry.messages += row.messages ?? 0;
    entry.active += row.active ?? 0;
    entry.voiceMinutes += row.voiceMinutes ?? 0;
  }
  return [...byDay.values()];
}

export interface InsightTotals {
  joined: number;
  left: number;
  net: number;
  messages: number;
  voiceMinutes: number;
  /** The busiest day's number of active members. */
  peakActive: number;
  /** Active members averaged over the days in the range. */
  avgActive: number;
}

export function totalsOf(series: InsightDay[]): InsightTotals {
  let joined = 0, left = 0, messages = 0, voiceMinutes = 0, peakActive = 0, activeSum = 0;
  for (const d of series) {
    joined += d.joined;
    left += d.left;
    messages += d.messages;
    voiceMinutes += d.voiceMinutes;
    activeSum += d.active;
    peakActive = Math.max(peakActive, d.active);
  }
  return {
    joined,
    left,
    net: joined - left,
    messages,
    voiceMinutes,
    peakActive,
    avgActive: series.length ? Math.round((activeSum / series.length) * 10) / 10 : 0,
  };
}

// --- Writing ---------------------------------------------------------------------------------

async function bump(ctx: MutationCtx, communityId: Id<"communities">, counter: InsightCounter, amount: number): Promise<void> {
  if (amount <= 0) return;
  const day = dayOf(Date.now());
  const shard = pickShard(Math.random());
  // Reads only this shard's row, so writers on other shards don't conflict with this one.
  const row = await ctx.db
    .query("communityInsightsDaily")
    .withIndex("by_community_day_shard", (q) => q.eq("communityId", communityId).eq("day", day).eq("shard", shard))
    .unique();
  if (row) await ctx.db.patch(row._id, { [counter]: (row[counter] ?? 0) + amount });
  else await ctx.db.insert("communityInsightsDaily", { communityId, day, shard, [counter]: amount });
}

/** A person (not a bot) joined the community. */
export const recordMemberJoined = (ctx: MutationCtx, communityId: Id<"communities">) => bump(ctx, communityId, "joined", 1);

/** A person left, or was kicked, banned or pruned. */
export const recordMemberLeft = (ctx: MutationCtx, communityId: Id<"communities">) => bump(ctx, communityId, "left", 1);

/** A message was sent. Counts the message, and the author as active today the first time they send one. */
export async function recordMessageSent(ctx: MutationCtx, communityId: Id<"communities">, authorId: Id<"users">): Promise<void> {
  await bump(ctx, communityId, "messages", 1);
  const day = dayOf(Date.now());
  const seen = await ctx.db
    .query("communityInsightsActive")
    .withIndex("by_community_day_user", (q) => q.eq("communityId", communityId).eq("day", day).eq("userId", authorId))
    .unique();
  if (seen) return;
  await ctx.db.insert("communityInsightsActive", { communityId, day, userId: authorId });
  await bump(ctx, communityId, "active", 1);
}

/** Credit call time (from the voice tick, see convex/communityInsights.ts). */
export const recordVoiceMinutes = (ctx: MutationCtx, communityId: Id<"communities">, minutes: number) => bump(ctx, communityId, "voiceMinutes", minutes);

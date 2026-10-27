import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Maintains the per-user play history behind the profile's "Recent activity"
 * list.
 *
 * Rather than writing on a timer, this is driven by *transitions*: a game
 * appearing in someone's activities opens a session, and a game disappearing
 * closes it and banks the elapsed time. Presence only reports on change, so a
 * three-hour session costs exactly two writes instead of one every heartbeat.
 *
 * Only `type: "playing"` activities are recorded. Music is deliberately
 * excluded — a listening history is a separate feature with very different
 * privacy implications, and the live presence row already answers "what are
 * they listening to now".
 */

/** How far back the profile list looks; older rows are swept on write. */
export const HISTORY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Most games kept per user. Beyond this the least-recently-played go. */
const MAX_ROWS_PER_USER = 30;

/** A single session longer than this is almost certainly a client that died
 * without reporting; bank a bounded amount rather than a bogus 40 hours. */
const MAX_SESSION_MS = 12 * 60 * 60 * 1000;

type ActivityLike = { type: string; name: string; imageUrl?: string; startedAt?: number };

function gamesOf(activities: readonly ActivityLike[]): Map<string, ActivityLike> {
  const games = new Map<string, ActivityLike>();
  for (const activity of activities) {
    if (activity.type !== "playing" || !activity.name) continue;
    games.set(activity.name.toLowerCase(), activity);
  }
  return games;
}

/**
 * Apply the difference between two activity lists to the user's history.
 * Safe to call with identical lists (it does nothing).
 */
export async function recordGameTransitions(
  ctx: MutationCtx,
  userId: Id<"users">,
  previous: readonly ActivityLike[],
  next: readonly ActivityLike[]
): Promise<void> {
  const before = gamesOf(previous);
  const after = gamesOf(next);
  if (before.size === 0 && after.size === 0) return;

  const now = Date.now();
  let touched = false;

  // Newly started: open a session, creating the row if this is a first play.
  for (const [key, activity] of after) {
    if (before.has(key)) continue;
    const existing = await findRow(ctx, userId, key);
    // Trust a reported start time only if it's in the past and recent enough
    // to be this session rather than a stale value from a previous run.
    const startedAt =
      activity.startedAt && activity.startedAt <= now && now - activity.startedAt < MAX_SESSION_MS
        ? activity.startedAt
        : now;

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: activity.name,
        imageUrl: activity.imageUrl ?? existing.imageUrl,
        startedAt,
        lastPlayedAt: now,
      });
    } else {
      await ctx.db.insert("gameHistory", {
        userId,
        gameKey: key,
        name: activity.name,
        imageUrl: activity.imageUrl,
        startedAt,
        lastPlayedAt: now,
        totalMs: 0,
      });
    }
    touched = true;
  }

  // Stopped: bank the elapsed time and close the session.
  for (const [key] of before) {
    if (after.has(key)) continue;
    const existing = await findRow(ctx, userId, key);
    if (!existing) continue;
    const elapsed = existing.startedAt ? Math.min(now - existing.startedAt, MAX_SESSION_MS) : 0;
    await ctx.db.patch(existing._id, {
      totalMs: existing.totalMs + Math.max(0, elapsed),
      lastPlayedAt: now,
      startedAt: undefined,
    });
    touched = true;
  }

  if (touched) await prune(ctx, userId, now);
}

/**
 * Close any session left open for a user — used when a client goes offline
 * without reporting an empty activity list, so the row doesn't sit "running"
 * forever and report a wildly inflated total the next time it's touched.
 */
export async function closeOpenSessions(ctx: MutationCtx, userId: Id<"users">): Promise<void> {
  const rows = await ctx.db
    .query("gameHistory")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const now = Date.now();
  for (const row of rows) {
    if (row.startedAt === undefined) continue;
    const elapsed = Math.min(now - row.startedAt, MAX_SESSION_MS);
    await ctx.db.patch(row._id, {
      totalMs: row.totalMs + Math.max(0, elapsed),
      lastPlayedAt: now,
      startedAt: undefined,
    });
  }
}

function findRow(ctx: MutationCtx, userId: Id<"users">, gameKey: string) {
  return ctx.db
    .query("gameHistory")
    .withIndex("by_user_game", (q) => q.eq("userId", userId).eq("gameKey", gameKey))
    .unique();
}

/** Drop rows past the display window, then trim to the row cap. */
async function prune(ctx: MutationCtx, userId: Id<"users">, now: number): Promise<void> {
  const rows = await ctx.db
    .query("gameHistory")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  const cutoff = now - HISTORY_WINDOW_MS;
  const live: Doc<"gameHistory">[] = [];
  for (const row of rows) {
    // Never sweep a session that's still running, however long it's been.
    if (row.lastPlayedAt < cutoff && row.startedAt === undefined) {
      await ctx.db.delete(row._id);
    } else {
      live.push(row);
    }
  }

  if (live.length <= MAX_ROWS_PER_USER) return;
  live.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  for (const row of live.slice(MAX_ROWS_PER_USER)) {
    if (row.startedAt === undefined) await ctx.db.delete(row._id);
  }
}

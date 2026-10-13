/**
 * Ignoring and blocking people.
 *
 * Both are stored as *windows of time* in `userSuppressions` (see the table in
 * schema.ts for why). Everything that decides what someone may see or do about
 * another person reduces to two questions, and the pure functions at the top of
 * this file answer them without a database so the rules are testable:
 *
 *  - Is this message hidden from the viewer? Depends on when it was sent, since
 *    what arrives while someone is ignored stays hidden after the ignore ends.
 *  - Is the viewer suppressing this person right now? Decides whether a
 *    notification, a ring or a typing indicator is let through.
 *
 * The database helpers below them are thin readers over the same table.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// --- Windows -----------------------------------------------------------------

/** The part of a `userSuppressions` row that the rules depend on. */
export type Window = Pick<Doc<"userSuppressions">, "kind" | "startedAt" | "endsAt">;

/** Still in force at `now`. No end means "until lifted". */
export function isOpen(window: Window, now: number): boolean {
  return window.endsAt === undefined || window.endsAt > now;
}

/** Whether something that happened at `at` fell inside the window. */
export function covers(window: Window, at: number): boolean {
  return at >= window.startedAt && (window.endsAt === undefined || at < window.endsAt);
}

/** Whether a message sent at `sentAt` is hidden by any of these windows. */
export function isHiddenAt(windows: readonly Window[] | undefined, sentAt: number): boolean {
  return !!windows && windows.some((w) => covers(w, sentAt));
}

/** Whether any window is in force right now, optionally of one kind. */
export function hasOpen(
  windows: readonly Window[] | undefined,
  now: number,
  kind?: Window["kind"],
): boolean {
  return !!windows && windows.some((w) => isOpen(w, now) && (!kind || w.kind === kind));
}

/**
 * The expiry of the open ignore, `null` for one that never expires, or
 * `undefined` when nothing is being ignored.
 */
export function ignoredUntil(
  windows: readonly Window[] | undefined,
  now: number,
): number | null | undefined {
  const open = (windows ?? []).filter((w) => w.kind === "ignore" && isOpen(w, now));
  if (open.length === 0) return undefined;
  if (open.some((w) => w.endsAt === undefined)) return null;
  return Math.max(...open.map((w) => w.endsAt as number));
}

// --- Durations ---------------------------------------------------------------

const HOUR = 60 * 60_000;

/** What the picker offers. `forever` has no expiry and lasts until lifted. */
export const IGNORE_DURATIONS = {
  "1h": HOUR,
  "8h": 8 * HOUR,
  "24h": 24 * HOUR,
  "7d": 7 * 24 * HOUR,
  forever: null,
} as const;

export type IgnoreDuration = keyof typeof IGNORE_DURATIONS;

export const IGNORE_DURATION_KEYS = Object.keys(IGNORE_DURATIONS) as IgnoreDuration[];

/** When an ignore begun at `now` for `duration` ends; `undefined` for forever. */
export function endsAtFor(duration: IgnoreDuration, now: number): number | undefined {
  const ms = IGNORE_DURATIONS[duration];
  return ms === null ? undefined : now + ms;
}

// --- Reading the table -------------------------------------------------------

/** All of `userId`'s windows against one person. */
export async function windowsAgainst(
  ctx: QueryCtx,
  userId: Id<"users">,
  targetId: Id<"users">,
): Promise<Doc<"userSuppressions">[]> {
  return ctx.db
    .query("userSuppressions")
    .withIndex("by_user_target", (q) => q.eq("userId", userId).eq("targetId", targetId))
    .collect();
}

/**
 * Everything `userId` is ignoring or has blocked, keyed by who. The viewer's
 * side of a read: a list of messages is filtered through this once rather than
 * asking about each author.
 */
export async function windowsByTarget(
  ctx: QueryCtx,
  userId: Id<"users">,
): Promise<Map<Id<"users">, Doc<"userSuppressions">[]>> {
  const rows = await ctx.db
    .query("userSuppressions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const byTarget = new Map<Id<"users">, Doc<"userSuppressions">[]>();
  for (const row of rows) {
    const list = byTarget.get(row.targetId);
    if (list) list.push(row);
    else byTarget.set(row.targetId, [row]);
  }
  return byTarget;
}

/** Whether a message by `authorId` sent at `sentAt` is hidden from whoever
 * `byTarget` (from `windowsByTarget`) belongs to. */
export function isMessageHidden(
  byTarget: ReadonlyMap<Id<"users">, readonly Window[]>,
  authorId: Id<"users">,
  sentAt: number,
): boolean {
  return byTarget.size > 0 && isHiddenAt(byTarget.get(authorId), sentAt);
}

/** Whether `blockerId` currently has `targetId` blocked. */
export async function hasBlocked(
  ctx: QueryCtx,
  blockerId: Id<"users">,
  targetId: Id<"users">,
): Promise<boolean> {
  return hasOpen(await windowsAgainst(ctx, blockerId, targetId), Date.now(), "block");
}

/** Whether either of the two has blocked the other. */
export async function isBlockedEitherWay(
  ctx: QueryCtx,
  a: Id<"users">,
  b: Id<"users">,
): Promise<boolean> {
  return (await hasBlocked(ctx, a, b)) || (await hasBlocked(ctx, b, a));
}

/**
 * Whether `recipientId` should be spared anything `actorId` does to them right
 * now — a notification, a ring, a typing indicator. Ignoring and blocking both
 * count.
 */
export async function isSuppressing(
  ctx: QueryCtx,
  recipientId: Id<"users">,
  actorId: Id<"users">,
): Promise<boolean> {
  return hasOpen(await windowsAgainst(ctx, recipientId, actorId), Date.now());
}

/**
 * Refuse an interaction between two people when one has blocked the other.
 *
 * The wording depends on which side is asking: the person who blocked knows why
 * it failed and is told how to undo it; the person who was blocked is given a
 * deliberately vague reason, because telling them would amount to telling them
 * they were blocked.
 */
export async function requireNotBlocked(
  ctx: QueryCtx,
  me: Id<"users">,
  other: Id<"users">,
): Promise<void> {
  if (await hasBlocked(ctx, me, other)) {
    throw new Error("You've blocked this person. Unblock them first.");
  }
  if (await hasBlocked(ctx, other, me)) {
    throw new Error("You can't do that with this person.");
  }
}

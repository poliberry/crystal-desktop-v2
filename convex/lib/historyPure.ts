/**
 * Read Message History, as plain functions. A member without it starts at an "anchor" — the moment
 * they last opened the channel — and sees nothing sent before. The database half is in `history.ts`.
 */

export type HistoryFloor =
  /** Holds Read Message History (or is the owner / an administrator): sees everything. */
  | { restricted: false }
  /** Sees only what was sent after `after`. `Infinity` when they have never opened the channel. */
  | { restricted: true; after: number };

export const UNRESTRICTED: HistoryFloor = { restricted: false };

export function historyFloor(canReadHistory: boolean, anchorAt: number | undefined): HistoryFloor {
  if (canReadHistory) return UNRESTRICTED;
  return { restricted: true, after: anchorAt ?? Number.POSITIVE_INFINITY };
}

/** Whether something created at `createdAt` is within what this member may read. */
export function withinHistory(floor: HistoryFloor, createdAt: number): boolean {
  return !floor.restricted || createdAt > floor.after;
}

/** Keep only what is within the floor. */
export function filterByHistory<T>(floor: HistoryFloor, rows: T[], createdAt: (row: T) => number): T[] {
  return floor.restricted ? rows.filter((row) => withinHistory(floor, createdAt(row))) : rows;
}

/**
 * A visit within this long of the last one carries on from the same anchor, so flicking between
 * tabs (or a view that mounts twice) doesn't make everything just read vanish.
 */
export const ANCHOR_GRACE_MS = 60 * 1000;

/** Where a member's history starts after they open the channel at `now`. */
export function anchorOnOpen(existing: number | undefined, now: number): number {
  return existing !== undefined && existing <= now && now - existing < ANCHOR_GRACE_MS ? existing : now;
}

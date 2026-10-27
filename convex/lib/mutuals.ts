/**
 * What two people have in common — the friends and the servers both are in.
 *
 * Kept as plain functions over ids so the one rule that matters (which side's
 * order the result keeps, and what "too many" does) is testable without a
 * database.
 */

/** Rows read per side. Anyone with more than this many friends or servers still
 * gets an answer — the count just stops being exact, and says so (see the
 * `truncated` flag the query returns). */
export const MUTUALS_SCAN_LIMIT = 1000;

/** How many of each are sent to the client. The profile lists them in a scroll
 * box, and the count above it is what carries the real number. */
export const MUTUALS_SHOWN = 60;

/**
 * The ids in both lists, in the order of `ordered`.
 *
 * `ordered` is the *viewer's* list so the mutuals come out in the way they are
 * used to seeing their own (most recent friend first, say) rather than in an
 * order that is meaningful only to the person being looked at.
 */
export function intersectIds<T extends string>(
  ordered: readonly T[],
  other: readonly T[],
): T[] {
  const there = new Set<T>(other);
  const seen = new Set<T>();
  const out: T[] = [];
  for (const id of ordered) {
    if (!there.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

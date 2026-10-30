/**
 * Whether two plain-data values (what comes back from Convex or JSON: primitives, arrays, objects) hold the same thing.
 *
 * For `memo` comparators on rows fed from a live query: Convex hands back fresh objects whenever a result changes, even
 * for the messages that didn't, so reference equality never holds and every row renders again. Comparing the data
 * instead keeps a row still when nothing it shows has changed, and, unlike a hand-picked list of fields, it covers
 * fields added later without anyone remembering to extend it. Not for class instances, Maps or cycles.
 */
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (aIsArray) {
    const x = a as unknown[];
    const y = b as unknown[];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!sameData(x[i], y[i])) return false;
    return true;
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(y, key) || !sameData(x[key], y[key])) return false;
  }
  return true;
}

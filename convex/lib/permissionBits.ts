/**
 * Arithmetic on permission sets that are wider than JavaScript's bitwise operators.
 *
 * A permission set is one non-negative number. The first thirty-one flags (bits 0–30) are the
 * ones the app has always had, and plain `&` / `|` on them keeps working exactly as before — `&`
 * looks only at the low 32 bits of a number, so a set that also carries higher flags still answers
 * the old questions correctly. Flags above bit 31 can't go through `&` at all (`1 << 32` is `1`),
 * so they are written `2 ** n` and every question about a set that might hold one goes through
 * the helpers here. Numbers are exact up to 2^53, which is why the widest flag is bit 52.
 *
 * The community owner's set is `-1` (all ones), as it always was; the helpers treat a negative
 * set as every bit.
 *
 * Bit 31 is skipped on purpose: it is the sign bit of a 32-bit integer, and a flag there would
 * turn negative the first time something `|`ed it.
 */

const TWO_32 = 4294967296;
/** Every flag there can be: bits 0–52. */
export const ALL_PERMISSION_BITS = 2 ** 53 - 1;

function parts(set: number): [lo: number, hi: number] {
  const n = set < 0 ? ALL_PERMISSION_BITS : set;
  return [n >>> 0, Math.floor(n / TWO_32)];
}

function join(lo: number, hi: number): number {
  return (hi >>> 0) * TWO_32 + (lo >>> 0);
}

/** Whether `set` holds *any* of the bits in `flag` — `(set & flag) !== 0`, for flags of any width. */
export function bitsHas(set: number, flag: number): boolean {
  const [sl, sh] = parts(set);
  const [fl, fh] = parts(flag);
  return (sl & fl) !== 0 || (sh & fh) !== 0;
}

/** `a | b`. */
export function bitsOr(a: number, b: number): number {
  const [al, ah] = parts(a);
  const [bl, bh] = parts(b);
  return join(al | bl, ah | bh);
}

/** `a & b`. */
export function bitsAnd(a: number, b: number): number {
  const [al, ah] = parts(a);
  const [bl, bh] = parts(b);
  return join(al & bl, ah & bh);
}

/** `a & ~b` — `a` with every bit of `b` taken away. */
export function bitsWithout(a: number, b: number): number {
  const [al, ah] = parts(a);
  const [bl, bh] = parts(b);
  return join(al & ~bl, ah & ~bh);
}

/** Whether a stored value is something a permission set can be: a whole number from 0 to 2^53 − 1. */
export function isValidBits(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= ALL_PERMISSION_BITS;
}

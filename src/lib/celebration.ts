/**
 * The bits of confetti-scattering shared by everything that celebrates.
 *
 * Two things use them — the birthday gift overlay and the cake rain a
 * birthday wish sets off — and both need the *same* jumble every render for
 * the same reason: `Math.random()` would lay the pieces out differently on the
 * server render than on the client one and trip hydration.
 */

export const CONFETTI_COLOURS = [
  "oklch(0.78 0.19 25)",
  "oklch(0.85 0.17 92)",
  "oklch(0.82 0.17 150)",
  "oklch(0.72 0.16 240)",
  "oklch(0.75 0.2 330)",
];

/**
 * Deterministic per-index scatter, in `[0, 1)`.
 *
 * A hash of the index gives the same jumble every time while still looking
 * unplanned. `salt` separates one axis from another — the same index has to
 * produce an unrelated number for "how far across" and "how fast".
 */
export function scatter(index: number, salt: number): number {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

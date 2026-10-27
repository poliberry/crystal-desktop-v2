/**
 * Where the cards on a server's overview sit.
 *
 * A twelve-column grid with rows of a fixed height: a card is a rectangle of
 * cells, and the overview page and the pinboard that arranges it read the same
 * numbers. The page lays them out as CSS grid placement, the pinboard as
 * absolutely positioned boxes, and the two agree because both measure the same
 * way — a card `w` columns wide is `w` column pitches less one gap.
 */

export const COLS = 12;
/** One row, including the gap under it. */
export const ROW_H = 48;
export const GAP = 12;
export const MIN_W = 3;
export const MIN_H = 2;

export interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PlacedCell = Cell & { id: string };

/** What a card is when nobody has sized it: wide enough to read, tall enough
 * for what its kind usually holds. */
const COMPACT_SIZES: Record<string, { w: number; h: number }> = {
  note: { w: 4, h: 4 },
  countdown: { w: 4, h: 4 },
  calendar: { w: 5, h: 8 },
  poll: { w: 5, h: 6 },
};

export function defaultSize(kind: string, width?: string): { w: number; h: number } {
  if (COMPACT_SIZES[kind]) return COMPACT_SIZES[kind];
  const w = width === "full" ? COLS : COLS / 2;
  const h =
    kind === "recentMessages" ? 6 : kind === "rules" ? 6 : kind === "banner" ? 4 : 5;
  return { w, h };
}

export function collides(a: Cell, b: Cell): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** The first spot, reading left to right and top to bottom, a card fits. */
export function firstFree(placed: Cell[], w: number, h: number): { x: number; y: number } {
  for (let y = 0; ; y++) {
    for (let x = 0; x + w <= COLS; x++) {
      if (!placed.some((p) => collides({ x, y, w, h }, p))) return { x, y };
    }
  }
}

/** The bottom of everything placed — where a new card goes. */
export function bottomOf(placed: Cell[]): number {
  return placed.reduce((max, p) => Math.max(max, p.y + p.h), 0);
}

/**
 * Every card's cell: the one it was given, or — for cards from before there was
 * a board, or new ones — the first free spot for its default size, in the order
 * the cards were given.
 */
export function fillLayouts<T extends { id: string; layout?: Cell; width?: string; kind?: string }>(
  items: T[],
  kindOf: (item: T) => string = (item) => item.kind ?? "markdown",
): PlacedCell[] {
  const placed: PlacedCell[] = items
    .filter((item) => item.layout)
    .map((item) => ({ id: item.id, ...item.layout! }));
  const result = new Map(placed.map((cell) => [cell.id, cell]));
  for (const item of items) {
    if (result.has(item.id)) continue;
    const size = defaultSize(kindOf(item), item.width);
    const spot = firstFree([...result.values()], size.w, size.h);
    result.set(item.id, { id: item.id, ...spot, ...size });
  }
  // In the order they came.
  return items.map((item) => result.get(item.id)!);
}

/**
 * Settles a set of cards after one of them has been moved or resized.
 *
 * `priorityId` is the card being dragged: it keeps exactly the cell it was
 * dropped on, and everything else is placed around it — each card, top to
 * bottom, sliding up as far as it can go without landing on one already
 * placed. So a card dropped onto another pushes it down, and one lifted out of
 * a column lets the ones below close up behind it.
 */
export function resolve(cells: PlacedCell[], priorityId?: string): PlacedCell[] {
  const clamp = (cell: PlacedCell): PlacedCell => {
    const w = Math.min(COLS, Math.max(1, cell.w));
    return {
      ...cell,
      w,
      h: Math.max(1, cell.h),
      x: Math.min(COLS - w, Math.max(0, cell.x)),
      y: Math.max(0, cell.y),
    };
  };

  const placed: PlacedCell[] = [];
  const priority = cells.find((c) => c.id === priorityId);
  if (priority) placed.push(clamp(priority));

  const rest = cells
    .filter((c) => c.id !== priorityId)
    .map(clamp)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  for (const cell of rest) {
    let y = 0;
    while (placed.some((p) => collides({ ...cell, y }, p))) y++;
    placed.push({ ...cell, y });
  }

  const byId = new Map(placed.map((c) => [c.id, c]));
  return cells.map((c) => byId.get(c.id)!);
}

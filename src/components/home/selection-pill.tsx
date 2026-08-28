import { cn } from "@/lib/utils";

/**
 * What the pill is saying about the item it sits beside.
 *
 * - `idle` — nothing waiting, not open. Nothing to show, but the pill still
 *   renders so hover has something to grow.
 * - `unread` — a stub, the width of the bar and twice as tall: read as a
 *   semicircle poking out of the edge rather than as a bar of its own.
 * - `active` — this is what you're looking at, so the pill runs the full
 *   height of the tile or row.
 */
export type PillState = "idle" | "unread" | "active";

/**
 * The left-edge indicator for a rail tile or a DM row.
 *
 * One element does unread, hover and selection because they're one gesture in
 * sequence: a stub grows when you point at it and runs the full height once
 * you open it. Animating a single pill's height keeps that continuity, which
 * separate dot-and-bar elements can't — they'd have to cross-fade.
 *
 * Sits at the container's left edge, so the parent needs `relative` and
 * `group` (for the hover step). Decorative only — the label on the button
 * carries the unread count for screen readers, and the pill is not the click
 * target: clicking the tile is what promotes it to `active`.
 */
export function SelectionPill({
  state,
  className,
}: {
  state: PillState;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r-full bg-foreground",
        "transition-[height,opacity] duration-200 ease-out",
        // Hover only previews selection while you aren't already there —
        // an open item's pill is at full height and has nowhere to grow.
        state !== "active" && "group-hover:h-5 group-hover:opacity-100",
        state === "idle" && "h-0 opacity-0",
        state === "unread" && "h-2 opacity-100",
        state === "active" && "h-full opacity-100",
        className
      )}
    />
  );
}

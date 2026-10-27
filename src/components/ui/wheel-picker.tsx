"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { cn } from "@/lib/utils";

const DEFAULT_ROW_HEIGHT = 32;
const DEFAULT_VISIBLE_ROWS = 5;

/** How long the wheel has to sit still before where it stopped counts as a
 * choice. Short enough to feel immediate, long enough that flicking past ten
 * rows doesn't change the setting ten times. */
const SETTLE_MS = 140;

export type WheelItem = {
  value: string;
  label: string;
  /** Something before the label — a swatch, an icon. */
  leading?: React.ReactNode;
};

/**
 * One scrolling list in the style of the iOS date picker: rows snap to a
 * highlighted band in the middle, and the ones further from it shrink, tilt
 * away and fade. Whatever is in the band when the scrolling stops is the
 * selection.
 *
 * Painting the tilt per row on every scroll event through React state would
 * re-render the list sixty times a second, so the rows are styled directly.
 */
export function WheelPicker({
  label,
  items,
  value,
  onChange,
  rowHeight = DEFAULT_ROW_HEIGHT,
  visibleRows = DEFAULT_VISIBLE_ROWS,
  className,
}: {
  label: string;
  items: WheelItem[];
  value: string;
  onChange: (value: string) => void;
  rowHeight?: number;
  /** How many rows are in view at once; odd, so one is in the middle. */
  visibleRows?: number;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  const selected = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );
  /** Space above and below the list so the first and last rows can reach the
   * middle, where the selection is. */
  const padding = (rowHeight * (visibleRows - 1)) / 2;

  const paint = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const centre = el.scrollTop / rowHeight;
    rows.current.forEach((row, index) => {
      if (!row) return;
      const offset = index - centre;
      const distance = Math.min(Math.abs(offset), 2.5);
      const tilt = Math.max(-55, Math.min(55, -offset * 24));
      row.style.opacity = String(1 - distance * 0.32);
      row.style.transform = `rotateX(${tilt}deg) scale(${1 - distance * 0.05})`;
    });
  }, [rowHeight]);

  // Put the wheel on the current value — on first paint, and again if it
  // changes from somewhere else. Scrolling to where it already is does
  // nothing, so this doesn't fight the user's own scrolling settling on a row.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const top = selected * rowHeight;
    if (Math.abs(el.scrollTop - top) > 1) el.scrollTo({ top });
    paint();
  }, [selected, items.length, rowHeight, paint]);

  useEffect(() => () => clearTimeout(settle.current), []);

  const onScroll = () => {
    paint();
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const el = scroller.current;
      if (!el) return;
      const index = Math.max(
        0,
        Math.min(items.length - 1, Math.round(el.scrollTop / rowHeight)),
      );
      const item = items[index];
      if (item && item.value !== value) onChange(item.value);
    }, SETTLE_MS);
  };

  return (
    <div
      className={cn("relative min-w-0 flex-1", className)}
      style={{ height: rowHeight * visibleRows }}
    >
      {/* The selection band, behind the rows so the text isn't dimmed by it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-lg bg-foreground/10"
        style={{ height: rowHeight }}
      />
      <div
        ref={scroller}
        role="listbox"
        aria-label={label}
        onScroll={onScroll}
        className="relative h-full snap-y snap-mandatory overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_28%,black_72%,transparent)] [perspective:420px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ paddingBlock: padding }}
      >
        {items.map((item, index) => (
          <button
            key={item.value}
            ref={(node) => {
              rows.current[index] = node;
            }}
            type="button"
            role="option"
            aria-selected={index === selected}
            title={item.label}
            onClick={() =>
              scroller.current?.scrollTo({ top: index * rowHeight, behavior: "smooth" })
            }
            className="flex w-full snap-center items-center justify-center gap-2 px-2 text-sm font-medium"
            style={{ height: rowHeight }}
          >
            {item.leading}
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

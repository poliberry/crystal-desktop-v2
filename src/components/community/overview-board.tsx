"use client";

import {
  BarChart3,
  CalendarDays,
  FileText,
  Hash,
  Image as ImageIcon,
  ListOrdered,
  MessageSquare,
  StickyNote,
  Timer,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  COLS,
  GAP,
  MIN_H,
  MIN_W,
  ROW_H,
  type PlacedCell,
  fillLayouts,
  resolve,
} from "@/lib/overview-layout";
import { cn } from "@/lib/utils";

/** What the board needs of a card: the stored row, as the editor gets it. */
export interface BoardRow {
  id: string;
  title?: string;
  width: string;
  layout?: { x: number; y: number; w: number; h: number };
  config: Record<string, unknown> & { kind: string };
}

const KIND_ICON: Record<string, typeof Hash> = {
  channels: Hash,
  recentMessages: MessageSquare,
  markdown: FileText,
  rules: ListOrdered,
  banner: ImageIcon,
  note: StickyNote,
  countdown: Timer,
  calendar: CalendarDays,
  poll: BarChart3,
};

const KIND_LABEL: Record<string, string> = {
  channels: "Recommended channels",
  recentMessages: "Recent messages",
  markdown: "Text",
  rules: "Rules",
  banner: "Banner",
  note: "Note from the owner",
  countdown: "Countdown",
  calendar: "Calendar",
  poll: "Poll",
};

/** What a card looks like on the board: enough of its content to tell which
 * is which, not a second implementation of the card itself. */
function CardPreview({
  row,
  channelNames,
}: {
  row: BoardRow;
  channelNames: Map<string, string>;
}) {
  const config = row.config;
  switch (config.kind) {
    case "channels": {
      const ids = (config.channelIds as string[]) ?? [];
      return (
        <div className="space-y-0.5">
          {ids.slice(0, 6).map((id) => (
            <p key={id} className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <Hash className="size-3 shrink-0" />
              {channelNames.get(id) ?? "unknown"}
            </p>
          ))}
          {ids.length === 0 && <p className="text-xs text-muted-foreground">No channels picked.</p>}
        </div>
      );
    }
    case "recentMessages":
      return (
        <p className="text-xs text-muted-foreground">
          Latest in #{channelNames.get(config.channelId as string) ?? "…"}
        </p>
      );
    case "markdown":
      return (
        <p className="line-clamp-6 text-xs whitespace-pre-line text-muted-foreground">
          {(config.body as string) || "Empty."}
        </p>
      );
    case "rules": {
      const rules = (config.rules as { title: string }[]) ?? [];
      return (
        <ol className="space-y-0.5">
          {rules.slice(0, 6).map((rule, index) => (
            <li key={index} className="truncate text-xs text-muted-foreground">
              {index + 1}. {rule.title}
            </li>
          ))}
          {rules.length === 0 && <p className="text-xs text-muted-foreground">No rules yet.</p>}
        </ol>
      );
    }
    case "note":
      return (
        <p className="line-clamp-5 text-xs whitespace-pre-line text-muted-foreground">
          {(config.body as string) || "Empty."}
        </p>
      );
    case "countdown":
      return (
        <p className="text-xs text-muted-foreground">
          {new Date(config.target as number).toLocaleString()}
        </p>
      );
    case "calendar": {
      const events = (config.events as { date: string; title: string }[]) ?? [];
      return (
        <ul className="space-y-0.5">
          {events.slice(0, 5).map((event, index) => (
            <li key={index} className="truncate text-xs text-muted-foreground">
              {event.date} · {event.title}
            </li>
          ))}
          {events.length === 0 && <p className="text-xs text-muted-foreground">No events yet.</p>}
        </ul>
      );
    }
    case "poll": {
      const options = (config.options as string[]) ?? [];
      return (
        <div className="space-y-1">
          <p className="truncate text-xs font-medium">{(config.question as string) || "…"}</p>
          {options.slice(0, 4).map((option, index) => (
            <p
              key={index}
              className="truncate rounded border border-border/50 px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {option}
            </p>
          ))}
        </div>
      );
    }
    case "banner":
      return (
        <div>
          <p className="truncate text-sm font-semibold">{(config.heading as string) || ""}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {(config.subheading as string) || ""}
          </p>
        </div>
      );
    default:
      return null;
  }
}

type Interaction = {
  id: string;
  mode: "move" | "resize";
  /** Pointer position when it started. */
  startX: number;
  startY: number;
  /** The cards as they were when it started, which every step is worked out
   * from — not from the previous step, so a drag can't drift. */
  origin: PlacedCell[];
  /** How far the pointer has gone, in pixels. */
  dx: number;
  dy: number;
};

/**
 * The pinboard: the overview's cards as boxes on a twelve-column board, to be
 * dragged by the body and resized from the corner.
 *
 * Positions are in grid cells and snap as you go; the card you are dragging
 * follows the pointer exactly, with a dashed outline marking the cell it will
 * land in, and the others slide out of its way. What is saved is the layout on
 * release, in one write.
 */
export function OverviewBoard({
  rows,
  channelNames,
  selectedId,
  dirtyIds,
  onSelect,
  onDelete,
  onLayout,
}: {
  rows: BoardRow[];
  channelNames: Map<string, string>;
  /** Cards with edits that haven't been saved. */
  dirtyIds?: Set<string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  onLayout: (cells: PlacedCell[]) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [interaction, setInteraction] = useState<Interaction | null>(null);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  const saved = useMemo(
    () =>
      resolve(
        fillLayouts(
          rows.map((row) => ({
            id: row.id,
            layout: row.layout,
            width: row.width,
            kind: row.config.kind,
          })),
        ),
      ),
    [rows],
  );

  // What is drawn: the saved layout, or while a card is held, what it would
  // become if let go now.
  const [cells, setCells] = useState<PlacedCell[]>(saved);
  useEffect(() => {
    if (!interaction) setCells(saved);
    // `interaction` is deliberately not a dependency: the saved layout arriving
    // mid-drag must not snap the card out of the user's hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const pitch = width > 0 ? (width + GAP) / COLS : 0;
  const rect = (cell: PlacedCell) => ({
    left: cell.x * pitch,
    top: cell.y * ROW_H,
    width: Math.max(0, cell.w * pitch - GAP),
    height: cell.h * ROW_H - GAP,
  });

  const rowsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const bottom = cells.reduce((max, c) => Math.max(max, c.y + c.h), 0);

  const begin = (event: React.PointerEvent, id: string, mode: "move" | "resize") => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(id);
    setInteraction({
      id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: cells,
      dx: 0,
      dy: 0,
    });
  };

  const track = (event: React.PointerEvent) => {
    if (!interaction || pitch === 0) return;
    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;
    const dCol = Math.round(dx / pitch);
    const dRow = Math.round(dy / ROW_H);
    const next = interaction.origin.map((cell) => {
      if (cell.id !== interaction.id) return cell;
      if (interaction.mode === "move") {
        return {
          ...cell,
          x: Math.min(COLS - cell.w, Math.max(0, cell.x + dCol)),
          y: Math.max(0, cell.y + dRow),
        };
      }
      return {
        ...cell,
        w: Math.min(COLS - cell.x, Math.max(MIN_W, cell.w + dCol)),
        h: Math.max(MIN_H, cell.h + dRow),
      };
    });
    setCells(resolve(next, interaction.id));
    setInteraction({ ...interaction, dx, dy });
  };

  const finish = (event: React.PointerEvent) => {
    if (!interaction) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const moved = interaction.dx !== 0 || interaction.dy !== 0;
    setInteraction(null);
    if (moved) onLayout(cells);
  };

  const held = interaction ? cells.find((c) => c.id === interaction.id) : undefined;

  return (
    <div
      ref={boardRef}
      className="relative w-full"
      style={{
        height: Math.max(520, (bottom + 3) * ROW_H),
        backgroundImage:
          pitch > 0
            ? "radial-gradient(circle, color-mix(in oklab, var(--foreground) 22%, transparent) 1px, transparent 1.5px)"
            : undefined,
        backgroundSize: pitch > 0 ? `${pitch}px ${ROW_H}px` : undefined,
        backgroundPosition: `-${GAP / 2}px -${GAP / 2}px`,
      }}
      onPointerDown={() => onSelect(null)}
    >
      {pitch > 0 &&
        cells.map((cell) => {
          const row = rowsById.get(cell.id);
          if (!row) return null;
          const Icon = KIND_ICON[row.config.kind] ?? FileText;
          const isHeld = interaction?.id === cell.id;
          const box = rect(cell);
          // A card being moved goes where the pointer is; everything else, and
          // a card being resized, goes where the grid says.
          const style =
            isHeld && interaction.mode === "move"
              ? (() => {
                  const origin = interaction.origin.find((c) => c.id === cell.id)!;
                  const start = rect(origin);
                  return {
                    ...box,
                    left: start.left + interaction.dx,
                    top: start.top + interaction.dy,
                  };
                })()
              : box;
          const selected = selectedId === cell.id;

          return (
            <div
              key={cell.id}
              onPointerDown={(event) => begin(event, cell.id, "move")}
              onPointerMove={isHeld ? track : undefined}
              onPointerUp={isHeld ? finish : undefined}
              onPointerCancel={isHeld ? finish : undefined}
              className={cn(
                "group absolute flex cursor-grab touch-none flex-col overflow-hidden rounded-xl border bg-card/80 shadow-md backdrop-blur-sm select-none",
                selected ? "border-primary ring-2 ring-primary/40" : "border-border/60 hover:border-border",
                isHeld
                  ? "z-20 cursor-grabbing shadow-xl"
                  : "transition-[left,top,width,height] duration-200 ease-out",
              )}
              style={style}
            >
              {/* The pin. */}
              <span
                aria-hidden
                className="absolute top-1.5 left-1/2 size-2 -translate-x-1/2 rounded-full bg-primary shadow-[0_1px_2px_rgb(0_0_0/0.4)]"
              />
              <header className="flex shrink-0 items-center gap-1.5 border-b border-border/40 px-3 pt-4 pb-1.5">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <p className="min-w-0 flex-1 truncate text-xs font-semibold">
                  {row.title || KIND_LABEL[row.config.kind] || "Card"}
                </p>
                {dirtyIds?.has(cell.id) && (
                  <span
                    role="img"
                    aria-label="Unsaved changes"
                    title="Unsaved changes"
                    className="size-2 shrink-0 rounded-full bg-amber-400"
                  />
                )}
                <button
                  type="button"
                  aria-label="Delete card"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => onDelete(cell.id)}
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-hidden p-3">
                <CardPreview row={row} channelNames={channelNames} />
              </div>

              {/* Resize, from the corner. */}
              <span
                role="separator"
                aria-label="Resize card"
                onPointerDown={(event) => begin(event, cell.id, "resize")}
                // Stopped here: the events would otherwise bubble to the card,
                // which would finish the same gesture a second time and save
                // the layout twice.
                onPointerMove={
                  isHeld
                    ? (event) => {
                        event.stopPropagation();
                        track(event);
                      }
                    : undefined
                }
                onPointerUp={
                  isHeld
                    ? (event) => {
                        event.stopPropagation();
                        finish(event);
                      }
                    : undefined
                }
                onPointerCancel={
                  isHeld
                    ? (event) => {
                        event.stopPropagation();
                        finish(event);
                      }
                    : undefined
                }
                className="absolute right-0 bottom-0 size-5 cursor-nwse-resize"
              >
                <span className="absolute right-1 bottom-1 size-2.5 rounded-br-sm border-r-2 border-b-2 border-muted-foreground/60" />
              </span>
            </div>
          );
        })}

      {/* Where the card being moved will land. */}
      {interaction?.mode === "move" && held && pitch > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-xl border-2 border-dashed border-primary/60 bg-primary/10 transition-[left,top] duration-100"
          style={rect(held)}
        />
      )}
    </div>
  );
}

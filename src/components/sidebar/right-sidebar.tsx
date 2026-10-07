"use client";

import { AnimatePresence, motion } from "framer-motion";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { useStoredWidth, WidthHandle } from "@/components/sidebar/resizable-sidebar";
import { cn } from "@/lib/utils";

/**
 * The right-hand counterpart of the unified sidebar: the same floating card —
 * `sidebar` surface, hairline `sidebar-border`, rounded, small shadow, 8px of
 * air around it — and, like the left one, a full-height column of the window.
 * The top bar and the content sit between the two, so opening or resizing this
 * one narrows the bar as well.
 *
 * Not a second shadcn `<Sidebar side="right">`: that component is
 * `position: fixed` and sized from the provider's one `--sidebar-width`, so it
 * would fight the left one for the variable. This one is a flex column beside
 * the content and brings its own width.
 *
 * What it shows belongs to the view in front — a channel's members, a group
 * DM's — so, like a page's menu in the left sidebar, the view renders it
 * through {@link RightSidebarContent} and it is portalled into the host here.
 * The view keeps its state; the host owns the frame, the width and whether it
 * is open.
 */

const SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };
/** The air on either side of the card. */
const GUTTER = 16;

interface RightSidebarContextValue {
  open: boolean;
  toggle: () => void;
  /** Whether the view in front has anything to put in it. */
  available: boolean;
  /** Called by a view while it has content; returns the release. */
  claim: () => () => void;
  slot: HTMLElement | null;
  setSlot: (element: HTMLElement | null) => void;
}

const RightSidebarContext = createContext<RightSidebarContextValue | null>(null);

export function RightSidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  const [claims, setClaims] = useState(0);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  const toggle = useCallback(() => setOpen((value) => !value), []);
  const claim = useCallback(() => {
    setClaims((count) => count + 1);
    return () => setClaims((count) => count - 1);
  }, []);

  const value = useMemo(
    () => ({ open, toggle, available: claims > 0, claim, slot, setSlot }),
    [open, toggle, claims, claim, slot],
  );
  return <RightSidebarContext.Provider value={value}>{children}</RightSidebarContext.Provider>;
}

/** Whether the right sidebar is open, and how to open or close it — for the
 * button in a view's header. Always closed outside the provider (the pop-out
 * window has none). */
export function useRightSidebar(): { open: boolean; toggle: () => void } {
  const ctx = useContext(RightSidebarContext);
  return useMemo(
    () => ({ open: ctx?.open ?? false, toggle: ctx?.toggle ?? (() => {}) }),
    [ctx?.open, ctx?.toggle],
  );
}

/**
 * A view's end of it: what is inside appears in the right sidebar for as long
 * as the view is mounted and the sidebar is open. While it is mounted the
 * sidebar exists at all, so its toggle has something to open.
 */
export function RightSidebarContent({ children }: { children: React.ReactNode }) {
  const ctx = useContext(RightSidebarContext);
  const claim = ctx?.claim;
  useEffect(() => claim?.(), [claim]);

  if (!ctx?.slot) return null;
  return createPortal(children, ctx.slot);
}

/** The window's end of it: the column, between the content and the right edge. */
export function RightSidebarHost() {
  const ctx = useContext(RightSidebarContext);
  const controls = useStoredWidth({
    storageKey: "crystal:right-sidebar-width",
    defaultWidth: 288,
    min: 240,
    max: 480,
    maxFraction: 0.4,
  });
  const [dragging, setDragging] = useState(false);
  if (!ctx) return null;

  return (
    <AnimatePresence initial={false}>
      {ctx.available && ctx.open && (
        <motion.aside
          key="right-sidebar"
          aria-label="Details"
          data-slot="right-sidebar"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: controls.width + GUTTER, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          // Straight to the pointer while it is being dragged; the spring is
          // for opening and closing.
          transition={dragging ? { duration: 0 } : SPRING}
          className="flex h-full shrink-0 overflow-hidden py-2"
        >
          <div
            className={cn(
              "relative mx-2 flex h-full min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm",
            )}
            style={{ width: controls.width }}
          >
            <WidthHandle
              controls={controls}
              grows="left"
              label="Resize right sidebar"
              onDraggingChange={setDragging}
            />
            {/* Filled by the view — see `RightSidebarContent`. */}
            <div ref={ctx.setSlot} className="flex min-h-0 flex-1 flex-col" />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

/** The card's title row: what the list is, and how many are in it. */
export function RightSidebarHeader({
  title,
  count,
}: {
  title: string;
  count?: number;
}) {
  return (
    <div className="flex shrink-0 items-baseline gap-1.5 px-4 pt-3 pb-1">
      <h2 className="text-sm font-semibold">{title}</h2>
      {count !== undefined && (
        <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
      )}
    </div>
  );
}

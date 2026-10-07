"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { SidebarProvider } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/**
 * Widths the user sets, for both sidebars.
 *
 * The left one's is the `--sidebar-width` the shadcn sidebar already reads for
 * its frame, its gap and its slide-out offset, so nothing else needed to learn
 * about it. The right one is laid out by `RightSidebarHost` and takes its width
 * directly. Both own the number the same way — remembered, clamped to the
 * window — and both are changed by the same grip.
 */

const KEY_STEP = 16;

export interface StoredWidth {
  width: number;
  setWidth: (width: number) => void;
  /** Writes the width down; called when a drag or key press is finished. */
  commit: () => void;
  reset: () => void;
  min: number;
  max: number;
}

interface StoredWidthOptions {
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
  /** The most of the window the sidebar may take, so the content can't be
   * squeezed out by it. */
  maxFraction: number;
}

/** A width that is remembered between launches and kept inside its bounds. */
export function useStoredWidth({
  storageKey,
  defaultWidth,
  min,
  max,
  maxFraction,
}: StoredWidthOptions): StoredWidth {
  const clamp = useCallback(
    (width: number) => {
      const ceiling = Math.max(min, Math.min(max, window.innerWidth * maxFraction));
      return Math.round(Math.min(ceiling, Math.max(min, width)));
    },
    [min, max, maxFraction],
  );

  const [width, setWidthState] = useState(() => {
    if (typeof window === "undefined") return defaultWidth;
    const stored = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored > 0 ? clamp(stored) : defaultWidth;
  });
  const latest = useRef(width);

  const setWidth = useCallback(
    (next: number) => {
      const clamped = clamp(next);
      latest.current = clamped;
      setWidthState(clamped);
    },
    [clamp],
  );
  const commit = useCallback(() => {
    try {
      window.localStorage.setItem(storageKey, String(latest.current));
    } catch {
      /* the width is a preference, not something worth failing over */
    }
  }, [storageKey]);
  const reset = useCallback(() => {
    latest.current = defaultWidth;
    setWidthState(defaultWidth);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* as above */
    }
  }, [defaultWidth, storageKey]);

  // A window that has become narrower than the saved width would otherwise
  // leave the sidebar taking most of it.
  useEffect(() => {
    const onResize = () => setWidthState((current) => clamp(current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  return useMemo(
    () => ({ width, setWidth, commit, reset, min, max }),
    [width, setWidth, commit, reset, min, max],
  );
}

/**
 * The grip on a sidebar's inner edge. Drag to resize, double-click to go back
 * to the default width, arrow keys to nudge it.
 *
 * `grows` is the way dragging makes the sidebar wider: right for a grip on the
 * left sidebar's right edge, left for one on the right sidebar's left edge.
 */
export function WidthHandle({
  controls,
  grows,
  label,
  onDraggingChange,
}: {
  controls: StoredWidth;
  grows: "left" | "right";
  label: string;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const { width, setWidth, commit, reset, min, max } = controls;
  const sign = grows === "right" ? 1 : -1;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      // `no-drag`: the top bar is a window-drag region, and anything near it
      // would start dragging the window instead.
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      className={cn(
        "group/resize absolute inset-y-0 z-30 w-2 cursor-col-resize touch-none outline-none",
        grows === "right" ? "right-0" : "left-0",
      )}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, width };
        onDraggingChange(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        setWidth(start.current.width + sign * (event.clientX - start.current.x));
      }}
      onPointerUp={(event) => {
        if (!start.current) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        start.current = null;
        onDraggingChange(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        commit();
      }}
      onDoubleClick={reset}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const toward = event.key === "ArrowRight" ? 1 : -1;
        setWidth(width + sign * toward * KEY_STEP);
        commit();
      }}
    >
      {/* The line you can see, thin until pointed at or focused. */}
      <div className="mx-auto h-full w-0.5 rounded-full bg-transparent transition-colors group-hover/resize:bg-white/25 group-focus-visible/resize:bg-white/40 group-active/resize:bg-white/40" />
    </div>
  );
}

// --- The left sidebar --------------------------------------------------------

/** 21rem: wide enough for the Priority card, the community previews and the
 * user card's controls, which is what the sidebar was fixed at. */
const LEFT_DEFAULT = 336;

interface LeftResize {
  controls: StoredWidth;
  setDragging: (dragging: boolean) => void;
}

const LeftResizeContext = createContext<LeftResize | null>(null);

/** The app's `SidebarProvider`, with a width that can be changed. */
export function ResizableSidebarProvider({
  className,
  style,
  children,
  ...props
}: React.ComponentProps<typeof SidebarProvider>) {
  const controls = useStoredWidth({
    storageKey: "crystal:sidebar-width",
    defaultWidth: LEFT_DEFAULT,
    min: 288,
    max: 560,
    maxFraction: 0.5,
  });
  const [dragging, setDragging] = useState(false);
  const value = useMemo(() => ({ controls, setDragging }), [controls]);

  return (
    <LeftResizeContext.Provider value={value}>
      <SidebarProvider
        {...props}
        className={cn(
          // The width eases when the sidebar collapses; following the pointer
          // through that easing makes the edge trail behind it.
          dragging &&
            "[&_[data-slot=sidebar-container]]:transition-none [&_[data-slot=sidebar-gap]]:transition-none",
          className,
        )}
        style={{ ...style, "--sidebar-width": `${controls.width}px` } as React.CSSProperties}
      >
        {children}
      </SidebarProvider>
    </LeftResizeContext.Provider>
  );
}

/** The grip on the left sidebar's inner edge. */
export function SidebarResizeHandle() {
  const left = useContext(LeftResizeContext);
  if (!left) return null;
  return (
    <WidthHandle
      controls={left.controls}
      grows="right"
      label="Resize sidebar"
      onDraggingChange={left.setDragging}
    />
  );
}

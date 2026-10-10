"use client";

import { WindowControls } from "@/components/window-controls";
import { useWindowControls } from "@/hooks/use-window-controls";

/**
 * Where the window's own buttons go, in px: three 32px buttons.
 *
 * The room the dock needs is left by whatever is underneath it — the top bar at the right when the details sidebar is not
 * showing (`TopNav`), the top of the sidebar's column when it is (`RightSidebarHost`) — so the buttons are always in the
 * window's top-right corner, and nothing else has to know where they are.
 */
export const WINDOW_CONTROLS_WIDTH = 96;
export const WINDOW_CONTROLS_HEIGHT = 32;

/**
 * Windows' and Linux's minimise / maximise / close, fixed to the top-right corner of the window. Draws nothing on macOS (the
 * system's traffic lights are at the other corner) or outside the desktop app.
 */
export function WindowControlsDock() {
  const { supported } = useWindowControls();
  if (!supported) return null;
  return (
    <div
      className="pointer-events-none fixed top-0 right-0 z-[1000] flex items-start justify-end"
      style={{ width: WINDOW_CONTROLS_WIDTH, height: WINDOW_CONTROLS_HEIGHT }}
    >
      <WindowControls className="pointer-events-auto border-none" />
    </div>
  );
}

/** Whether this window has controls of its own to leave room for. */
export function useReservesWindowControls(): boolean {
  return useWindowControls().supported;
}

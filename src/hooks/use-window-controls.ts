"use client";

import { useEffect, useState } from "react";

import { getDesktopAPI, getPlatform, isElectron } from "@/lib/desktop";

/** Custom-titlebar state for whichever window this hook is used in — each
 * window's controls act on itself (see electron/main.ts's per-sender
 * `BrowserWindow.fromWebContents` resolution). */
export function useWindowControls({ forceCustom = false }: { forceCustom?: boolean } = {}) {
  const [maximized, setMaximized] = useState(false);
  const api = getDesktopAPI()?.window;

  useEffect(() => {
    if (!api) return;
    void api.isMaximized().then(setMaximized);
    return api.onMaximizedChange(setMaximized);
  }, [api]);

  return {
    // Not on macOS: there the window keeps the system's traffic lights (see
    // FRAMELESS_WINDOW_OPTIONS in electron/main.ts) and drawing a second set
    // would be two sets of buttons. `forceCustom` is for the one window that
    // stays frameless everywhere (the picture-in-picture one).
    supported: isElectron() && !!api && (forceCustom || !hasNativeWindowControls()),
    maximized,
    minimize: () => void api?.minimize(),
    toggleMaximize: () => void api?.toggleMaximize(),
    close: () => void api?.close(),
  };
}

/** Whether this window's buttons are the operating system's. */
export function hasNativeWindowControls(): boolean {
  return isElectron() && getPlatform() === "darwin";
}

/** The width the top-left corner of a window needs to leave clear for the
 * system's traffic lights, in px. */
export const TRAFFIC_LIGHTS_INSET = 92;

/**
 * How much room to leave at the top left for the system's window buttons: none
 * where there aren't any (the buttons are ours, at the other corner) or where
 * they have gone (full screen), and enough to clear them where they are.
 */
export function useTrafficLightsInset(): number {
  const native = hasNativeWindowControls();
  const [fullScreen, setFullScreen] = useState(false);
  const api = getDesktopAPI()?.window;

  useEffect(() => {
    if (!native || !api?.isFullScreen || !api.onFullScreenChange) return;
    void api.isFullScreen().then(setFullScreen);
    return api.onFullScreenChange(setFullScreen);
  }, [native, api]);

  return native && !fullScreen ? TRAFFIC_LIGHTS_INSET : 0;
}

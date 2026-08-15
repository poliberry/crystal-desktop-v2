"use client";

import { useEffect, useState } from "react";

import { getDesktopAPI, isElectron } from "@/lib/desktop";

/** Custom-titlebar state for whichever window this hook is used in — each
 * window's controls act on itself (see electron/main.ts's per-sender
 * `BrowserWindow.fromWebContents` resolution). */
export function useWindowControls() {
  const [maximized, setMaximized] = useState(false);
  const api = getDesktopAPI()?.window;

  useEffect(() => {
    if (!api) return;
    void api.isMaximized().then(setMaximized);
    return api.onMaximizedChange(setMaximized);
  }, [api]);

  return {
    supported: isElectron() && !!api,
    maximized,
    minimize: () => void api?.minimize(),
    toggleMaximize: () => void api?.toggleMaximize(),
    close: () => void api?.close(),
  };
}

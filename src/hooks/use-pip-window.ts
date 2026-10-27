"use client";

import { useCallback, useEffect, useState } from "react";

import { getDesktopAPI, isElectron } from "@/lib/desktop";

/**
 * Controls the pop-out video window (a real, separate always-on-top
 * Electron `BrowserWindow` — see `electron/main.ts`'s `pip:*` handlers and
 * `src/app/pip/page.tsx`). Not Document Picture-in-Picture: Electron's bare
 * `BrowserWindow` doesn't implement the window-controller hooks that API
 * needs, so `documentPictureInPicture.requestWindow()` doesn't actually
 * work in Electron. The pip window has no LiveKit connection of its own
 * (that would show up as a duplicate, silent participant to everyone else
 * in the call) — the caller streams video frames to it with `sendFrame`.
 */
export function usePipWindow() {
  const [isOpen, setIsOpen] = useState(false);
  // The pip window's actual current content size, reported live as the user
  // resizes it — lets the caller capture frames at a matching resolution
  // instead of a fixed guess that gets blurrily upscaled once the window is
  // resized bigger than it.
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 480, height: 270 });
  const isSupported = isElectron();

  useEffect(() => {
    return getDesktopAPI()?.pip.onClosed(() => setIsOpen(false));
  }, []);

  useEffect(() => {
    return getDesktopAPI()?.pip.onSize(setSize);
  }, []);

  const open = useCallback(async (options?: { width?: number; height?: number; title?: string }) => {
    const ok = (await getDesktopAPI()?.pip.open(options)) ?? false;
    setIsOpen(ok);
    return ok;
  }, []);

  const close = useCallback(() => {
    void getDesktopAPI()?.pip.close();
    setIsOpen(false);
  }, []);

  const sendFrame = useCallback((dataUrl: string) => {
    getDesktopAPI()?.pip.sendFrame(dataUrl);
  }, []);

  // Close the pip window if this component unmounts (e.g. leaving the call)
  // instead of leaving an orphaned window behind.
  useEffect(() => {
    return () => {
      void getDesktopAPI()?.pip.close();
    };
  }, []);

  return { isOpen, isSupported, size, open, close, sendFrame };
}

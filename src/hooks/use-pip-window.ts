"use client";

import { useCallback, useEffect, useState } from "react";

interface DocumentPictureInPictureOptions {
  width?: number;
  height?: number;
}

interface DocumentPictureInPictureAPI {
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
  window: Window | null;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPictureAPI;
  }
}

/** Clones every stylesheet from this document into another so Tailwind
 * classes render correctly there — needed because a fresh Document
 * Picture-in-Picture window starts with an empty `<head>`. */
function copyStyles(target: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      if (sheet.cssRules) {
        const style = target.createElement("style");
        style.textContent = Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join("\n");
        target.head.appendChild(style);
        continue;
      }
    } catch {
      // Cross-origin stylesheet — `cssRules` throws; fall back to a <link>.
    }
    if (sheet.href) {
      const link = target.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      target.head.appendChild(link);
    }
  }
}

/**
 * Wraps the Document Picture-in-Picture API: a real, separate always-on-top
 * OS window that (unlike `window.open`) shares this page's JavaScript realm,
 * so React content can be moved into it with `createPortal` — component
 * state, refs, and LiveKit track attachments keep working exactly as if the
 * content never left the main window.
 */
export function usePipWindow() {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const isSupported = typeof window !== "undefined" && !!window.documentPictureInPicture;

  const close = useCallback(() => {
    setPipWindow((win) => {
      if (win && !win.closed) win.close();
      return null;
    });
  }, []);

  const open = useCallback(
    async (options?: DocumentPictureInPictureOptions & { title?: string }) => {
      if (!window.documentPictureInPicture) return null;
      const win = await window.documentPictureInPicture.requestWindow({
        width: options?.width ?? 480,
        height: options?.height ?? 270,
      });
      if (options?.title) win.document.title = options.title;
      copyStyles(win.document);
      win.document.documentElement.classList.add("dark");
      win.document.body.style.margin = "0";
      win.document.body.style.height = "100vh";
      win.document.body.style.overflow = "hidden";
      win.document.body.style.background = "#09090b";
      win.addEventListener("pagehide", () => setPipWindow(null));
      setPipWindow(win);
      return win;
    },
    []
  );

  // Close the popped-out window if this component unmounts (e.g. leaving
  // the call) instead of leaving an orphaned window behind.
  useEffect(() => {
    return () => {
      setPipWindow((win) => {
        if (win && !win.closed) win.close();
        return null;
      });
    };
  }, []);

  return { pipWindow, isSupported, open, close };
}

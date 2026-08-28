"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getDesktopAPI } from "@/lib/desktop";

/**
 * The user's own stylesheet, applied to the whole app.
 *
 * Two copies on purpose. The authority is a real file in the app's data
 * directory (`custom.css`, written over IPC) — that's what makes it editable
 * from outside the app, which matters a great deal the first time somebody
 * writes `display: none` on something they needed. The mirror in
 * `localStorage` is what the web build uses, and what the desktop build paints
 * from on the very first frame so a restart doesn't flash the unstyled UI
 * while an IPC round-trip completes.
 *
 * The CSS goes into a `<style>` element rather than being compiled or scoped:
 * the point of the feature is to reach anything on screen, so the browser's own
 * cascade is exactly the semantics wanted. It's appended last, so a user rule
 * of equal specificity wins over the app's.
 */

const STORAGE_KEY = "crystal:custom-css";
const ENABLED_KEY = "crystal:custom-css-enabled";
/** Marks our injected element, so a hot reload replaces it instead of stacking
 * a second copy on top of the first. */
const STYLE_ELEMENT_ID = "crystal-custom-css";

interface CustomCssContextValue {
  /** What's currently applied. */
  css: string;
  enabled: boolean;
  /** Where the file lives, once the desktop layer has said. Empty on the web,
   * where there is no file. */
  filePath: string;
  /** Apply and persist. */
  save: (css: string) => Promise<void>;
  /** Apply without persisting — what the editor does as you type. */
  preview: (css: string) => void;
  setEnabled: (enabled: boolean) => void;
  /** Show the file in the OS file manager. No-op on the web. */
  reveal: () => void;
}

const CustomCssContext = createContext<CustomCssContextValue | null>(null);

function readLocal(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function readEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function CustomCssProvider({ children }: { children: React.ReactNode }) {
  const [css, setCss] = useState("");
  const [enabled, setEnabledState] = useState(true);
  const [filePath, setFilePath] = useState("");
  const styleRef = useRef<HTMLStyleElement | null>(null);

  // Mount only: reading `localStorage` during render would differ between the
  // prerender and the client and blow up hydration.
  useEffect(() => {
    setCss(readLocal());
    setEnabledState(readEnabled());

    const api = getDesktopAPI()?.customCss;
    if (!api) return;
    // The file wins once it arrives — it's the copy a user may have edited
    // outside the app since this machine last ran it.
    void api.read().then((fromFile) => {
      if (typeof fromFile === "string" && fromFile !== readLocal()) {
        setCss(fromFile);
        try {
          window.localStorage.setItem(STORAGE_KEY, fromFile);
        } catch {
          /* quota — the file is still the authority */
        }
      }
    });
    void api.path().then(setFilePath);
  }, []);

  /** Push the current text into the document. */
  useEffect(() => {
    if (typeof document === "undefined") return;
    let element = styleRef.current;
    if (!element) {
      element =
        (document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null) ??
        document.createElement("style");
      element.id = STYLE_ELEMENT_ID;
      // Last in `head`, so an equally specific user rule beats the app's.
      document.head.appendChild(element);
      styleRef.current = element;
    }
    element.textContent = enabled ? css : "";
  }, [css, enabled]);

  const preview = useCallback((next: string) => setCss(next), []);

  const save = useCallback(async (next: string) => {
    setCss(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* quota — the file below is still written */
    }
    await getDesktopAPI()?.customCss?.write(next);
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      window.localStorage.setItem(ENABLED_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const reveal = useCallback(() => {
    void getDesktopAPI()?.customCss?.reveal();
  }, []);

  const value = useMemo<CustomCssContextValue>(
    () => ({ css, enabled, filePath, save, preview, setEnabled, reveal }),
    [css, enabled, filePath, save, preview, setEnabled, reveal],
  );

  return (
    <CustomCssContext.Provider value={value}>{children}</CustomCssContext.Provider>
  );
}

export function useCustomCss(): CustomCssContextValue {
  const ctx = useContext(CustomCssContext);
  if (!ctx) {
    throw new Error("useCustomCss must be used within <CustomCssProvider>");
  }
  return ctx;
}

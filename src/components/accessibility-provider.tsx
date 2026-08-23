"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";

import { getDesktopAPI } from "@/lib/desktop";

const STORAGE_KEY = "crystal-accessibility";

/**
 * Zoom stops, as a factor on the whole window's contents. Discrete rather than
 * a free slider so the keyboard shortcuts (Ctrl/Cmd +/-) and the buttons in
 * Settings move through the same values, and so "one press" is always a
 * noticeable step rather than a percent.
 */
export const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

/** Text-size stops, as a multiplier on the root font size. */
export const TEXT_SCALES = [
  { value: 0.875, label: "Small" },
  { value: 1, label: "Default" },
  { value: 1.15, label: "Large" },
  { value: 1.3, label: "Larger" },
] as const;

export interface AccessibilityPreferences {
  /** Scale applied to everything in the window — text, images, video, layout.
   * The desktop app hands this to Electron's zoom factor; a plain browser
   * falls back to the CSS `zoom` property. */
  zoom: number;
  /** Scale applied to the root font size, so text (and anything sized in `rem`
   * relative to it) grows without resampling avatars or video. */
  textScale: number;
  /** Suppress animations and transitions, including framer-motion's. */
  reducedMotion: boolean;
  /** Stronger borders, brighter secondary text, always-visible focus rings. */
  highContrast: boolean;
  /** Swap the UI font for a wider, more distinguishable one. */
  readableFont: boolean;
  /** Underline links instead of relying on colour alone. */
  underlineLinks: boolean;
}

export const DEFAULT_ACCESSIBILITY: AccessibilityPreferences = {
  zoom: 1,
  textScale: 1,
  reducedMotion: false,
  highContrast: false,
  readableFont: false,
  underlineLinks: false,
};

interface AccessibilityContextValue extends AccessibilityPreferences {
  setPreference: <K extends keyof AccessibilityPreferences>(
    key: K,
    value: AccessibilityPreferences[K]
  ) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  /** True when `zoom` is already at the smallest/largest stop. */
  canZoomIn: boolean;
  canZoomOut: boolean;
  reset: () => void;
}

const AccessibilityContext = createContext<AccessibilityContextValue>({
  ...DEFAULT_ACCESSIBILITY,
  setPreference: () => {},
  zoomIn: () => {},
  zoomOut: () => {},
  resetZoom: () => {},
  canZoomIn: true,
  canZoomOut: true,
  reset: () => {},
});

function parse(raw: string | null): AccessibilityPreferences {
  if (!raw) return DEFAULT_ACCESSIBILITY;
  try {
    const stored = JSON.parse(raw) as Partial<AccessibilityPreferences>;
    return {
      zoom: nearestZoom(typeof stored.zoom === "number" ? stored.zoom : 1),
      textScale: typeof stored.textScale === "number" ? stored.textScale : 1,
      reducedMotion: stored.reducedMotion === true,
      highContrast: stored.highContrast === true,
      readableFont: stored.readableFont === true,
      underlineLinks: stored.underlineLinks === true,
    };
  } catch {
    return DEFAULT_ACCESSIBILITY;
  }
}

/** Snap a stored/incoming factor onto the nearest stop, so a value written by
 * an older build (or a hand-edited one) still lands somewhere the +/- buttons
 * can move away from. */
function nearestZoom(zoom: number): number {
  return ZOOM_LEVELS.reduce((best, level) =>
    Math.abs(level - zoom) < Math.abs(best - zoom) ? level : best
  );
}

function step(zoom: number, direction: 1 | -1): number {
  const index = ZOOM_LEVELS.indexOf(nearestZoom(zoom) as (typeof ZOOM_LEVELS)[number]);
  const next = ZOOM_LEVELS[index + direction];
  return next ?? zoom;
}

/**
 * Everything except zoom is CSS: a class or a custom property on
 * `<html>`, read by the rules under "Accessibility" in globals.css. Zoom is
 * the window's own scale factor, which only the main process can set properly
 * — CSS `zoom` is the fallback for a plain browser, where there's no window to
 * ask.
 */
function apply(prefs: AccessibilityPreferences): void {
  const root = document.documentElement;
  root.style.setProperty("--a11y-text-scale", String(prefs.textScale));
  root.classList.toggle("a11y-reduced-motion", prefs.reducedMotion);
  root.classList.toggle("a11y-high-contrast", prefs.highContrast);
  root.classList.toggle("a11y-readable-font", prefs.readableFont);
  root.classList.toggle("a11y-underline-links", prefs.underlineLinks);

  const api = getDesktopAPI()?.window;
  if (api?.setZoomFactor) {
    root.style.removeProperty("zoom");
    void api.setZoomFactor(prefs.zoom);
  } else {
    root.style.zoom = String(prefs.zoom);
  }
}

/**
 * Accessibility preferences (Settings → Accessibility), persisted to
 * localStorage.
 *
 * Separate from `UiPreferencesProvider` because these are about being able to
 * use the app rather than how it's laid out, and because they apply to every
 * window: the Settings window is its own Electron `BrowserWindow`, so this
 * listens for `storage` (which fires when a *different* same-origin window
 * writes) and re-applies — otherwise turning zoom up in Settings would leave
 * the main window at the old scale until it reloaded.
 */
export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<AccessibilityPreferences>(DEFAULT_ACCESSIBILITY);

  useEffect(() => {
    const stored = parse(localStorage.getItem(STORAGE_KEY));
    setPrefs(stored);
    apply(stored);
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = parse(e.newValue);
      setPrefs(next);
      apply(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /** Persist and apply in one place, so no caller can change a preference
   * without the window catching up (or without it surviving a restart). */
  const update = useCallback(
    (next: (prev: AccessibilityPreferences) => AccessibilityPreferences) => {
      setPrefs((prev) => {
        const resolved = next(prev);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(resolved));
        apply(resolved);
        return resolved;
      });
    },
    []
  );

  const setPreference = useCallback(
    <K extends keyof AccessibilityPreferences>(key: K, value: AccessibilityPreferences[K]) =>
      update((prev) => ({ ...prev, [key]: value })),
    [update]
  );

  const zoomIn = useCallback(
    () => update((prev) => ({ ...prev, zoom: step(prev.zoom, 1) })),
    [update]
  );
  const zoomOut = useCallback(
    () => update((prev) => ({ ...prev, zoom: step(prev.zoom, -1) })),
    [update]
  );
  const resetZoom = useCallback(() => update((prev) => ({ ...prev, zoom: 1 })), [update]);
  const reset = useCallback(() => update(() => DEFAULT_ACCESSIBILITY), [update]);

  // The usual browser zoom shortcuts. Electron's built-in ones come from the
  // application menu, which both windows hide, so they'd otherwise do nothing
  // — and going through this handler keeps the persisted value and the actual
  // zoom factor in step.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomIn();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomOut();
      } else if (event.key === "0") {
        event.preventDefault();
        resetZoom();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomIn, zoomOut, resetZoom]);

  const value = useMemo<AccessibilityContextValue>(
    () => ({
      ...prefs,
      setPreference,
      zoomIn,
      zoomOut,
      resetZoom,
      canZoomIn: prefs.zoom < ZOOM_LEVELS[ZOOM_LEVELS.length - 1],
      canZoomOut: prefs.zoom > ZOOM_LEVELS[0],
      reset,
    }),
    [prefs, setPreference, zoomIn, zoomOut, resetZoom, reset]
  );

  return (
    <AccessibilityContext.Provider value={value}>
      {/* "always" stops framer-motion mid-flight too — the CSS rules in
          globals.css can't touch animations it drives from JS. */}
      <MotionConfig reducedMotion={prefs.reducedMotion ? "always" : "user"}>
        {children}
      </MotionConfig>
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility(): AccessibilityContextValue {
  return useContext(AccessibilityContext);
}

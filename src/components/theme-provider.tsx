"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { getDesktopAPI } from "@/lib/desktop";
import {
  type SystemThemeIds,
  type Theme,
  type ThemeMode,
  DEFAULT_SYSTEM_THEME_IDS,
  DEFAULT_THEME_ID,
  PRESET_THEMES,
  deriveDynamicTheme,
  getPresetById,
} from "@/lib/themes";

const STORAGE_KEY = "crystal-theme";
const MODE_KEY = "crystal-theme-mode";
const SYSTEM_KEY = "crystal-theme-system";

interface ThemeContextValue {
  /** The theme in effect — the picked one, or whichever of the system's two
   * (or the dynamic one) applies right now. */
  theme: Theme | null;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** Picks a theme and goes back to a fixed one. */
  applyTheme: (theme: Theme) => void;
  resetTheme: () => void;
  /** Which theme goes with the system's light and its dark setting. */
  systemThemeIds: SystemThemeIds;
  setSystemThemeIds: (ids: Partial<SystemThemeIds>) => void;
  /** Whether the app can read the system's accent colour here. */
  dynamicSupported: boolean;
  /** The system accent colour (`#rrggbb`), where it can be read. */
  accentColor: string | null;
  /** The system's setting, whether or not a mode is following it. */
  prefersDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: null,
  mode: "fixed",
  setMode: () => {},
  applyTheme: () => {},
  resetTheme: () => {},
  systemThemeIds: DEFAULT_SYSTEM_THEME_IDS,
  setSystemThemeIds: () => {},
  dynamicSupported: false,
  accentColor: null,
  prefersDark: true,
});

/**
 * Set on <html> by ThemePackProvider while a theme pack that carries colours is on: "dark" or "light". The pack decides
 * which, so a theme change underneath it must not flip the class back.
 */
export const PACK_SCHEME_ATTR = "data-theme-pack-scheme";

function injectTheme(theme: Theme) {
  let styleEl = document.getElementById("crystal-theme-vars") as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "crystal-theme-vars";
    // Always before the theme pack's stylesheet and the person's own: all three set the same variables at the same
    // specificity, so the order is the whole precedence (theme < pack < custom CSS). This effect runs after the pack
    // provider's own (it is the parent), so appending here would put the theme on top of a pack that got there first.
    const later = document.getElementById("crystal-theme-pack") ?? document.getElementById("crystal-custom-css");
    if (later) document.head.insertBefore(styleEl, later);
    else document.head.appendChild(styleEl);
  }

  const cssVars = Object.entries(theme.colors)
    .map(([k, v]) => `  --${k}: ${v};`)
    .join("\n");

  const fontLine = theme.font ? `\n  --font-sans: ${theme.font};` : "";

  // Override both :root and .dark so the colors win regardless of dark class state
  styleEl.textContent = `:root {\n${cssVars}${fontLine}\n}\n.dark {\n${cssVars}${fontLine}\n}`;

  const forced = document.documentElement.getAttribute(PACK_SCHEME_ATTR);
  document.documentElement.classList.toggle("dark", forced ? forced === "dark" : theme.isDark);
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function readMode(): ThemeMode {
  const stored = localStorage.getItem(MODE_KEY);
  return stored === "system" || stored === "dynamic" ? stored : "fixed";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // What was picked, kept apart from what is showing: in `system` and `dynamic`
  // mode the picked theme is still there to go back to.
  const [fixedTheme, setFixedTheme] = useState<Theme | null>(null);
  const [mode, setModeState] = useState<ThemeMode>("fixed");
  const [systemThemeIds, setSystemThemeIdsState] = useState(DEFAULT_SYSTEM_THEME_IDS);
  const [prefersDark, setPrefersDark] = useState(true);
  const [accentColor, setAccentColor] = useState<string | null>(null);

  const load = useCallback(() => {
    const stored = readJson<Theme>(STORAGE_KEY);
    setFixedTheme(stored ?? getPresetById(DEFAULT_THEME_ID) ?? PRESET_THEMES[0]);
    setModeState(readMode());
    setSystemThemeIdsState({
      ...DEFAULT_SYSTEM_THEME_IDS,
      ...readJson<Partial<SystemThemeIds>>(SYSTEM_KEY),
    });
  }, []);

  useEffect(load, [load]);

  // The Settings window used to be a separate Electron BrowserWindow (separate
  // renderer/JS realm) — `storage` fires here when *another* same-origin
  // window writes localStorage, letting theme changes made elsewhere apply to
  // this window live instead of only on next reload.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === MODE_KEY || e.key === SYSTEM_KEY) load();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [load]);

  // The system's light/dark setting.
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    setPrefersDark(query.matches);
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // The system's accent colour, where the desktop app can read it.
  useEffect(() => {
    const system = getDesktopAPI()?.system;
    if (!system) return;
    const read = () => void system.accentColor().then(setAccentColor);
    read();
    const unsubscribe = system.onAccentColorChange(setAccentColor);
    // A belt for the braces: the main process announces a change, but a
    // notification missed while the app was in the background (a laptop asleep,
    // the setting changed in another Space) would leave the colour stale until
    // the next change. Looking again on coming back costs one IPC call.
    const onVisible = () => {
      if (document.visibilityState === "visible") read();
    };
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const dynamicSupported = accentColor !== null;

  const theme = useMemo<Theme | null>(() => {
    if (mode === "dynamic" && accentColor) return deriveDynamicTheme(accentColor, prefersDark);
    // Dynamic where it can't be read behaves as the system mode does, rather
    // than as a fixed theme the user never chose for this machine.
    if (mode === "system" || mode === "dynamic") {
      const id = prefersDark ? systemThemeIds.dark : systemThemeIds.light;
      return (
        getPresetById(id) ??
        getPresetById(prefersDark ? DEFAULT_SYSTEM_THEME_IDS.dark : DEFAULT_SYSTEM_THEME_IDS.light) ??
        fixedTheme
      );
    }
    return fixedTheme;
  }, [mode, accentColor, prefersDark, systemThemeIds, fixedTheme]);

  useEffect(() => {
    if (theme) injectTheme(theme);
  }, [theme]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    localStorage.setItem(MODE_KEY, next);
  }, []);

  const applyTheme = useCallback(
    (t: Theme) => {
      setFixedTheme(t);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
      setMode("fixed");
    },
    [setMode],
  );

  const setSystemThemeIds = useCallback((ids: Partial<SystemThemeIds>) => {
    setSystemThemeIdsState((current) => {
      const next = { ...current, ...ids };
      localStorage.setItem(SYSTEM_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetTheme = useCallback(() => {
    const def = getPresetById(DEFAULT_THEME_ID) ?? PRESET_THEMES[0];
    applyTheme(def);
  }, [applyTheme]);

  const value = useMemo(
    () => ({
      theme,
      mode,
      setMode,
      applyTheme,
      resetTheme,
      systemThemeIds,
      setSystemThemeIds,
      dynamicSupported,
      accentColor,
      prefersDark,
    }),
    [
      theme,
      mode,
      setMode,
      applyTheme,
      resetTheme,
      systemThemeIds,
      setSystemThemeIds,
      dynamicSupported,
      accentColor,
      prefersDark,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

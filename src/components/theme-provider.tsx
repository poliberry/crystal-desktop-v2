"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { type Theme, DEFAULT_THEME_ID, getPresetById, PRESET_THEMES } from "@/lib/themes";

const STORAGE_KEY = "crystal-theme";

interface ThemeContextValue {
  theme: Theme | null;
  applyTheme: (theme: Theme) => void;
  resetTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: null,
  applyTheme: () => {},
  resetTheme: () => {},
});

function injectTheme(theme: Theme) {
  let styleEl = document.getElementById("crystal-theme-vars") as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "crystal-theme-vars";
    document.head.appendChild(styleEl);
  }

  const cssVars = Object.entries(theme.colors)
    .map(([k, v]) => `  --${k}: ${v};`)
    .join("\n");

  const fontLine = theme.font ? `\n  --font-sans: ${theme.font};` : "";

  // Override both :root and .dark so the colors win regardless of dark class state
  styleEl.textContent = `:root {\n${cssVars}${fontLine}\n}\n.dark {\n${cssVars}${fontLine}\n}`;

  document.documentElement.classList.toggle("dark", theme.isDark);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    let resolved: Theme | null = null;
    if (stored) {
      try {
        resolved = JSON.parse(stored) as Theme;
      } catch {}
    }
    if (!resolved) {
      resolved = getPresetById(DEFAULT_THEME_ID) ?? PRESET_THEMES[0];
    }
    setTheme(resolved);
    injectTheme(resolved);
  }, []);

  // The Settings window is a separate Electron BrowserWindow (separate
  // renderer/JS realm) — `storage` fires here when *another* same-origin
  // window writes localStorage, letting theme changes made in Settings
  // apply to the main window live instead of only on next reload.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const next = JSON.parse(e.newValue) as Theme;
        setTheme(next);
        injectTheme(next);
      } catch {}
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const applyTheme = useCallback((t: Theme) => {
    setTheme(t);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
    injectTheme(t);
  }, []);

  const resetTheme = useCallback(() => {
    const def = getPresetById(DEFAULT_THEME_ID) ?? PRESET_THEMES[0];
    applyTheme(def);
  }, [applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, applyTheme, resetTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

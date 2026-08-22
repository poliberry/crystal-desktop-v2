"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY_NAV_STYLE = "crystal-community-nav-style";
const STORAGE_KEY_TABS_ENABLED = "crystal-tabs-enabled";

export type CommunityNavStyle = "rail" | "popover";

interface UiPreferencesContextValue {
  /** Whether communities are switched via a persistent left-edge icon rail
   * (Discord-style) or a popover opened from the top nav. */
  communityNavStyle: CommunityNavStyle;
  setCommunityNavStyle: (style: CommunityNavStyle) => void;
  /** Whether DMs/channels open as browser-like tabs in the top nav, or the
   * classic single-view behavior (clicking one replaces the current view). */
  tabsEnabled: boolean;
  setTabsEnabled: (enabled: boolean) => void;
}

const DEFAULTS: UiPreferencesContextValue = {
  communityNavStyle: "rail",
  setCommunityNavStyle: () => {},
  tabsEnabled: true,
  setTabsEnabled: () => {},
};

const UiPreferencesContext = createContext<UiPreferencesContextValue>(DEFAULTS);

/** User-facing interface preferences (Settings → Appearance), persisted to
 * localStorage. The Settings window is a separate Electron BrowserWindow, so
 * this also listens for the `storage` event to pick up changes made there
 * live instead of only on next reload of the main window. */
export function UiPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [communityNavStyle, setNavStyleState] = useState<CommunityNavStyle>(DEFAULTS.communityNavStyle);
  const [tabsEnabled, setTabsEnabledState] = useState(DEFAULTS.tabsEnabled);

  useEffect(() => {
    const storedStyle = localStorage.getItem(STORAGE_KEY_NAV_STYLE);
    if (storedStyle === "rail" || storedStyle === "popover") setNavStyleState(storedStyle);
    const storedTabs = localStorage.getItem(STORAGE_KEY_TABS_ENABLED);
    if (storedTabs === "true" || storedTabs === "false") setTabsEnabledState(storedTabs === "true");
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_NAV_STYLE && (e.newValue === "rail" || e.newValue === "popover")) {
        setNavStyleState(e.newValue);
      }
      if (e.key === STORAGE_KEY_TABS_ENABLED && (e.newValue === "true" || e.newValue === "false")) {
        setTabsEnabledState(e.newValue === "true");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setCommunityNavStyle = useCallback((next: CommunityNavStyle) => {
    setNavStyleState(next);
    localStorage.setItem(STORAGE_KEY_NAV_STYLE, next);
  }, []);

  const setTabsEnabled = useCallback((next: boolean) => {
    setTabsEnabledState(next);
    localStorage.setItem(STORAGE_KEY_TABS_ENABLED, String(next));
  }, []);

  return (
    <UiPreferencesContext.Provider
      value={{ communityNavStyle, setCommunityNavStyle, tabsEnabled, setTabsEnabled }}
    >
      {children}
    </UiPreferencesContext.Provider>
  );
}

export function useUiPreferences(): UiPreferencesContextValue {
  return useContext(UiPreferencesContext);
}

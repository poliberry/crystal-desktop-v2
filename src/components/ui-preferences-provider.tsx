"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY_NAV_STYLE = "crystal-community-nav-style";
const STORAGE_KEY_TABS_ENABLED = "crystal-tabs-enabled";
const STORAGE_KEY_HOME_LANDING = "crystal-home-landing";
const STORAGE_KEY_HOME_SECTIONS = "crystal-home-sections";

export type CommunityNavStyle = "rail" | "popover";
export type HomeLanding = "my-crystal" | "friends";
export type HomeSectionId = "jump-back-in" | "missed" | "newsfeed" | "important" | "online" | "games" | "dms" | "friends";
export interface HomeSectionPreference { id: HomeSectionId; visible: boolean; }

export const DEFAULT_HOME_SECTIONS: HomeSectionPreference[] = [
  { id: "jump-back-in", visible: true },
  { id: "missed", visible: true },
  { id: "newsfeed", visible: true },
  { id: "important", visible: true },
  { id: "online", visible: true },
  { id: "games", visible: true },
  { id: "dms", visible: true },
  { id: "friends", visible: true },
];

interface UiPreferencesContextValue {
  /** Whether communities are switched via a persistent left-edge icon rail
   * (Discord-style) or a popover opened from the top nav. */
  communityNavStyle: CommunityNavStyle;
  setCommunityNavStyle: (style: CommunityNavStyle) => void;
  /** Whether DMs/channels open as browser-like tabs in the top nav, or the
   * classic single-view behavior (clicking one replaces the current view). */
  tabsEnabled: boolean;
  setTabsEnabled: (enabled: boolean) => void;
  homeLanding: HomeLanding;
  setHomeLanding: (landing: HomeLanding) => void;
  homeSections: HomeSectionPreference[];
  setHomeSections: (sections: HomeSectionPreference[]) => void;
}

const DEFAULTS: UiPreferencesContextValue = {
  communityNavStyle: "rail",
  setCommunityNavStyle: () => {},
  tabsEnabled: true,
  setTabsEnabled: () => {},
  homeLanding: "my-crystal",
  setHomeLanding: () => {},
  homeSections: DEFAULT_HOME_SECTIONS,
  setHomeSections: () => {},
};

const UiPreferencesContext = createContext<UiPreferencesContextValue>(DEFAULTS);

/** User-facing interface preferences (Settings → Appearance), persisted to
 * localStorage. The Settings window is a separate Electron BrowserWindow, so
 * this also listens for the `storage` event to pick up changes made there
 * live instead of only on next reload of the main window. */
export function UiPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [communityNavStyle, setNavStyleState] = useState<CommunityNavStyle>(DEFAULTS.communityNavStyle);
  const [tabsEnabled, setTabsEnabledState] = useState(DEFAULTS.tabsEnabled);
  const [homeLanding, setHomeLandingState] = useState<HomeLanding>(DEFAULTS.homeLanding);
  const [homeSections, setHomeSectionsState] = useState<HomeSectionPreference[]>(DEFAULT_HOME_SECTIONS);

  useEffect(() => {
    const storedStyle = localStorage.getItem(STORAGE_KEY_NAV_STYLE);
    if (storedStyle === "rail" || storedStyle === "popover") setNavStyleState(storedStyle);
    const storedTabs = localStorage.getItem(STORAGE_KEY_TABS_ENABLED);
    if (storedTabs === "true" || storedTabs === "false") setTabsEnabledState(storedTabs === "true");
    const storedLanding = localStorage.getItem(STORAGE_KEY_HOME_LANDING);
    if (storedLanding === "my-crystal" || storedLanding === "friends") setHomeLandingState(storedLanding);
    try {
      const storedSections = JSON.parse(localStorage.getItem(STORAGE_KEY_HOME_SECTIONS) ?? "null");
      if (Array.isArray(storedSections)) {
        const known = new Set<string>(DEFAULT_HOME_SECTIONS.map((section) => section.id));
        const kept = storedSections.filter(
          (item): item is HomeSectionPreference =>
            !!item && known.has(item.id) && typeof item.visible === "boolean",
        );
        // A section added since this layout was saved (the newsfeed) joins at its default place.
        const merged = [...kept];
        DEFAULT_HOME_SECTIONS.forEach((section, index) => {
          if (!merged.some((item) => item.id === section.id)) merged.splice(Math.min(index, merged.length), 0, section);
        });
        if (kept.length > 0) setHomeSectionsState(merged);
      }
    } catch { /* keep defaults */ }
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_NAV_STYLE && (e.newValue === "rail" || e.newValue === "popover")) {
        setNavStyleState(e.newValue);
      }
      if (e.key === STORAGE_KEY_TABS_ENABLED && (e.newValue === "true" || e.newValue === "false")) {
        setTabsEnabledState(e.newValue === "true");
      }
      if (e.key === STORAGE_KEY_HOME_LANDING && (e.newValue === "my-crystal" || e.newValue === "friends")) {
        setHomeLandingState(e.newValue);
      }
      if (e.key === STORAGE_KEY_HOME_SECTIONS && e.newValue) {
        try {
          const next = JSON.parse(e.newValue);
          if (Array.isArray(next)) setHomeSectionsState(next as HomeSectionPreference[]);
        } catch { /* keep current layout */ }
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

  const setHomeLanding = useCallback((next: HomeLanding) => {
    setHomeLandingState(next);
    localStorage.setItem(STORAGE_KEY_HOME_LANDING, next);
  }, []);

  const setHomeSections = useCallback((next: HomeSectionPreference[]) => {
    setHomeSectionsState(next);
    localStorage.setItem(STORAGE_KEY_HOME_SECTIONS, JSON.stringify(next));
  }, []);

  return (
    <UiPreferencesContext.Provider
      value={{ communityNavStyle, setCommunityNavStyle, tabsEnabled, setTabsEnabled, homeLanding, setHomeLanding, homeSections, setHomeSections }}
    >
      {children}
    </UiPreferencesContext.Provider>
  );
}

export function useUiPreferences(): UiPreferencesContextValue {
  return useContext(UiPreferencesContext);
}

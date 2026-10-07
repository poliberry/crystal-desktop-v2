"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { Id } from "../../../convex/_generated/dataModel";
import { recordRecentView } from "@/lib/recent-views";

/**
 * Full pages that take over the content area — Settings, the profile editor, a
 * community's settings. They are tabs like any other (so they show in the tab
 * strip, survive a reload and take part in back/forward), but they are not
 * places: nothing about them is worth pinning or preloading.
 */
export type PageTarget =
  | { type: "settings" }
  | { type: "profile-editor" }
  | { type: "create-community" }
  | { type: "marketplace" }
  | { type: "community-settings"; communityId: Id<"communities"> };

export type TabTarget =
  | { type: "home" }
  | { type: "dm"; conversationId: Id<"conversations"> }
  | { type: "channel"; communityId: Id<"communities">; channelId: Id<"channels"> }
  | PageTarget;

export function isPageTarget(target: TabTarget): target is PageTarget {
  return (
    target.type === "settings" ||
    target.type === "profile-editor" ||
    target.type === "create-community" ||
    target.type === "marketplace" ||
    target.type === "community-settings"
  );
}

export interface Tab {
  id: string;
  target: TabTarget;
  pinned: boolean;
}

const PINNED_STORAGE_KEY = "crystal-pinned-tabs";

function tabId(target: TabTarget): string {
  switch (target.type) {
    case "home":
      return "home";
    case "dm":
      return `dm:${target.conversationId}`;
    case "channel":
      return `channel:${target.communityId}:${target.channelId}`;
    case "settings":
      return "settings";
    case "profile-editor":
      return "profile-editor";
    case "create-community":
      return "create-community";
    case "marketplace":
      return "marketplace";
    case "community-settings":
      return `community-settings:${target.communityId}`;
  }
}

/** Browser-like address-bar state for the tabs, encoded entirely in the URL
 * *hash* (e.g. `#/dm/abc123`) rather than the path. This app is a static
 * Next.js export with no server at runtime (see next.config.ts) — in the
 * packaged build any unmatched path falls back to serving `index.html`, but
 * in `next dev` (used for local development) real path segments like
 * `/dm/abc123` hit Next's actual dev-server router and 404 on any hard
 * reload/navigation, since no such route file exists. The hash portion of a
 * URL is never sent to a server on any request (dev or packaged), so this is
 * purely client-side virtual routing — `history.pushState` + a `popstate`
 * listener restore tabs from `location.hash` — that can never 404 either
 * way. Home has no hash at all. */
function tabPath(target: TabTarget): string {
  switch (target.type) {
    case "home":
      return "";
    case "dm":
      return `#/dm/${target.conversationId}`;
    case "channel":
      return `#/community/${target.communityId}/${target.channelId}`;
    case "settings":
      return "#/settings";
    case "profile-editor":
      return "#/profile";
    case "create-community":
      return "#/create-community";
    case "marketplace":
      return "#/marketplace";
    case "community-settings":
      // Its own first segment rather than `#/community/:id/settings`, which
      // is already how a channel whose id is "settings" would be written.
      return `#/community-settings/${target.communityId}`;
  }
}

function parseHash(hash: string): TabTarget | null {
  const parts = hash
    .replace(/^#/, "")
    .split("/")
    .filter(Boolean);
  if (parts.length === 0) return { type: "home" };
  if (parts[0] === "dm" && parts[1]) {
    return { type: "dm", conversationId: parts[1] as Id<"conversations"> };
  }
  if (parts[0] === "community" && parts[1] && parts[2]) {
    return {
      type: "channel",
      communityId: parts[1] as Id<"communities">,
      channelId: parts[2] as Id<"channels">,
    };
  }
  if (parts[0] === "settings") return { type: "settings" };
  if (parts[0] === "profile") return { type: "profile-editor" };
  if (parts[0] === "create-community") return { type: "create-community" };
  if (parts[0] === "marketplace") return { type: "marketplace" };
  if (parts[0] === "community-settings" && parts[1]) {
    return { type: "community-settings", communityId: parts[1] as Id<"communities"> };
  }
  return null;
}

function loadPinnedTargets(): TabTarget[] {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TabTarget[];
    return Array.isArray(parsed) ? parsed.filter((t) => !isPageTarget(t)) : [];
  } catch {
    return [];
  }
}

function savePinnedTargets(tabs: Tab[]) {
  const pinned = tabs
    .filter((t) => t.pinned && t.target.type !== "home" && !isPageTarget(t.target))
    .map((t) => t.target);
  localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(pinned));
}

const HOME_TAB: Tab = { id: "home", target: { type: "home" }, pinned: true };

interface TabsContextValue {
  /** Home first, then pinned tabs, then unpinned tabs in open-order. */
  tabs: Tab[];
  activeTabId: string;
  activeTab: Tab;
  /** Opens a tab for this target, or focuses it if already open. */
  openTab: (target: TabTarget) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  togglePinTab: (id: string) => void;
  /** Goes back to the last tab that wasn't a page, leaving the page's own tab
   * open. For navigation that has to show something *in* a place rather than
   * beside the page. */
  leavePage: () => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function orderTabs(tabs: Tab[]): Tab[] {
  const home = tabs.filter((t) => t.target.type === "home");
  const pinned = tabs.filter((t) => t.target.type !== "home" && t.pinned);
  const rest = tabs.filter((t) => t.target.type !== "home" && !t.pinned);
  return [...home, ...pinned, ...rest];
}

export function TabsProvider({ children }: { children: React.ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>(() => [
    HOME_TAB,
    ...loadPinnedTargets().map((target) => ({ id: tabId(target), target, pinned: true })),
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("home");
  // The last tab that was a place, not a page: where closing a page goes back
  // to, rather than to whichever tab happens to sit next to it in the strip.
  const returnTabId = useRef("home");

  // Restore the active tab from the current URL hash on first mount (reload / deep link).
  useEffect(() => {
    const target = parseHash(window.location.hash);
    if (!target || target.type === "home") return;
    const id = tabId(target);
    setTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, target, pinned: false }]));
    setActiveTabId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the address bar in sync with the active tab (enables back/forward),
  // and note what was opened so the preloader knows where to spend its
  // budget (see src/lib/recent-views.ts). Both belong here rather than in the
  // navigation helpers because this also covers tab-bar clicks, back/forward
  // and deep links.
  useEffect(() => {
    const active = tabs.find((t) => t.id === activeTabId) ?? HOME_TAB;
    const hash = tabPath(active.target);
    if (window.location.hash !== hash) {
      window.history.pushState({ tabId: active.id }, "", hash || window.location.pathname);
    }
    if (!isPageTarget(active.target)) returnTabId.current = active.id;
    if (active.target.type === "dm" || active.target.type === "channel") {
      recordRecentView(active.target);
    }
  }, [activeTabId, tabs]);

  useEffect(() => {
    const onPopState = () => {
      const target = parseHash(window.location.hash);
      if (!target) return;
      const id = tabId(target);
      setTabs((prev) =>
        prev.some((t) => t.id === id) || target.type === "home"
          ? prev
          : [...prev, { id, target, pinned: false }]
      );
      setActiveTabId(id);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const openTab = useCallback((target: TabTarget) => {
    const id = tabId(target);
    setTabs((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, target, pinned: false }]));
    setActiveTabId(id);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      if (id === "home") return;
      const idx = tabs.findIndex((t) => t.id === id);
      if (idx === -1) return;
      const next = tabs.filter((t) => t.id !== id);
      setTabs(next);
      savePinnedTargets(next);
      if (activeTabId === id) {
        const closing = tabs[idx];
        const back = next.find((t) => t.id === returnTabId.current);
        if (isPageTarget(closing.target) && back) {
          setActiveTabId(back.id);
        } else {
          const ordered = orderTabs(next);
          setActiveTabId((ordered[Math.max(0, idx - 1)] ?? HOME_TAB).id);
        }
      }
    },
    [tabs, activeTabId]
  );

  const activateTab = useCallback((id: string) => {
    setActiveTabId(id);
  }, []);

  const togglePinTab = useCallback(
    (id: string) => {
      const tab = tabs.find((t) => t.id === id);
      if (id === "home" || !tab || isPageTarget(tab.target)) return;
      const next = tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t));
      setTabs(next);
      savePinnedTargets(next);
    },
    [tabs]
  );

  const leavePage = useCallback(() => {
    const back = tabs.find((t) => t.id === returnTabId.current);
    setActiveTabId(back ? back.id : "home");
  }, [tabs]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? HOME_TAB;
  const ordered = useMemo(() => orderTabs(tabs), [tabs]);

  const value = useMemo(
    () => ({
      tabs: ordered,
      activeTabId,
      activeTab,
      openTab,
      closeTab,
      activateTab,
      togglePinTab,
      leavePage,
    }),
    [ordered, activeTabId, activeTab, openTab, closeTab, activateTab, togglePinTab, leavePage]
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("useTabs must be used within <TabsProvider>");
  return ctx;
}

/** The tabs, or `null` outside the provider — the pop-out window mounts none of
 * this. */
export function useOptionalTabs(): TabsContextValue | null {
  return useContext(TabsContext);
}

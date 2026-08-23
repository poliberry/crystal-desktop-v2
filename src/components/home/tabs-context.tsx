"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import type { Id } from "../../../convex/_generated/dataModel";
import { recordRecentView } from "@/lib/recent-views";

export type TabTarget =
  | { type: "home" }
  | { type: "dm"; conversationId: Id<"conversations"> }
  | { type: "channel"; communityId: Id<"communities">; channelId: Id<"channels"> };

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
  return null;
}

function loadPinnedTargets(): TabTarget[] {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TabTarget[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePinnedTargets(tabs: Tab[]) {
  const pinned = tabs.filter((t) => t.pinned && t.target.type !== "home").map((t) => t.target);
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
    if (active.target.type !== "home") recordRecentView(active.target);
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
        const ordered = orderTabs(next);
        setActiveTabId((ordered[Math.max(0, idx - 1)] ?? HOME_TAB).id);
      }
    },
    [tabs, activeTabId]
  );

  const activateTab = useCallback((id: string) => {
    setActiveTabId(id);
  }, []);

  const togglePinTab = useCallback(
    (id: string) => {
      if (id === "home") return;
      const next = tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t));
      setTabs(next);
      savePinnedTargets(next);
    },
    [tabs]
  );

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? HOME_TAB;
  const ordered = useMemo(() => orderTabs(tabs), [tabs]);

  const value = useMemo(
    () => ({ tabs: ordered, activeTabId, activeTab, openTab, closeTab, activateTab, togglePinTab }),
    [ordered, activeTabId, activeTab, openTab, closeTab, activateTab, togglePinTab]
  );

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

export function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("useTabs must be used within <TabsProvider>");
  return ctx;
}

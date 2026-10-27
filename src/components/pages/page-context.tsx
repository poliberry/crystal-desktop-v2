"use client";

import { useCallback, useMemo } from "react";

import type { Id } from "../../../convex/_generated/dataModel";
import { useNavigation } from "@/components/home/navigation-context";
import { requestPageSection } from "@/lib/page-intent";
import {
  isPageTarget,
  useOptionalTabs,
  type PageTarget,
} from "@/components/home/tabs-context";

/**
 * Full pages that take over the main content area — Settings, the profile
 * editor, a community's settings — in place of the channel or conversation
 * that was there.
 *
 * They were dialogs, then an overlay held outside the tab strip. They are tabs
 * now (see `PageTarget` in `tabs-context.tsx`): they show in the tab bar, have
 * an address of their own so reload and back/forward work, and can sit open
 * next to the places you were in. This file is what the rest of the app calls
 * to open and close them, so none of it has to know that.
 */
export type AppPage = PageTarget;

interface PageContextValue {
  /** The page the active tab is, if it is one. */
  page: AppPage | null;
  openPage: (page: AppPage) => void;
  /** Closes the page's tab and goes back to where it was opened from. */
  closePage: () => void;
}

/** The open page, and how to open or close one. Inert outside the tabs — the
 * pop-out window mounts none of this. */
export function usePage(): PageContextValue {
  const tabs = useOptionalTabs();
  const nav = useNavigation();
  const activeTarget = tabs?.activeTab.target;
  const page = activeTarget && isPageTarget(activeTarget) ? activeTarget : null;
  const closeTab = tabs?.closeTab;
  const activeTabId = tabs?.activeTabId;

  const closePage = useCallback(() => {
    if (page && closeTab && activeTabId) closeTab(activeTabId);
  }, [page, closeTab, activeTabId]);

  return useMemo(
    () => ({ page, openPage: nav.openPage, closePage }),
    [page, nav.openPage, closePage],
  );
}

/** Opens Settings, optionally at one of its sections (`"billing"`,
 * `"subscriptions"`, `"creator"`…). */
export function useOpenSettings(): (section?: string) => void {
  const { openPage } = usePage();
  return useCallback(
    (section?: string) => {
      // Typed check: handed straight to `onClick`, the first argument is an event.
      if (typeof section === "string") requestPageSection("settings", section);
      openPage({ type: "settings" });
    },
    [openPage],
  );
}

/**
 * Opens the profile editor.
 *
 * Not a Settings tab: the editor is three panes wide and is opened to *do* one
 * thing, whereas Settings is a list of preferences you dip into. Everything
 * factual about the account — username, date of birth — lives in Settings →
 * Account instead.
 */
export function useOpenProfileEditor(): () => void {
  const { openPage } = usePage();
  return useCallback(() => openPage({ type: "profile-editor" }), [openPage]);
}

/** Opens a community's settings. */
export function useOpenCommunitySettings(): (communityId: Id<"communities">) => void {
  const { openPage } = usePage();
  return useCallback(
    (communityId) => openPage({ type: "community-settings", communityId }),
    [openPage],
  );
}

/** Opens the create-a-community flow. */
export function useOpenCreateCommunity(): () => void {
  const { openPage } = usePage();
  return useCallback(() => openPage({ type: "create-community" }), [openPage]);
}

/** Opens the shop, optionally on one of its pages. */
export function useOpenMarketplace(): (section?: string) => void {
  const { page, openPage, closePage } = usePage();
  return useCallback(
    (section?: string) => {
      if (typeof section === "string") requestPageSection("marketplace", section);
      // Hopping over from another page (Settings → Creator → My creations)
      // leaves that page behind, so the sidebar gives up its menu for the
      // shop's instead of both being left open as tabs.
      if (page && page.type !== "marketplace") closePage();
      openPage({ type: "marketplace" });
    },
    [page, openPage, closePage],
  );
}

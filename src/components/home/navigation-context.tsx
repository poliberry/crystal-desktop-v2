"use client";

import { createContext, useContext, useEffect, useMemo, useRef } from "react";

import type { Id } from "../../../convex/_generated/dataModel";
import type { PageTarget } from "@/components/home/tabs-context";

export interface NavigationActions {
  openConversation: (id: Id<"conversations">) => void;
  openCommunity: (id: Id<"communities">, channelId?: Id<"channels">) => void;
  goHome: () => void;
  /** A server's front page — the view its sidebar header's "Overview" opens. */
  openCommunityOverview: (id: Id<"communities">) => void;
  /** The moderation member list. The caller must have a moderation permission;
   * the sidebar only offers this to people who do. */
  openCommunityMembers: (id: Id<"communities">) => void;
  /** Settings, the profile editor or a community's settings, as a tab. */
  openPage: (page: PageTarget) => void;
}

const NOOP: NavigationActions = {
  openConversation: () => {},
  openCommunity: () => {},
  goHome: () => {},
  openCommunityOverview: () => {},
  openCommunityMembers: () => {},
  openPage: () => {},
};

const NavigationContext = createContext<{ current: NavigationActions } | null>(null);

/** Wraps TopNav + HomeLayout so the topbar's search can jump to a result
 * without lifting all of HomeLayout's view-switching state up into a shared
 * parent — HomeLayout registers its navigation callbacks here on mount. */
export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const ref = useRef<NavigationActions>(NOOP);
  return <NavigationContext.Provider value={ref}>{children}</NavigationContext.Provider>;
}

export function useRegisterNavigation(actions: NavigationActions) {
  const ctx = useContext(NavigationContext);
  useEffect(() => {
    if (ctx) ctx.current = actions;
  });
}

/**
 * Stable, and resolved when called rather than when rendered.
 *
 * The sidebar sits outside HomeLayout, so it renders before HomeLayout has
 * registered anything. Reading the ref's value during render would hand it the
 * no-op set until something happened to re-render it; looking the action up at
 * the moment of the click always finds the latest one.
 */
export function useNavigation(): NavigationActions {
  const ctx = useContext(NavigationContext);
  return useMemo(() => {
    const current = () => ctx?.current ?? NOOP;
    return {
      openConversation: (id) => current().openConversation(id),
      openCommunity: (id, channelId) => current().openCommunity(id, channelId),
      goHome: () => current().goHome(),
      openCommunityOverview: (id) => current().openCommunityOverview(id),
      openCommunityMembers: (id) => current().openCommunityMembers(id),
      openPage: (page) => current().openPage(page),
    };
  }, [ctx]);
}

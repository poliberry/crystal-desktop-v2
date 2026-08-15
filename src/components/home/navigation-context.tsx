"use client";

import { createContext, useContext, useEffect, useRef } from "react";

import type { Id } from "../../../convex/_generated/dataModel";

export interface NavigationActions {
  openConversation: (id: Id<"conversations">) => void;
  openCommunity: (id: Id<"communities">, channelId?: Id<"channels">) => void;
}

const NOOP: NavigationActions = {
  openConversation: () => {},
  openCommunity: () => {},
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

export function useNavigation(): NavigationActions {
  const ctx = useContext(NavigationContext);
  return ctx?.current ?? NOOP;
}

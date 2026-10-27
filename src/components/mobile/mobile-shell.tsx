"use client";

import { ChevronLeft, Mic, MicOff, Phone, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useAudioPreferences } from "@/components/audio-provider";
import { useCall } from "@/components/call/call-provider";
import { useCallTitle } from "@/components/call/use-call-title";
import { useTabs } from "@/components/home/tabs-context";
import { usePage } from "@/components/pages/page-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * Crystal on a phone: two screens instead of side-by-side panes, like a native chat app.
 *
 *  - "list": the sidebar, full width (chats, communities, DMs; or a page's menu, such as Settings).
 *  - "content": whatever is open (a conversation, a channel, Home, a settings section), full screen,
 *    with a back button.
 *
 * Navigation actions move between them (see home-layout's registered actions and `useMobileShell`), the
 * phone's back gesture returns to the list, and a tab bar sits along the bottom of the top-level screens.
 * Nothing here renders on a desktop-sized window, where the layout is unchanged.
 */

type View = "list" | "content";
type MobileShellValue = {
  mobile: boolean;
  view: View;
  showList: () => void;
  showContent: () => void;
};

const MobileShellContext = createContext<MobileShellValue>({ mobile: false, view: "content", showList: () => {}, showContent: () => {} });

export function useMobileShell() {
  return useContext(MobileShellContext);
}

export function MobileShellProvider({ children }: { children: React.ReactNode }) {
  const mobile = useIsMobile();
  const [view, setView] = useState<View>(() => (typeof window !== "undefined" && window.location.hash.length > 2 ? "content" : "list"));
  const showList = useCallback(() => setView("list"), []);
  const showContent = useCallback(() => setView("content"), []);

  // The phone's back gesture: the tab router turns it into "go to the previous place". Landing back on
  // Home (no hash) from a conversation means "back to my chats".
  useEffect(() => {
    if (!mobile) return;
    const onPop = () => {
      if (!window.location.hash || window.location.hash === "#") setView("list");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [mobile]);

  const value = useMemo(() => ({ mobile, view, showList, showContent }), [mobile, view, showList, showContent]);
  return <MobileShellContext.Provider value={value}>{children}</MobileShellContext.Provider>;
}

/** The back arrow, for headers that belong to a view (a chat, a channel). Renders nothing on desktop. */
export function MobileBackButton({ className }: { className?: string }) {
  const { mobile, showList } = useMobileShell();
  if (!mobile) return null;
  return (
    <button
      type="button"
      aria-label="Back"
      onClick={showList}
      className={cn("-ml-1.5 mr-0.5 flex size-10 shrink-0 items-center justify-center rounded-full text-foreground/90 active:bg-foreground/10", className)}
    >
      <ChevronLeft className="size-6" />
    </button>
  );
}

/** A header for content screens that don't draw their own (Home, Friends, a settings section…). */
export function MobileContentHeader() {
  const { showList } = useMobileShell();
  const { activeTab } = useTabs();
  const { page } = usePage();
  const target = activeTab.target;
  if (target.type === "dm" || target.type === "channel") return null;
  const title = page ? pageTitle(page.type) : "Home";
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border/60 px-2">
      <button type="button" aria-label="Back" onClick={showList} className="flex size-10 items-center justify-center rounded-full active:bg-foreground/10">
        <ChevronLeft className="size-6" />
      </button>
      <span className="truncate text-base font-semibold">{title}</span>
    </div>
  );
}

/** Room for the home indicator under a content screen (a conversation's composer, a page). */
export function MobileBottomInset() {
  return <div aria-hidden className="h-[env(safe-area-inset-bottom)] shrink-0" />;
}

/**
 * The call you're in, as Discord's phone app shows it: a bar above the tab bar on the list screen.
 * Tapping it opens the full call screen; mute and hang up work from the bar. Stands in for the
 * desktop sidebar's call card, which phones don't show.
 */
export function MobileCallBar() {
  const { activeCall, controller, expand, leaveCall } = useCall();
  const { muted, toggleMuted } = useAudioPreferences();
  const title = useCallTitle(activeCall);
  if (!activeCall) return null;
  const connected = controller.status === "connected";
  return (
    <div className="shrink-0 px-2 pb-2">
      <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 py-1.5 pr-1.5 pl-3">
        <button type="button" onClick={expand} className="flex min-w-0 flex-1 flex-col items-start text-left">
          <span className={cn("text-xs font-semibold", connected ? "text-emerald-400" : "text-amber-400")}>
            {connected ? "Voice Connected" : "Connecting…"}
          </span>
          <span className="w-full truncate text-xs text-muted-foreground">{title}</span>
        </button>
        <button
          type="button"
          onClick={toggleMuted}
          aria-label={muted ? "Unmute" : "Mute"}
          className={cn("flex size-9 items-center justify-center rounded-full bg-foreground/10", muted && "text-destructive")}
        >
          {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
        </button>
        <button
          type="button"
          onClick={() => void leaveCall()}
          aria-label="Leave call"
          className="flex size-9 items-center justify-center rounded-full bg-destructive text-white"
        >
          <Phone className="size-4 rotate-135" />
        </button>
      </div>
    </div>
  );
}

/** Pages with a menu of their own (Settings and the like). On a phone they open as a full bottom sheet:
 * the menu first, then the picked section in the same sheet. */
export const SHEET_PAGES = new Set(["settings", "marketplace", "profile-editor", "community-settings"]);

const PAGE_TITLES: Record<string, string> = {
  settings: "Settings",
  "profile-editor": "Edit profile",
  "create-community": "New community",
  marketplace: "Shop",
  search: "Search",
  "community-settings": "Community settings",
};

export function pageTitle(type: string | undefined): string {
  return (type && PAGE_TITLES[type]) || "Crystal";
}

/** The top of a bottom drawer, under its grab handle: the title, Back (in a section) and Close. */
export function MobileSheetHeader({ title, onBack, onClose }: { title: string; onBack?: () => void; onClose: () => void }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 px-2">
      {onBack ? (
        <button type="button" aria-label="Back" onClick={onBack} className="flex size-10 items-center justify-center rounded-full active:bg-foreground/10">
          <ChevronLeft className="size-6" />
        </button>
      ) : (
        <span className="size-10" />
      )}
      <span className="min-w-0 flex-1 truncate text-center text-base font-semibold">{title}</span>
      <button type="button" aria-label="Close" onClick={onClose} className="flex size-10 items-center justify-center rounded-full active:bg-foreground/10">
        <X className="size-5" />
      </button>
    </div>
  );
}

/**
 * Calls `onPick` when an entry in a page's menu is picked. A native capture listener rather than onClick:
 * the page puts its menu in through a portal, whose events React sends up through the page, not here.
 */
export function useMenuTap(onPick: () => void) {
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  return useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    node.addEventListener(
      "click",
      (event) => {
        const hit = (event.target as HTMLElement).closest("button, a, [role=menuitem], [role=tab], [role=option]");
        if (hit && !hit.closest("[data-mobile-stay]") && !hit.matches("[aria-expanded]")) window.setTimeout(() => pickRef.current(), 0);
      },
      true,
    );
  }, []);
}

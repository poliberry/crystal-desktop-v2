"use client";

import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Gem, ShoppingBag, Sparkles, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import { useCall } from "@/components/call/call-provider";

import { useNavigation } from "@/components/home/navigation-context";
import { useTabs } from "@/components/home/tabs-context";
import { NotificationInbox } from "@/components/home/notification-inbox";
import { LogoMark } from "@/components/logo-mark";
import { useOpenMarketplace, useOpenSettings, usePage, type AppPage } from "@/components/pages/page-context";
import { PageSidebarSlot } from "@/components/pages/page-sidebar";
import { CommunitiesSection } from "@/components/sidebar/communities-section";
import { useTrafficLightsInset } from "@/hooks/use-window-controls";
import { SidebarDock } from "@/components/sidebar/dock";
import { useHomeSurface } from "@/components/home/home-surface";
import { SidebarResizeHandle } from "@/components/sidebar/resizable-sidebar";
import { DmSection } from "@/components/sidebar/dm-section";
import { PrioritySection } from "@/components/sidebar/priority-section";
import { SidebarSearch } from "@/components/sidebar/sidebar-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { FOCUS_MESSAGE_SEARCH_EVENT } from "@/lib/command-events";
import { SHEET_PAGES, useMobileShell } from "@/components/mobile/mobile-shell";

function NavButton({
  icon: Icon,
  label,
  active,
  soon,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  /** Not built yet: shown so people know it's coming, but not clickable. */
  soon?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={soon}
      onClick={onClick}
      className={cn(
        "relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl border border-transparent px-1 py-2 text-[11px] font-medium transition-colors",
        soon
          ? "cursor-not-allowed text-muted-foreground/60"
          : "text-muted-foreground hover:bg-white/10 hover:text-foreground",
        active && "border-white/10 bg-white/10 text-foreground",
      )}
    >
      <Icon className="size-4" />
      <span className="max-w-full truncate">{label}</span>
      {soon && (
        <Badge
          variant="outline"
          className="absolute -top-1.5 right-0 h-4 px-1 text-[9px] leading-none"
        >
          Soon
        </Badge>
      )}
    </button>
  );
}

/** How far the menus travel as one hands over to the other, in px. */
const SLIDE = 24;
const SLIDE_TRANSITION = { type: "spring" as const, stiffness: 420, damping: 34 };

/** What the sidebar calls the page whose menu it is showing. */
function PageTitle({ page }: { page: AppPage }) {
  const community = useQuery(
    api.communities.get,
    page.type === "community-settings" ? { communityId: page.communityId } : "skip",
  );
  const title =
    page.type === "settings"
      ? "Settings"
      : page.type === "profile-editor"
        ? "Edit profile"
        : page.type === "create-community"
          ? "New community"
          : page.type === "marketplace"
          ? "Marketplace"
          : page.type === "search"
            ? "Search"
            : (community?.name ?? "Community settings");
  const subtitle = page.type === "community-settings" ? "Community settings" : null;

  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold">{title}</p>
      {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

/**
 * The contents of the unified sidebar: the logo, search and the three
 * destinations at the top; Priority, Communities and Direct messages in the
 * middle; and the user card with whatever is stacked above it at the bottom.
 *
 * While a page is open (Settings, the profile editor, a community's settings)
 * the middle swaps for that page's own menu, under a back button that closes the
 * page. The main sidebar is hidden rather than unmounted, so the community that
 * was unfolded and the scroll position are still there when you come back.
 *
 * Meant to be the child of the shadcn `<Sidebar>`, which supplies the floating
 * frame and the collapse behaviour.
 */
export function UnifiedSidebar() {
  const nav = useNavigation();
  const { activeTab } = useTabs();
  // Set by the dock while its stack is spread open. Everything else is blurred
  // so the spread list is the only thing in focus.
  const [dockExpanded, setDockExpanded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchOverlayRef = useRef<HTMLDivElement>(null);
  const { page, closePage } = usePage();
  const homeSurface = useHomeSurface();
  const shell = useMobileShell();
  const showContentRef = useRef(shell.showContent);
  showContentRef.current = shell.mobile ? shell.showContent : () => {};
  const pageMenuRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    node.addEventListener(
      "click",
      (event) => {
        const hit = (event.target as HTMLElement).closest("button, a, [role=menuitem], [role=tab], [role=option]");
        if (hit && !hit.closest("[data-mobile-stay]") && !hit.matches("[aria-expanded]")) window.setTimeout(() => showContentRef.current(), 0);
      },
      true,
    );
  }, []);
  const openMarketplace = useOpenMarketplace();
  const openSettings = useOpenSettings();
  const { activeCall, expanded } = useCall();
  // A page the call screen is covering isn't on screen, so its menu has no
  // business being either.
  // Search is a main-content page, but the sidebar should keep its normal
  // navigation context while results are open.
  // On a phone, Settings and the other menu pages open in their own bottom sheet (see app-home), with
  // the menu inside it; the sidebar stays on chats underneath.
  const pageMenu =
    page && page.type !== "search" && !(expanded && activeCall) && !(shell.mobile && SHEET_PAGES.has(page.type)) ? page : null;
  // The system's window buttons sit in this sidebar's top-left corner. Both
  // menus start underneath them rather than beside them.
  const trafficLights = useTrafficLightsInset();
  const topPadding = trafficLights ? "pt-12" : "pt-3";
  const blurred = dockExpanded && "pointer-events-none opacity-60 blur-sm select-none";
  const activateSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  useEffect(() => {
    const focusSearch = () => setSearchOpen(true);
    window.addEventListener(FOCUS_MESSAGE_SEARCH_EVENT, focusSearch);
    return () => window.removeEventListener(FOCUS_MESSAGE_SEARCH_EVENT, focusSearch);
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const frame = window.requestAnimationFrame(() => {
      searchOverlayRef.current?.querySelector<HTMLInputElement>("[data-sidebar-message-search]")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen]);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <SidebarResizeHandle />
      {/* The two menus are laid over each other, so one can leave while the
          other arrives. Forwards, the main menu slides off to the left as the
          page's slides in from the right; back, the same in reverse. */}
      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden transition-[filter,opacity] duration-200",
          blurred,
        )}
      >
      <AnimatePresence initial={false}>
        {pageMenu && (
          <motion.div
            key="page"
            initial={{ opacity: 0, x: SLIDE }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: SLIDE }}
            transition={SLIDE_TRANSITION}
            className={cn("absolute inset-0 z-10 flex flex-col gap-2", topPadding)}
          >
            <div className="flex items-center gap-2 px-3">
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label="Back"
                title="Back (Esc)"
                onClick={closePage}
              >
                <ArrowLeft className="size-4" />
              </Button>
              <PageTitle page={pageMenu} />
            </div>
            <div className="px-3">
              <SidebarSearch value={searchQuery} onChange={setSearchQuery} onActivate={activateSearch} onClose={closeSearch} />
            </div>
            {/* Filled by the page itself — see `PageSidebar`. On a phone, the menu is a screen of its own:
                picking an entry (a button or link in it) shows that entry's content. */}
            {/* A native listener, not React's onClick: the page puts its menu here through a portal, and React
                sends a portal's events up through the component that rendered it, not through this element. */}
            <div className="flex min-h-0 flex-1 flex-col" ref={pageMenuRef}>
              <PageSidebarSlot className="flex min-h-0 flex-1 flex-col" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={false}
        animate={
          pageMenu
            ? { opacity: 0, x: -SLIDE, transitionEnd: { display: "none" } }
            : { opacity: 1, x: 0, display: "flex" }
        }
        transition={SLIDE_TRANSITION}
        // Hidden rather than unmounted once it has left, so the community that
        // was unfolded and the scroll position are there when it comes back.
        inert={!!pageMenu}
        className={cn("absolute inset-0 flex flex-col gap-3", topPadding)}
      >
        <div className="flex flex-col gap-3 px-3">
          <div className="flex items-center gap-2">
            <LogoMark className="size-7" />
            <Badge className="rounded-full" variant="outline">
              BETA
            </Badge>
            <div className="ml-auto">
              <NotificationInbox />
            </div>
          </div>

          <SidebarSearch value={searchQuery} onChange={setSearchQuery} onActivate={activateSearch} onClose={closeSearch} />

          {/* My Crystal and Friends are separate places; Settings → Appearance → Home page only picks
              which one Crystal opens on. */}
          <div className="flex gap-1">
            <NavButton
              icon={Sparkles}
              label="My Crystal"
              active={!page && activeTab.target.type === "home" && homeSurface === "my-crystal"}
              onClick={nav.openMyCrystal}
            />
            <NavButton
              icon={Users}
              label="Friends"
              active={!page && activeTab.target.type === "home" && homeSurface === "friends"}
              onClick={nav.openFriends}
            />
            <NavButton icon={ShoppingBag} label="Marketplace" active={page?.type === "marketplace"} onClick={openMarketplace} />
            <NavButton icon={Gem} label="Subscriptions" onClick={() => openSettings("subscriptions")} />
          </div>
        </div>

        {/* Radix wraps the content in a `display: table` box that grows to fit its
            widest line, so one long unbroken string (an invite link in a DM
            preview) widened the whole column past the sidebar and got it
            clipped. Making that box a block pins it to the viewport's width, and
            the previews' own truncation then does its job. */}
        <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block">
          <div className="flex min-w-0 flex-col gap-4 px-3 pb-3">
            <PrioritySection />
            <CommunitiesSection />
            <DmSection />
          </div>
        </ScrollArea>
      </motion.div>
      </div>

      {/* Phones have the You tab for the user card and a call bar for the call (see MobileCallBar). */}
      {!shell.mobile && <SidebarDock onExpandedChange={setDockExpanded} />}
      {searchOpen && (
        <div className="absolute inset-0 z-50">
          <button
            type="button"
            aria-label="Close message search"
            className="absolute inset-0 bg-background/45 backdrop-blur-md"
            onClick={closeSearch}
          />
          <div ref={searchOverlayRef} className={cn("absolute inset-x-0 px-3", topPadding)}>
            <SidebarSearch
              value={searchQuery}
              onChange={setSearchQuery}
              onActivate={activateSearch}
              onClose={closeSearch}
              autoFocus
            />
          </div>
        </div>
      )}
    </div>
  );
}

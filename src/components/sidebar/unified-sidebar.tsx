"use client";

import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ShoppingBag, Sparkles, Users } from "lucide-react";
import { useState } from "react";

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
import { SidebarResizeHandle } from "@/components/sidebar/resizable-sidebar";
import { DmSection } from "@/components/sidebar/dm-section";
import { PrioritySection } from "@/components/sidebar/priority-section";
import { SidebarSearch } from "@/components/sidebar/sidebar-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

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
        "relative flex flex-1 flex-col items-center gap-1 rounded-xl border border-transparent px-1 py-2 text-xs font-medium transition-colors",
        soon
          ? "cursor-not-allowed text-muted-foreground/60"
          : "text-muted-foreground hover:bg-white/10 hover:text-foreground",
        active && "border-white/10 bg-white/10 text-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
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
  const { page, closePage } = usePage();
  const openMarketplace = useOpenMarketplace();
  const openSettings = useOpenSettings();
  const { activeCall, expanded } = useCall();
  // A page the call screen is covering isn't on screen, so its menu has no
  // business being either.
  const pageMenu = page && !(expanded && activeCall) ? page : null;
  // The system's window buttons sit in this sidebar's top-left corner. Both
  // menus start underneath them rather than beside them.
  const trafficLights = useTrafficLightsInset();
  const topPadding = trafficLights ? "pt-12" : "pt-3";
  const blurred = dockExpanded && "pointer-events-none opacity-60 blur-sm select-none";

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
            {/* Filled by the page itself — see `PageSidebar`. */}
            <PageSidebarSlot className="flex min-h-0 flex-1 flex-col" />
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

          <SidebarSearch />

          <div className="flex gap-1">
            <NavButton icon={ShoppingBag} label="Marketplace" active={page?.type === "marketplace"} onClick={openMarketplace} />
            <NavButton icon={Sparkles} label="Subscriptions" onClick={() => openSettings("subscriptions")} />
            <NavButton
              icon={Users}
              label="Friends"
              active={activeTab.target.type === "home"}
              onClick={nav.goHome}
            />
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

      <SidebarDock onExpandedChange={setDockExpanded} />
    </div>
  );
}

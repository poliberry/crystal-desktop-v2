"use client";

import { useMutation, useQuery } from "convex/react";
import { Cake, Plus } from "lucide-react";
import { useState } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useOpenCreateCommunity } from "@/components/pages/page-context";
import { useUiPreferences } from "@/components/ui-preferences-provider";
import { useBirthday } from "@/components/home/birthday-provider";
import { useNavigation } from "@/components/home/navigation-context";
import { TabBar } from "@/components/home/tab-bar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { UpdateIndicator } from "@/components/update-indicator";
import { useRightSidebarShown } from "@/components/sidebar/right-sidebar";
import { useReservesWindowControls, WINDOW_CONTROLS_WIDTH } from "@/components/window-controls-dock";
import { Menu01Icon } from "@animateicons/react/huge";
import { SidebarTrigger, useSidebar } from "./ui/sidebar";
import { cn } from "@/lib/utils";
import { hasNativeWindowControls, useTrafficLightsInset } from "@/hooks/use-window-controls";

/**
 * Replays the birthday celebration.
 *
 * Only on screen during the birthday's own window, so it isn't a permanent
 * button that does nothing for 362 days of the year.
 */
function BirthdayButton() {
  const { inWindow, isToday, celebrate } = useBirthday();
  if (!inWindow) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={celebrate}
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            className="pointer-events-auto relative flex size-6 shrink-0 items-center justify-center rounded-md text-amber-300 opacity-80 transition-opacity hover:bg-accent/60 hover:opacity-100"
            aria-label="Replay your birthday celebration"
          >
            <Cake className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {isToday ? "Happy birthday!" : "Replay your birthday"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function CommunitiesPopover() {
  const [open, setOpen] = useState(false);
  const openCreateCommunity = useOpenCreateCommunity();

  const communities = useQuery(api.communities.listMine) ?? [];
  const nav = useNavigation();

  const handleSelectCommunity = (id: Id<"communities">) => {
    nav.openCommunity(id);
    setOpen(false);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                  className="flex size-6 items-center pointer-events-auto justify-center rounded-md text-muted-foreground opacity-70 transition-opacity hover:bg-accent/60 hover:opacity-100"
                  aria-label="Communities"
                >
                  <Menu01Icon duration={0.5} className="size-5" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">Communities</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={8}
          className="w-72 p-2"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {communities.length > 0 ? (
            <>
              <p className="mb-1 px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Communities
              </p>
              <div className="grid grid-cols-3 gap-1">
                {communities.map((community: any) => (
                  <button
                    type="button"
                    key={community.id}
                    onClick={() => handleSelectCommunity(community.id)}
                    className="flex flex-col cursor-pointer items-center gap-1 rounded-md p-2 hover:bg-accent/60"
                  >
                    <Avatar className="size-10">
                      <AvatarImage
                        className="rounded-md"
                        src={community.imageUrl}
                        alt={community.name}
                      />
                      <AvatarFallback className="text-xs rounded-md">
                        {community.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="w-full truncate text-center text-[11px] text-muted-foreground">
                      {community.name}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="py-3 text-center text-xs text-muted-foreground">
              No communities yet.
            </p>
          )}

          <div className="mt-2 flex gap-1 border-t pt-2">
            <button
              type="button"
              onClick={() => {
                openCreateCommunity();
                setOpen(false);
              }}
              className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/60"
            >
              <Plus className="size-3.5" />
              Create
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

export function TopNav() {
  const { communityNavStyle: style, tabsEnabled } = useUiPreferences();
  const nav = useNavigation();
  const { state } = useSidebar();
  // With the sidebar out of the way the window's top-left corner is this bar's,
  // and the system's window buttons are in it.
  const trafficLights = useTrafficLightsInset();
  const clearOfLights = state === "collapsed" ? trafficLights : 0;
  // Tall enough that what is in the bar sits on the same line as the lights,
  // which are inset from the corner. And with no window buttons of ours at the
  // right-hand end, the buttons there need their own margin from the edge.
  const nativeControls = hasNativeWindowControls();
  const sidebarShown = useRightSidebarShown();
  const reserveCorner = useReservesWindowControls() && !sidebarShown;

  return (
    <header
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      className={cn(
        "relative flex shrink-0 items-center justify-between gap-2 bg-background z-[99]",
        trafficLights ? "h-12" : "h-8",
        nativeControls && "pr-4",
      )}
    >
      <div
        className="flex shrink-0 items-center gap-2 ml-2"
        style={
          {
            WebkitAppRegion: "no-drag",
            marginLeft: clearOfLights || undefined,
          } as React.CSSProperties
        }
      >
        <SidebarTrigger />
        {style === "popover" && (
          <>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => nav.goHome()}
                    className="flex size-6 pointer-events-auto shrink-0 items-center justify-center opacity-80 transition-opacity hover:opacity-100"
                    aria-label="Home"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/logo-mark.svg"
                      alt="Crystal"
                      className="min-w-4"
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Home</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <CommunitiesPopover />
          </>
        )}
      </div>

      {tabsEnabled ? <TabBar /> : <div className="flex-1" />}

      <UpdateIndicator />

      <BirthdayButton />

      {/* The window's buttons are fixed to the corner (WindowControlsDock). When the details sidebar is open that corner is
          the top of its column; otherwise it is this bar's end, and this keeps the bar's contents clear of it. */}
      {reserveCorner && <div aria-hidden className="shrink-0" style={{ width: WINDOW_CONTROLS_WIDTH }} />}
    </header>
  );
}

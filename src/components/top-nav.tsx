"use client";

import { useMutation, useQuery } from "convex/react";
import { Cake, Plus } from "lucide-react";
import { useState } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CreateCommunityDialog } from "@/components/community/create-community-dialog";
import { useUiPreferences } from "@/components/ui-preferences-provider";
import { GlobalSearch } from "@/components/home/global-search";
import { useBirthday } from "@/components/home/birthday-provider";
import { NotificationInbox } from "@/components/home/notification-inbox";
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
import { WindowControls } from "@/components/window-controls";

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
  const [createOpen, setCreateOpen] = useState(false);

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
                  <img
                    src="/icons/chat-bubbles.png"
                    alt="Communities"
                    className="w-7"
                  />
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
                setCreateOpen(true);
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

      <CreateCommunityDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          nav.openCommunity(id);
        }}
      />
    </>
  );
}

export function TopNav() {
  const { communityNavStyle: style, tabsEnabled } = useUiPreferences();
  const nav = useNavigation();

  return (
    <header
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      className="relative flex h-10 shrink-0 items-center justify-between gap-2 border-b bg-accent/40 backdrop-blur-xl pl-3 z-[99]"
    >
      <div
        className="flex shrink-0 items-center gap-1.5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {style === "popover" && (
          <>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => nav.goHome()}
                    className="flex size-5 pointer-events-auto shrink-0 items-center justify-center opacity-80 transition-opacity hover:opacity-100"
                    aria-label="Home"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo-mark.png" alt="Crystal" className="min-w-7" />
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

      <NotificationInbox />

      <GlobalSearch />

      <WindowControls className="ml-1 z-[999] pointer-events-auto" />
    </header>
  );
}

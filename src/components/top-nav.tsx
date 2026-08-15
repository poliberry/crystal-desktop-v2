"use client";

import { useMutation, useQuery } from "convex/react";
import { Compass, LayoutGrid, MessagesSquare, Plus } from "lucide-react";
import { useState } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { CreateCommunityDialog } from "@/components/community/create-community-dialog";
import { GlobalSearch } from "@/components/home/global-search";
import { useNavigation } from "@/components/home/navigation-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UpdateIndicator } from "@/components/update-indicator";
import { WindowControls } from "@/components/window-controls";

function normalizeInviteInput(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("joincrystal:") ? trimmed.slice("joincrystal:".length) : trimmed;
}

function CommunitiesPopover() {
  const [open, setOpen] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteInput, setInviteInput] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [joiningByCode, setJoiningByCode] = useState(false);

  const communities = useQuery(api.communities.listMine) ?? [];
  const discoverable = useQuery(api.communities.listDiscoverable, discoverOpen ? {} : "skip") ?? [];
  const join = useMutation(api.communities.join);
  const joinByInviteCode = useMutation(api.communities.joinByInviteCode);
  const nav = useNavigation();

  const handleSelectCommunity = (id: Id<"communities">) => {
    nav.openCommunity(id);
    setOpen(false);
  };

  const handleJoinByCode = async () => {
    const code = normalizeInviteInput(inviteInput);
    if (!code) return;
    setJoiningByCode(true);
    setInviteError(null);
    try {
      const communityId = await joinByInviteCode({ code });
      setDiscoverOpen(false);
      setOpen(false);
      setInviteInput("");
      nav.openCommunity(communityId);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Couldn't join with that code.");
    } finally {
      setJoiningByCode(false);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-opacity hover:bg-accent/60 hover:opacity-100"
                aria-label="Communities"
              >
                <MessagesSquare className="size-4" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Communities</TooltipContent>
        </Tooltip>

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
                {communities.map((community) => (
                  <button
                    type="button"
                    key={community.id}
                    onClick={() => handleSelectCommunity(community.id)}
                    className="flex flex-col cursor-pointer items-center gap-1 rounded-md p-2 hover:bg-accent/60"
                  >
                    <Avatar className="size-10">
                      <AvatarImage className="rounded-md" src={community.imageUrl} alt={community.name} />
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
            <p className="py-3 text-center text-xs text-muted-foreground">No communities yet.</p>
          )}

          <div className="mt-2 flex gap-1 border-t pt-2">
            {/*<button
              type="button"
              onClick={() => { setDiscoverOpen(true); setOpen(false); }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/60"
            >
              <Compass className="size-3.5" />
              Discover
            </button>*/}
            <button
              type="button"
              onClick={() => { setCreateOpen(true); setOpen(false); }}
              className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/60"
            >
              <Plus className="size-3.5" />
              Create
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={discoverOpen} onOpenChange={setDiscoverOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discover communities</DialogTitle>
            <DialogDescription>Every community is open to join for now.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Enter an invite code"
              value={inviteInput}
              onChange={(e) => { setInviteInput(e.target.value); setInviteError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") void handleJoinByCode(); }}
            />
            <Button disabled={!inviteInput.trim() || joiningByCode} onClick={() => void handleJoinByCode()}>
              Join
            </Button>
          </div>
          {inviteError && <p className="text-xs text-destructive">{inviteError}</p>}
          <Separator />
          <ScrollArea className="h-72">
            <div className="flex flex-col gap-1 pr-3">
              {discoverable.length === 0 && (
                <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                  No new communities to join.
                </p>
              )}
              {discoverable.map((community) => (
                <div key={community.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/60">
                  <Avatar size="sm">
                    <AvatarImage src={community.imageUrl} alt={community.name} />
                    <AvatarFallback>{community.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{community.name}</p>
                  <Button
                    size="sm"
                    onClick={() => {
                      void join({ communityId: community.id });
                      setDiscoverOpen(false);
                      nav.openCommunity(community.id);
                    }}
                  >
                    Join
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <CreateCommunityDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => { nav.openCommunity(id); }}
      />
    </>
  );
}

export function TopNav() {
  const nav = useNavigation();

  return (
    <header
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      className="flex h-10 shrink-0 items-center justify-between gap-2 border-b bg-background pl-3"
    >
      <div
        className="flex items-center gap-1.5"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => nav.goHome()}
              className="flex size-5 shrink-0 items-center justify-center opacity-80 transition-opacity hover:opacity-100"
              aria-label="Home"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-mark.png" alt="Crystal" className="min-w-7" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Home</TooltipContent>
        </Tooltip>

        <CommunitiesPopover />
      </div>

      <div className="flex flex-1 justify-center">
        <GlobalSearch />
      </div>

      <UpdateIndicator />

      <WindowControls className="ml-1" />
    </header>
  );
}

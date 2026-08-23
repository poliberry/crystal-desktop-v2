"use client";

import { useMutation, useQuery } from "convex/react";
import { Compass, Home, Volume2 } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CreateCommunityDialog } from "@/components/community/create-community-dialog";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { USER_CARD_HEIGHT } from "./user-card";
import { useCall } from "../call/call-provider";

/** Strips an optional "joincrystal:" prefix so pasting a full invite string
 * (copied straight from the Invite dialog) works the same as a bare code. */
function normalizeInviteInput(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("joincrystal:")
    ? trimmed.slice("joincrystal:".length)
    : trimmed;
}

function RailButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={active ? "default" : "secondary"}
            size="icon"
            className="size-12 rounded-none"
            onClick={onClick}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function DiscoverDialog({
  onJoined,
}: {
  onJoined: (id: Id<"communities">) => void;
}) {
  const [open, setOpen] = useState(false);
  const [inviteInput, setInviteInput] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [joiningByCode, setJoiningByCode] = useState(false);
  const discoverable =
    useQuery(api.communities.listDiscoverable, open ? {} : "skip") ?? [];
  const join = useMutation(api.communities.join);
  const joinByInviteCode = useMutation(api.communities.joinByInviteCode);

  const handleJoinByCode = async () => {
    const code = normalizeInviteInput(inviteInput);
    if (!code) return;
    setJoiningByCode(true);
    setInviteError(null);
    try {
      const communityId = await joinByInviteCode({ code });
      setOpen(false);
      setInviteInput("");
      onJoined(communityId);
    } catch (err) {
      setInviteError(
        err instanceof Error ? err.message : "Couldn't join with that code.",
      );
    } finally {
      setJoiningByCode(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <RailButton label="Discover communities" onClick={() => setOpen(true)}>
        <Compass />
      </RailButton>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discover communities</DialogTitle>
          <DialogDescription>
            Every community is open to join for now.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            placeholder="Enter an invite code"
            value={inviteInput}
            onChange={(e) => {
              setInviteInput(e.target.value);
              setInviteError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleJoinByCode();
            }}
          />
          <Button
            disabled={!inviteInput.trim() || joiningByCode}
            onClick={() => void handleJoinByCode()}
          >
            Join
          </Button>
        </div>
        {inviteError && (
          <p className="text-xs text-destructive">{inviteError}</p>
        )}

        <Separator />

        <ScrollArea className="h-72">
          <div className="flex flex-col gap-1 pr-3">
            {discoverable.length === 0 && (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                No new communities to join.
              </p>
            )}
            {discoverable.map((community) => (
              <div
                key={community.id}
                className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/60"
              >
                <Avatar size="sm">
                  <AvatarImage src={community.imageUrl} alt={community.name} />
                  <AvatarFallback>
                    {community.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <p className="min-w-0 flex-1 truncate text-sm font-medium">
                  {community.name}
                </p>
                <Button
                  size="sm"
                  onClick={() => {
                    void join({ communityId: community.id });
                    setOpen(false);
                    onJoined(community.id);
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
  );
}

interface CommunityActivity {
  memberCount: number;
  voice: { userId: Id<"users">; name: string; imageUrl?: string }[];
  voiceCount: number;
}

/**
 * What a server's rail tile shows on hover: its name, how big it is, and
 * who's in voice right now.
 *
 * A hover card rather than a tooltip because of the voice row — a stack of
 * faces answers "is anyone I know in there" at a glance in a way a count
 * doesn't, and tooltip styling (small, dense, built for one line) fights
 * that.
 */
function CommunityCardBody({
  name,
  activity,
}: {
  name: string;
  activity: CommunityActivity | undefined;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="truncate text-sm font-semibold">{name}</p>
        {activity && (
          <p className="text-xs text-muted-foreground">
            {activity.memberCount} {activity.memberCount === 1 ? "member" : "members"}
          </p>
        )}
      </div>

      {!!activity?.voiceCount && (
        <div className="space-y-1.5 border-t border-border/50 pt-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-500">
            <Volume2 className="size-3.5" />
            {activity.voiceCount} in voice
          </p>
          <AvatarGroup data-size="sm">
            {activity.voice.map((participant) => (
              <Avatar key={participant.userId} size="sm" title={participant.name}>
                <AvatarImage src={participant.imageUrl} alt={participant.name} />
                <AvatarFallback className="text-[8px]">
                  {participant.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ))}
            {activity.voiceCount > activity.voice.length && (
              <AvatarGroupCount className="text-[10px]">
                +{activity.voiceCount - activity.voice.length}
              </AvatarGroupCount>
            )}
          </AvatarGroup>
        </div>
      )}
    </div>
  );
}

interface CommunityRailProps {
  selectedCommunityId: Id<"communities"> | null;
  onSelectHome: () => void;
  /** Default click replaces the active tab (mode omitted/"replace"); shift-
   * click or the right-click menu can request "new" to open alongside it
   * instead. */
  onSelectCommunity: (id: Id<"communities">, mode?: "replace" | "new") => void;
  /** Whether replacing the active tab is actually possible. False when the
   * active tab is pinned (pinned tabs are never silently swapped out, so
   * "replace" would quietly open a new tab instead) — the right-click menu
   * hides that option rather than offering a misleading one. */
  canOpenInCurrentTab: boolean;
  /** Communities that already have a channel tab open. Opening one of these
   * just focuses that existing tab (tab ids derive from their target, so the
   * same channel can't be open twice) — so the menu collapses to a single
   * "Open tab" item rather than two entries that would do the same thing. */
  openCommunityIds: Set<Id<"communities">>;
}

export function CommunityRail({
  selectedCommunityId,
  onSelectHome,
  onSelectCommunity,
  canOpenInCurrentTab,
  openCommunityIds,
}: CommunityRailProps) {
  const {
    activeCall,
    controller,
    expand,
    leaveCall,
    sharedSourceName,
    openSharePicker,
  } = useCall();
  const {
    cameraEnabled,
    microphoneEnabled,
    screenSharing,
    toggleCamera,
    toggleMicrophone,
    toggleScreenShare,
  } = controller;
  const communities = useQuery(api.communities.listMine) ?? [];
  const activityByCommunity = new Map(
    (useQuery(api.communities.listMineActivity) ?? []).map((entry) => [
      entry.communityId as string,
      entry,
    ])
  );

  return (
    <div className={cn(
      `flex w-18 shrink-0 flex-col items-center gap-2 bg-background/60 py-3`,
      activeCall && screenSharing ? `mb-52` : activeCall ? `mb-42` : `mb-18`
    )}>
      <RailButton
        label="Direct messages"
        active={!selectedCommunityId}
        onClick={onSelectHome}
      >
        <Home />
      </RailButton>

      <Separator className="max-w-8 mx-2" />

      <ScrollArea className="min-h-0 flex-1 w-full">
        {/* py-1 gives the selection ring (ring-2 + ring-offset-2 = ~4px)
            room to render without the ScrollArea's own overflow-hidden
            viewport clipping it off the first/last item. */}
        <div className="flex flex-col items-center gap-2 px-2 py-1">
          {communities.map((community) => {
            const activity = activityByCommunity.get(community.id);
            const inVoice = !!activity?.voiceCount;
            return (
            <HoverCard key={community.id} openDelay={200} closeDelay={100}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    {/* The badge sits outside the button because the button
                        clips its contents — that's what gives the tile its
                        square-to-squircle morph on hover. */}
                    <div className="relative">
                    <HoverCardTrigger asChild>
                      <button
                        type="button"
                        aria-label={
                          inVoice ? `${community.name}, call in progress` : community.name
                        }
                        onClick={(e) => onSelectCommunity(community.id, e.shiftKey ? "new" : "replace")}
                        className={cn(
                          "flex size-12 items-center justify-center overflow-hidden rounded-none bg-secondary transition-[border-radius] ease-in-out hover:rounded-2xl",
                          selectedCommunityId === community.id &&
                            "ring-2 ring-primary ring-offset-2 ring-offset-background rounded-2xl",
                        )}
                      >
                        <Avatar className="size-12 rounded-none">
                          <AvatarImage
                            src={community.imageUrl}
                            alt={community.name}
                            className="rounded-none"
                          />
                          <AvatarFallback className="rounded-none text-sm">
                            {community.name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    </HoverCardTrigger>
                    {inVoice && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white ring-2 ring-background"
                      >
                        <Volume2 className="size-3" />
                      </span>
                    )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    {canOpenInCurrentTab && !openCommunityIds.has(community.id) && (
                      <ContextMenuItem onClick={() => onSelectCommunity(community.id, "replace")}>
                        Open in current tab
                      </ContextMenuItem>
                    )}
                    <ContextMenuItem onClick={() => onSelectCommunity(community.id, "new")}>
                      {openCommunityIds.has(community.id) ? "Open tab" : "Open in new tab"}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                <HoverCardContent side="right" align="start" className="w-60">
                  <CommunityCardBody name={community.name} activity={activity} />
                </HoverCardContent>
            </HoverCard>
            );
          })}
          {communities.length === 0 && (
            <p className="mt-4 px-1 text-center text-[11px] text-muted-foreground">
              No communities yet
            </p>
          )}
        </div>
      </ScrollArea>

      <div className="flex flex-col items-center gap-2 px-2">
        <CreateCommunityDialog onCreated={onSelectCommunity} />
      </div>
    </div>
  );
}

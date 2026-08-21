"use client";

import { useMutation, useQuery } from "convex/react";
import { Compass, Home } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CreateCommunityDialog } from "@/components/community/create-community-dialog";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Strips an optional "joincrystal:" prefix so pasting a full invite string
 * (copied straight from the Invite dialog) works the same as a bare code. */
function normalizeInviteInput(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("joincrystal:") ? trimmed.slice("joincrystal:".length) : trimmed;
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
            className="size-12 rounded-full"
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

function DiscoverDialog({ onJoined }: { onJoined: (id: Id<"communities">) => void }) {
  const [open, setOpen] = useState(false);
  const [inviteInput, setInviteInput] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [joiningByCode, setJoiningByCode] = useState(false);
  const discoverable = useQuery(api.communities.listDiscoverable, open ? {} : "skip") ?? [];
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
      setInviteError(err instanceof Error ? err.message : "Couldn't join with that code.");
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
          <DialogDescription>Every community is open to join for now.</DialogDescription>
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
              <div
                key={community.id}
                className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/60"
              >
                <Avatar size="sm">
                  <AvatarImage src={community.imageUrl} alt={community.name} />
                  <AvatarFallback>{community.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{community.name}</p>
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

interface CommunityRailProps {
  selectedCommunityId: Id<"communities"> | null;
  onSelectHome: () => void;
  onSelectCommunity: (id: Id<"communities">) => void;
}

export function CommunityRail({ selectedCommunityId, onSelectHome, onSelectCommunity }: CommunityRailProps) {
  const communities = useQuery(api.communities.listMine) ?? [];

  return (
    <div className="flex w-18 shrink-0 flex-col items-center gap-2 border-r bg-background/60 py-3">
      <RailButton label="Direct messages" active={!selectedCommunityId} onClick={onSelectHome}>
        <Home />
      </RailButton>

      <ScrollArea className="min-h-0 flex-1 w-full">
        {/* py-1 gives the selection ring (ring-2 + ring-offset-2 = ~4px)
            room to render without the ScrollArea's own overflow-hidden
            viewport clipping it off the first/last item. */}
        <div className="flex flex-col items-center gap-2 px-2 py-1">
          {communities.map((community) => (
            <TooltipProvider key={community.id}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onSelectCommunity(community.id)}
                    className={cn(
                      "flex size-12 items-center justify-center overflow-hidden rounded-full bg-secondary transition-[border-radius] hover:rounded-2xl",
                      selectedCommunityId === community.id && "ring-2 ring-primary ring-offset-2 ring-offset-background"
                    )}
                  >
                    <Avatar className="size-12 rounded-none">
                      <AvatarImage src={community.imageUrl} alt={community.name} />
                      <AvatarFallback className="rounded-none text-sm">
                        {community.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{community.name}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
          {communities.length === 0 && (
            <p className="mt-4 px-1 text-center text-[11px] text-muted-foreground">
              No communities yet
            </p>
          )}
        </div>
      </ScrollArea>

      <div className="flex flex-col items-center gap-2 px-2">
        <DiscoverDialog onJoined={onSelectCommunity} />
        <CreateCommunityDialog onCreated={onSelectCommunity} />
      </div>
    </div>
  );
}

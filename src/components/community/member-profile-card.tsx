"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Crown, Settings } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PresenceDot } from "@/components/presence-dot";
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useMyPresence, useSetPresenceStatus } from "@/hooks/use-presence";
import { getDesktopAPI } from "@/lib/desktop";
import { STATUS_DOT_CLASS, STATUS_LABEL, type FriendStatus, type ManualStatus } from "@/lib/presence";
import { cn } from "@/lib/utils";
import { ServerProfileDialog } from "./server-profile-dialog";

const MANUAL_STATUSES: ManualStatus[] = ["online", "idle", "dnd", "invisible"];

export interface MemberProfileMember {
  userId: Id<"users">;
  name: string;
  username: string;
  imageUrl?: string;
  bio?: string;
  customStatus?: string;
  bannerUrl?: string;
  borderGradientStart?: string;
  borderGradientEnd?: string;
  status: FriendStatus;
  /** Community-only — omitted for DM member profiles. */
  isOwner?: boolean;
  roles?: { id: Id<"roles">; name: string; color?: string }[];
}

export function MemberProfileCard({
  member,
  communityId,
  communityName,
}: {
  member: MemberProfileMember;
  communityId?: Id<"communities">;
  communityName?: string;
}) {
  const me = useQuery(api.users.getCurrentUser);
  const isSelf = !!me && me._id === member.userId;
  const { status: liveStatus, manualStatus } = useMyPresence();
  const setStatus = useSetPresenceStatus();
  const updateProfileExtended = useMutation(api.users.updateProfileExtended);
  const [customStatusInput, setCustomStatusInput] = useState(member.customStatus ?? "");
  const [serverProfileOpen, setServerProfileOpen] = useState(false);

  const hasGradient = !!(member.borderGradientStart && member.borderGradientEnd);

  return (
    <div
      className="rounded-md min-h-full p-1"
      style={
        hasGradient
          ? {
            background: `linear-gradient(to bottom, ${member.borderGradientStart}, ${member.borderGradientEnd})`,
            backgroundPosition: "center",
            backgroundSize: "contain"
            }
          : undefined
      }
    >
      {/* Inner overlay — 3px inset, clips content and carries the border */}
      <div className={`overflow-hidden rounded-[5px] border border-border/20${hasGradient ? " bg-black/60 backdrop-blur-sm" : " bg-popover"}`}>

      {/* Banner — always shown if set; if no banner but gradient, just top padding */}
      {member.bannerUrl ? (
        <div
          className="h-24 w-full bg-cover bg-center"
          style={{ backgroundImage: `url(${member.bannerUrl})` }}
        />
      ) : hasGradient ? (
        <div className="h-10" />
      ) : (
        <div className="h-16 w-full bg-gradient-to-br from-muted to-muted/60" />
      )}

      {/* Avatar + custom status pill — avatar overlaps banner */}
      <div className="-mt-8 flex items-end gap-3 px-4">
        <Avatar
          className={cn(
            "size-16 shrink-0 shadow-md",
            "ring-4 ring-background/60",
          )}
        >
          <AvatarImage src={member.imageUrl} alt={member.name} />
          <AvatarFallback className="text-lg">
            {member.name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
          {/* Larger dot with thicker ring for the profile card */}
          <AvatarBadge className={cn(STATUS_DOT_CLASS[member.status], "min-w-4 min-h-4 ring-[4px] ring-background/60")} />
        </Avatar>

        {member.customStatus && (
          <div className="mb-4 max-w-[160px] truncate rounded-full bg-black/10 px-3 py-1 text-sm font-medium text-white backdrop-blur-sm">
            {member.customStatus}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="space-y-3 px-4 pb-4 pt-2">
        <div>
          <div className="flex items-center gap-1.5">
            <p className="truncate text-base font-bold leading-tight">{member.name}</p>
            {member.isOwner && <Crown className="size-4 shrink-0 text-amber-500" />}
          </div>
          <p className="truncate text-sm text-muted-foreground">@{member.username}</p>
        </div>

        {member.roles && member.roles.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {member.roles.map((role) => (
              <Badge
                key={role.id}
                variant="outline"
                style={role.color ? { borderColor: role.color, color: role.color } : undefined}
              >
                {role.name}
              </Badge>
            ))}
          </div>
        )}

        {member.bio ? (
          <p className="text-sm whitespace-pre-wrap">{member.bio}</p>
        ) : (
          <p className="text-sm italic text-muted-foreground">No bio yet.</p>
        )}

        {isSelf && (
          <div className="flex flex-col gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  className="flex w-full items-center gap-2 rounded-md px-3 bg-secondary/80 py-2 text-left text-sm"
                >
                  <span className="min-w-0 flex-1 truncate text-center">
                    Set status
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="right" className="w-56">
                <DropdownMenuLabel className="pb-1">Custom status</DropdownMenuLabel>
                <div className="px-2 pb-2">
                  <Input
                    value={customStatusInput}
                    onChange={(e) => setCustomStatusInput(e.target.value)}
                    placeholder="What's on your mind?"
                    className="h-8 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void updateProfileExtended({ customStatus: customStatusInput.trim() || undefined });
                        (e.target as HTMLInputElement).blur();
                      }
                      if (e.key === "Escape") {
                        setCustomStatusInput(member.customStatus ?? "");
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    onBlur={() => {
                      void updateProfileExtended({ customStatus: customStatusInput.trim() || undefined });
                    }}
                  />
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Set status</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={manualStatus}
                  onValueChange={(v) => setStatus(v as ManualStatus)}
                >
                  {MANUAL_STATUSES.map((value) => (
                    <DropdownMenuRadioItem key={value} value={value} className="gap-2">
                      <PresenceDot status={value} />
                      {STATUS_LABEL[value]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            {communityId && (
              <>
                <Button
                  variant="secondary"
                  className="w-full bg-secondary/80 gap-1.5"
                  onClick={() => setServerProfileOpen(true)}
                >
                  <Settings className="size-4" />
                  Edit Server Profile
                </Button>
                <ServerProfileDialog
                  communityId={communityId}
                  communityName={communityName ?? ""}
                  open={serverProfileOpen}
                  onOpenChange={setServerProfileOpen}
                />
              </>
            )}

            <Button
              variant="secondary"
              className="w-full bg-secondary/80 gap-1.5"
              onClick={() => void getDesktopAPI()?.settings.open()}
            >
              <Settings className="size-4" />
              Edit Profile
            </Button>
          </div>
        )}
      </div>

      </div>{/* end inner overlay */}
    </div>
  );
}

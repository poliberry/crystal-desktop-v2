"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Cog, UserPen } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PresenceDot } from "@/components/presence-dot";
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
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
import {
  STATUS_DOT_CLASS,
  STATUS_LABEL,
  type FriendStatus,
  type ManualStatus,
} from "@/lib/presence";
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
  const [customStatusInput, setCustomStatusInput] = useState(
    member.customStatus ?? "",
  );
  const [serverProfileOpen, setServerProfileOpen] = useState(false);

  const hasGradient = !!(
    member.borderGradientStart && member.borderGradientEnd
  );

  return (
    <div
      className="rounded-md min-h-full p-0.5"
      style={
        hasGradient
          ? {
              background: `linear-gradient(to bottom, rgba(0,0,0,0.4), rgba(0,0,0,0.4)), linear-gradient(to bottom, ${member.borderGradientStart}, ${member.borderGradientEnd})`,
              backgroundPosition: "center",
              backgroundSize: "contain",
            }
          : undefined
      }
    >
      {/* Inner overlay — 3px inset, clips content and carries the border */}
      <div
        className={`overflow-hidden rounded-[5px] border border-border/20 ${hasGradient ? " bg-accent backdrop-blur-sm" : " bg-popover"}`}
      >
        {/* Banner — always shown if set; if no banner but gradient, just top padding */}
        {member.bannerUrl ? (
          <>
            <div className="w-full h-24 absolute top-0 left-0 bg-linear-to-b from-transparent to-accent/80" />
            <div
              className="h-24 w-full bg-cover bg-center opacity-80"
              style={{
                filter: "blur(2px)",
                backgroundImage: `url(${member.bannerUrl})`,
                WebkitMaskImage:
                  "linear-gradient(to bottom, var(--accent) 0%, var(--accent) 20%, transparent 100%)",
                maskImage:
                  "linear-gradient(to bottom, var(--accent) 0%, var(--accent) 20%, transparent 100%)",
              }}
            />
          </>
        ) : hasGradient ? (
          <div className="h-10" />
        ) : (
          <div className="h-16 w-full bg-gradient-to-br from-muted to-muted/60" />
        )}

        {/* Avatar + custom status pill — avatar overlaps banner */}
        <div className="flex flex-row justify-start gap-2">
          <div className="-mt-8 flex items-end gap-3 px-4">
            <Avatar
              className={cn(
                "size-16 shrink-0 shadow-md rounded-xl",
                "ring-4 ring-background/60",
              )}
            >
              <AvatarImage src={member.imageUrl} alt={member.name} className="rounded-xl" />
              <AvatarFallback className="text-lg">
                {member.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
              {/* Larger dot with thicker ring for the profile card */}
              <AvatarBadge
                className={cn(
                  STATUS_DOT_CLASS[member.status],
                  "min-w-4 min-h-4 ring-[4px] ring-background/60",
                )}
              />
            </Avatar>

            {member.customStatus && isSelf && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div className="cursor-pointer absolute top-14 left-4 max-w-40 shadow-lg truncate rounded-full bg-accent/60 hover:bg-accent/80 px-3 py-1 text-sm font-medium text-white backdrop-blur-sm">
                    {member.customStatus}
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="bottom" className="w-56">
                  <DropdownMenuLabel className="pb-1">
                    Custom status
                  </DropdownMenuLabel>
                  <div className="px-2 pb-2">
                    <Input
                      value={customStatusInput}
                      onChange={(e) => setCustomStatusInput(e.target.value)}
                      placeholder="What's on your mind?"
                      className="h-8 text-xs"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          void updateProfileExtended({
                            customStatus: customStatusInput.trim() || undefined,
                          });
                          (e.target as HTMLInputElement).blur();
                        }
                        if (e.key === "Escape") {
                          setCustomStatusInput(member.customStatus ?? "");
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      onBlur={() => {
                        void updateProfileExtended({
                          customStatus: customStatusInput.trim() || undefined,
                        });
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
                      <DropdownMenuRadioItem
                        key={value}
                        value={value}
                        className="gap-2"
                      >
                        <PresenceDot status={value} />
                        {STATUS_LABEL[value]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          <div className="-ml-3 pt-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-base font-bold leading-tight">
                {member.name}
              </p>
              {member.isOwner && (
                <img
                  src="/icons/crown.png"
                  alt="Server Owner"
                  className="size-5 opacity-50"
                />
              )}
            </div>
            <p className="truncate text-sm text-muted-foreground">
              @{member.username}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="space-y-3 px-4 pb-2 pt-4">
          {member.bio ? (
            <p className="text-sm whitespace-pre-wrap">{member.bio}</p>
          ) : (
            <p className="text-sm italic text-muted-foreground">No bio yet.</p>
          )}

          {member.roles && member.roles.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {member.roles.map((role) => (
                <Badge
                  key={role.id}
                  variant="outline"
                  style={
                    role.color
                      ? { borderColor: role.color, color: role.color }
                      : undefined
                  }
                >
                  {role.name}
                </Badge>
              ))}
            </div>
          )}

          {isSelf && (
            <div className="flex absolute top-1 right-1 gap-0">
              {communityId && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setServerProfileOpen(true)}
                  >
                    <UserPen className="size-4" />
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
                variant="ghost"
                size="icon"
                onClick={() => void getDesktopAPI()?.settings.open()}
              >
                <Cog className="size-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
      {/* end inner overlay */}
    </div>
  );
}

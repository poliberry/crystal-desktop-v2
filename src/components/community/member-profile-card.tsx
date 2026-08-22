"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Cog, Maximize2, UserPen } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { FriendActionButton } from "@/components/friend-action-button";
import { StatusDialog } from "@/components/status-dialog";
import { ProfileDialog } from "@/components/profile-dialog";
import { UserRichPresenceCard } from "@/components/rich-presence-card";
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDesktopAPI } from "@/lib/desktop";
import { STATUS_DOT_CLASS, type FriendStatus } from "@/lib/presence";
import { cn } from "@/lib/utils";
import { ServerProfileDialog } from "./server-profile-dialog";

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
  expandable = true,
  expanded = false,
  showActivity = true,
}: {
  member: MemberProfileMember;
  communityId?: Id<"communities">;
  communityName?: string;
  /** False inside `ProfileDialog`, which is itself the expanded view. */
  expandable?: boolean;
  /** Larger layout for the dialog: taller banner, bigger avatar, name on its
   * own line under it. */
  expanded?: boolean;
  /** False in the dialog, where the activity list has its own column and
   * repeating it here would just be the same card twice. */
  showActivity?: boolean;
}) {
  const me = useQuery(api.users.getCurrentUser);
  // Only the expanded card shows "Member since", so the extra read is scoped
  // to the dialog rather than every popover.
  const profile = useQuery(
    api.users.getProfile,
    expanded ? { userId: member.userId, communityId } : "skip"
  );
  const isSelf = !!me && me._id === member.userId;
  const [serverProfileOpen, setServerProfileOpen] = useState(false);
  const [expandedOpen, setExpandedOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

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
            <div
              className={cn(
                "absolute top-0 left-0 w-full bg-linear-to-b from-transparent to-accent/80",
                expanded ? "h-40" : "h-24"
              )}
            />
            <div
              className={cn("w-full bg-cover bg-center opacity-80", expanded ? "h-40" : "h-24")}
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
        <div className={cn("flex gap-2", "flex-row justify-start")}>
          <div
            className={cn(
              "flex items-end gap-3 px-4",
              expanded ? "-mt-12" : "-mt-8"
            )}
          >
            <Avatar
              className={cn(
                "shrink-0 shadow-md rounded-xl ring-4 ring-background/60",
                expanded ? "size-24" : "size-16"
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
              <button
                type="button"
                title="Change your status"
                onClick={() => setStatusOpen(true)}
                className={cn(
                  expanded ? "top-24" : "top-14",
                  "cursor-pointer absolute left-4 max-w-40 shadow-lg truncate rounded-full bg-accent/60 hover:bg-accent/80 px-3 py-1 text-sm font-medium text-white backdrop-blur-sm"
                )}
              >
                {member.customStatus}
              </button>
            )}
          </div>

          {isSelf && <StatusDialog open={statusOpen} onOpenChange={setStatusOpen} />}

          <div className={cn("-ml-3 pt-1")}>
            <div className="flex items-center gap-1.5">
              <p
                className={cn(
                  "truncate font-bold leading-tight",
                  expanded ? "text-xl" : "text-base"
                )}
              >
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
        <div className={cn("space-y-3 px-4 pb-2", expanded ? "pt-4" : "pt-4")}>
          {!isSelf && (
            <FriendActionButton userId={member.userId} username={member.username} />
          )}

          {member.bio ? (
            <p className="text-sm whitespace-pre-wrap">{member.bio}</p>
          ) : (
            <p className="text-sm italic text-muted-foreground">No bio yet.</p>
          )}

          {/* In the dialog the activity list owns its own column, so showing
              it here too would just be the same card twice. */}
          {showActivity && <UserRichPresenceCard userId={member.userId} />}

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

          {expanded && profile?.createdAt && (
            <div className="border-t border-border/40 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Member since
              </p>
              <p className="text-sm">
                {new Date(profile.createdAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </div>
          )}

          <div className="absolute top-1 right-1 flex gap-0">
            {expandable && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Expand profile"
                  onClick={() => setExpandedOpen(true)}
                >
                  <Maximize2 className="size-4" />
                </Button>
                <ProfileDialog
                  open={expandedOpen}
                  onOpenChange={setExpandedOpen}
                  member={member}
                  communityId={communityId}
                  communityName={communityName}
                />
              </>
            )}
            {isSelf && (
              <>
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
                title="Settings"
                onClick={() => void getDesktopAPI()?.settings.open()}
              >
                <Cog className="size-4" />
              </Button>
              </>
            )}
          </div>
        </div>
      </div>
      {/* end inner overlay */}
    </div>
  );
}

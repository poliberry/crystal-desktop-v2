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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useOpenSettings } from "@/components/settings/settings-dialog";
import { badgeDefinition, visibleBadgeIds } from "@/lib/badges";
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

/**
 * Which of a user's badges this build will actually draw.
 *
 * Queried by the card rather than by `ProfileBadges` itself, even though only
 * that row renders them: whether there are any badges also decides where the
 * custom-status pill sits, because the badge row is what pushes the avatar
 * down. One consumer of the answer would have been fine self-fetching; two
 * would mean the same query twice, one of them purely for a layout decision.
 */
function useVisibleBadges(userId: Id<"users">) {
  const badges = useQuery(api.users.badgesOf, { userId }) ?? [];
  // Collapses the Bug Hunter tiers down to the highest one held — see
  // src/lib/badges.ts.
  const shown = new Set(visibleBadgeIds(badges.map((b) => b.badgeId)));
  return badges.filter(
    (badge) => shown.has(badge.badgeId) && !!badgeDefinition(badge.badgeId),
  );
}

/**
 * The badges a user has earned, as a row of glyphs — the name and reason live
 * on hover rather than taking up a line of the card.
 */
function ProfileBadges({ badges }: { badges: { badgeId: string }[] }) {
  if (badges.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center bg-background/50 w-fit p-1 rounded-md gap-1.5">
      {badges.map((badge) => {
        const definition = badgeDefinition(badge.badgeId);
        // An id this build doesn't know about is skipped rather than drawn as
        // a mystery glyph — see src/lib/badges.ts.
        if (!definition) return null;
        const Icon = definition.icon;
        return (
          <Tooltip key={badge.badgeId}>
            <TooltipTrigger asChild>
              <Icon
                aria-label={definition.label}
                className={cn("size-4 shrink-0", definition.className)}
              />
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="font-medium">{definition.label}</p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
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
    expanded ? { userId: member.userId, communityId } : "skip",
  );
  const isSelf = !!me && me._id === member.userId;
  const badges = useVisibleBadges(member.userId);
  const [serverProfileOpen, setServerProfileOpen] = useState(false);
  const [expandedOpen, setExpandedOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const openSettings = useOpenSettings();

  const hasGradient = !!(
    member.borderGradientStart && member.borderGradientEnd
  );

  /** Rendered in one of two places depending on whether there's a badge row
   * to push the avatar down — `position` is what differs between them. */
  const statusPill = (position: string) =>
    member.customStatus && isSelf ? (
      <button
        type="button"
        title="Change your status"
        onClick={() => setStatusOpen(true)}
        className={cn(
          "cursor-pointer absolute z-10 max-w-40 shadow-lg truncate rounded-full bg-accent/60 hover:bg-accent/80 px-3 py-1 text-sm font-medium text-white backdrop-blur-sm",
          position,
        )}
      >
        {member.customStatus}
      </button>
    ) : null;

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
        className={`overflow-hidden rounded-[5px] border border-border/20 ${hasGradient ? " bg-background/70" : " bg-accent"}`}
      >
        {/* Banner — always shown if set; if no banner but gradient, just top padding */}
        {member.bannerUrl ? (
          <>
            <div
              className={cn(
                "w-full bg-cover bg-center opacity-80",
                expanded ? "h-40" : "h-24",
              )}
              style={{
                backgroundImage: `url(${member.bannerUrl})`,
              }}
            />
          </>
        ) : hasGradient ? (
          <div className="h-24 w-full bg-muted" />
        ) : (
          <div className="h-24 w-full bg-muted" />
        )}

        {/* Avatar + custom status pill — avatar overlaps banner */}
        <div className={cn("flex flex-col gap-2", "flex-col justify-start")}>
          <div
            className={cn(
              "flex items-end gap-3 px-4",
              expanded ? "-mt-12" : "-mt-8",
            )}
          >
            {/* `relative` and shrink-wrapped to the avatar, so the pill inside
                it can be placed against the avatar rather than the card. */}
            <div className="relative shrink-0">
              <Avatar
                className={cn(
                  "shadow-md rounded-xl ring-4",
                  expanded ? "size-24" : "size-16",
                  hasGradient ? "ring-background/70" : "ring-accent",
                )}
              >
                <AvatarImage
                  src={member.imageUrl}
                  alt={member.name}
                  className="rounded-xl"
                />
                <AvatarFallback className="text-lg">
                  {member.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
                {/* Larger dot with thicker ring for the profile card */}
                <AvatarBadge
                  className={cn(
                    STATUS_DOT_CLASS[member.status],
                    "min-w-4 min-h-4 ring-4",
                    hasGradient ? "ring-background/70" : "ring-accent",
                  )}
                />
              </Avatar>

              {/* With badges, the offsets above no longer land: the badge row
                  makes the name column taller, the avatar is bottom-aligned in
                  a row that stretches to match that column, so the avatar
                  slides *down* while a pill pinned to the card doesn't — the
                  gap in the screenshots. Anchored here instead, the pill sits
                  4px over the avatar's top edge whatever the column does. */}
              {badges.length > 0 &&
                statusPill("bottom-[calc(100%-4px)] left-0")}
            </div>

            {/* Without badges the pill keeps its existing offsets from the
                top of the card, which are correct there and left untouched. */}
            {badges.length === 0 &&
              statusPill(cn("left-4", expanded ? "top-24" : "top-14"))}
          </div>

          {isSelf && (
            <StatusDialog open={statusOpen} onOpenChange={setStatusOpen} />
          )}

          <div className={cn("ml-4 pt-1")}>
            <div className="flex items-center gap-1.5">
              <p
                className={cn(
                  "truncate font-bold leading-tight",
                  expanded ? "text-xl" : "text-base",
                )}
              >
                {member.name}
              </p>
            </div>
            <p className="truncate text-sm text-muted-foreground">
              @{member.username}
            </p>
            <ProfileBadges badges={badges} />
          </div>
        </div>

        {/* Content */}
        <div className={cn("space-y-3 px-4 pb-2", expanded ? "pt-4" : "pt-4")}>
          {!isSelf && (
            <FriendActionButton
              userId={member.userId}
              username={member.username}
            />
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
                  onClick={openSettings}
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

/**
 * The profile card for a user we only know by id — the popover body behind
 * every avatar/name click (message authors, the voice roster).
 *
 * Rendered inside `PopoverContent` so mounting it *is* the trigger for
 * fetching the full profile (bio, banner, roles) rather than paying for it on
 * every row in a list. The caller passes whatever identity it already has on
 * screen so the card is complete on the first frame and the query only fills
 * in the rest; inside a community, the resolved server profile wins once it
 * arrives. Omit `communityId` for DMs — there's no per-server identity or
 * role list to show there.
 */
export function UserProfileContent({
  userId,
  communityId,
  name,
  username,
  imageUrl,
}: {
  userId: Id<"users">;
  communityId?: Id<"communities">;
  name: string;
  username: string;
  imageUrl?: string;
}) {
  const profile = useQuery(api.users.getProfile, { userId, communityId });
  return (
    <MemberProfileCard
      communityId={communityId}
      member={{
        userId,
        name: profile?.name ?? name,
        username,
        imageUrl: profile?.imageUrl ?? imageUrl,
        roles: profile?.roles,
        isOwner: profile?.isOwner,
        // Falls back to offline only until the profile query resolves — the
        // status is real once it does.
        status: (profile?.status ?? "offline") as FriendStatus,
        bio: profile?.bio,
        bannerUrl: profile?.bannerUrl,
        customStatus: profile?.customStatus,
        borderGradientStart: profile?.borderGradientStart,
        borderGradientEnd: profile?.borderGradientEnd,
      }}
    />
  );
}

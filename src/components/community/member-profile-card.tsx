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
  AvatarDecoration,
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
import { PresenceBadge } from "@/components/presence-dot";
import { decorationSrc } from "@/lib/avatar-decorations";
import {
  StatusBubble,
  type StatusBubbleKind,
} from "@/components/profile/status-bubble";
import { type FriendStatus } from "@/lib/presence";
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
  /** The frame around their avatar, as stored — see `decorationSrc`. */
  avatarDecoration?: string;
  /** Their birthday is today. */
  isBirthday?: boolean;
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
  /**
   * The card's own read of this person.
   *
   * Needed by every card, not just the expanded one, for the status pill: the
   * `member` prop comes from whatever list opened the card, and a list hides an
   * offline person's custom status because a row is about reachability. On the
   * card the status is the reason you opened it, so it comes from here instead,
   * where it isn't filtered by presence. (It also carries "Member since", which
   * only the dialog shows.)
   */
  const profile = useQuery(api.users.getProfile, {
    userId: member.userId,
    communityId,
  });
  const isSelf = !!me && me._id === member.userId;
  const badges = useVisibleBadges(member.userId);
  const [serverProfileOpen, setServerProfileOpen] = useState(false);
  const [expandedOpen, setExpandedOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const openSettings = useOpenSettings();

  const hasGradient = !!(
    member.borderGradientStart && member.borderGradientEnd
  );

  /**
   * Whoever's card this is, whatever their presence — a status somebody set is
   * shown here for as long as they've set it, including while they're offline,
   * which is the whole point of "Back Monday".
   *
   * The list's value is the fallback rather than the source, so the pill is
   * there on the first frame instead of appearing when the query lands.
   */
  const customStatus = profile?.customStatus ?? member.customStatus;

  /**
   * Cosmetics that the card's own read is the authority on.
   *
   * The `member` prop is whatever the thing that opened the card had to hand —
   * a message author, a friend row, a call tile — and not all of those carry a
   * decoration. Taking it from the profile query means the card looks the same
   * wherever it was opened from, and the prop only fills the first frame.
   */
  const avatarDecoration = profile?.avatarDecoration ?? member.avatarDecoration;
  const isBirthday = profile?.isBirthday ?? member.isBirthday;

  /** Said or thought — see StatusBubble. The card is the only place a status
   * gets a shape rather than a line of text. */
  const statusBubble = (profile?.statusBubble ?? "speech") as StatusBubbleKind;

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
            {/* `relative` and shrink-wrapped to the avatar, so the presence
                badge and the decoration are placed against the avatar rather
                than against the card. */}
            <div className="relative shrink-0">
              <Avatar
                className={cn(
                  "shadow-md rounded-xl",
                  expanded ? "size-24" : "size-16",
                  // The ring is the card's own frame around the avatar. A
                  // decoration is a frame too, and two of them stacked read as
                  // a border somebody forgot to remove — so whoever is
                  // wearing one gets theirs instead.
                  !avatarDecoration && "ring-4",
                  !avatarDecoration && (hasGradient ? "ring-background/70" : "ring-accent"),
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
                <AvatarDecoration src={decorationSrc(avatarDecoration)} />
                {/* Larger dot with thicker ring for the profile card — and a
                    cake sized to match on the day. */}
                <PresenceBadge
                  status={member.status}
                  isBirthday={isBirthday}
                  decorated={!!avatarDecoration}
                  className={cn(
                    "min-w-4 min-h-4 ring-4",
                    hasGradient ? "ring-background/70" : "ring-accent",
                  )}
                />
              </Avatar>
            </div>

            {/* Beside the avatar, not over it: this row holds nothing else, and
                a bubble pinned across the avatar's corner would cut a piece
                out of any decoration worn there. */}
            {customStatus && (
              <StatusBubble
                text={customStatus}
                kind={statusBubble}
                onClick={isSelf ? () => setStatusOpen(true) : undefined}
                // `ml-3` on top of the row's own gap, because the tail hangs
                // off the bubble's left edge and has to land in that gap
                // rather than on the avatar.
                className={cn("mb-1 ml-3 min-w-0", expanded ? "max-w-64" : "max-w-40")}
              />
            )}
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
        avatarDecoration: profile?.avatarDecoration,
        isBirthday: profile?.isBirthday,
        borderGradientStart: profile?.borderGradientStart,
        borderGradientEnd: profile?.borderGradientEnd,
      }}
    />
  );
}

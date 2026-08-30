"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Cog, Maximize2, UserPen } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { FriendActionButton } from "@/components/friend-action-button";
import { StatusDialog } from "@/components/status-dialog";
import { useOpenProfile } from "@/components/profile/profile-page";
import { useOpenProfileEditor } from "@/components/profile/profile-editor-dialog";
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
import { BadgeIcon } from "@/components/badge-icon";
import {
  layersHeadroom,
  type CosmeticLayer,
} from "@/lib/cosmetic-layers";
import { PresenceBadge } from "@/components/presence-dot";
import {
  ProfileEffectLayer,
  ProfileFrameLayer,
  ProfileFrameLayers,
} from "@/components/profile/profile-card-cosmetics";
import {
  ProfileCssLayer,
  profileCssAttributes,
} from "@/components/profile/profile-css";
import {
  displayNameStyleClass,
  frameHeadroom,
  frameLayersFrom,
  frameLayout,
} from "@/lib/profile-cosmetics";
import {
  StatusBubble,
  type StatusBubbleKind,
} from "@/components/profile/status-bubble";
import { type FriendStatus } from "@/lib/presence";
import { cn } from "@/lib/utils";
import { useUserActivities } from "@/hooks/use-rich-presence";

export interface MemberProfileMember {
  userId: Id<"users">;
  name: string;
  username: string;
  imageUrl?: string;
  bio?: string;
  customStatus?: string;
  bannerUrl?: string;
  /** The frame around their avatar, as stored — see `decorationLayers`. */
  avatarDecoration?: string;
  /** Their birthday is today. */
  isBirthday?: boolean;
  borderGradientStart?: string;
  borderGradientEnd?: string;
  /** How their display name is drawn — a key from src/lib/profile-cosmetics.ts. */
  displayNameStyle?: string;
  /** Artwork played over the whole card, and the frame drawn around it. Both
   * are storage URLs; the `profileFrame*` fields say where the frame is
   * drawn — see `ProfileFrameLayout`. */
  profileEffect?: string;
  profileFrame?: string;
  profileFrameMode?: string;
  profileFrameFit?: string;
  profileFrameAnchor?: string;
  profileFrameScale?: number;
  profileFrameOffsetY?: number;
  /** The frame as placed artwork, which is what a profile edited since frames
   * became a list carries instead of the five fields above. */
  profileFrameLayers?: CosmeticLayer[];
  /** The owner's own stylesheet for this card — see `ProfileCssLayer`. */
  profileCss?: string;
  status: FriendStatus;
  /** Community-only — omitted for DM member profiles. */
  isOwner?: boolean;
  roles?: { id: Id<"roles">; name: string; color?: string }[];
}

/** One resolved badge, as `users.badgesOf` hands it over. */
type ProfileBadge = {
  badgeId: string;
  label: string;
  description: string;
  icon?: string;
  imageUrl?: string;
  className?: string;
};

/**
 * The badges a user has earned, as a row of glyphs — the name and the reason
 * live on hover rather than taking up a line of the card.
 *
 * Everything about which badges these are and how each is drawn is settled by
 * the query (see `users.badgesOf`): unknown ids dropped, tiers collapsed to the
 * highest one held, order applied. The catalogue is a table now, so a build
 * that has never heard of a badge still renders it.
 */
function ProfileBadges({ badges }: { badges: ProfileBadge[] }) {
  if (badges.length === 0) return null;

  return (
    <div
      data-slot="profile-badges"
      className="mt-1 flex flex-wrap items-center bg-background/50 w-fit p-1 rounded-md gap-1.5"
    >
      {badges.map((badge) => (
        <Tooltip key={badge.badgeId}>
          <TooltipTrigger asChild>
            {/* A span, because the glyph resolves asynchronously and can be
                nothing for a beat — the trigger has to stay mountable. */}
            <span className="flex">
              <BadgeIcon
                icon={badge.icon}
                imageUrl={badge.imageUrl}
                label={badge.label}
                className={badge.className}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="font-medium">{badge.label}</p>
            <p className="text-xs text-muted-foreground">{badge.description}</p>
          </TooltipContent>
        </Tooltip>
      ))}
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
  hideMessageAction = false,
  frameHandledByHost = false,
  reserveFrameRoom = true,
  className,
}: {
  member: MemberProfileMember;
  communityId?: Id<"communities">;
  communityName?: string;
  expandable?: boolean;
  expanded?: boolean;
  showActivity?: boolean;
  hideMessageAction?: boolean;
  frameHandledByHost?: boolean;
  reserveFrameRoom?: boolean;
  className?: string;
}) {
  const me = useQuery(api.users.getCurrentUser);
  const profile = useQuery(api.users.getProfile, {
    userId: member.userId,
    communityId,
  });
  const isSelf = !!me && me._id === member.userId;
  const badges = (useQuery(api.users.badgesOf, { userId: member.userId }) ??
    []) as ProfileBadge[];
  const [statusOpen, setStatusOpen] = useState(false);
  const openSettings = useOpenSettings();
  const openProfile = useOpenProfile();
  const openProfileEditor = useOpenProfileEditor();

  const hasGradient = !!(
    member.borderGradientStart && member.borderGradientEnd
  );
  const customStatus = profile?.customStatus ?? member.customStatus;
  const avatarDecoration = profile?.avatarDecoration ?? member.avatarDecoration;
  const isBirthday = profile?.isBirthday ?? member.isBirthday;
  const profileEffect = profile?.profileEffect ?? member.profileEffect;
  const profileCss = profile?.profileCss ?? member.profileCss;
  const profileFrame = profile?.profileFrame ?? member.profileFrame;
  const frameLayers = frameLayersFrom(
    profile?.profileFrame || profile?.profileFrameLayers?.length ? profile : member,
  );
  const frameRoomPercent = layersHeadroom(frameLayers);
  const profileFrameLayout = frameLayout(
    profile?.profileFrame
      ? profile
      : {
          profileFrameFit: member.profileFrameFit,
          profileFrameAnchor: member.profileFrameAnchor,
          profileFrameScale: member.profileFrameScale,
          profileFrameOffsetY: member.profileFrameOffsetY,
        },
  );
  const frameRoom = frameHeadroom(profileFrameLayout, !!profileFrame);
  const nameStyle = displayNameStyleClass(
    profile?.displayNameStyle ?? member.displayNameStyle,
  );
  const statusBubble = (profile?.statusBubble ?? "speech") as StatusBubbleKind;
  const activities = useUserActivities(member.userId);

  return (
    <div
      data-slot="profile-card"
      {...profileCssAttributes(profileCss, member.userId)}
      className={cn("relative flex min-h-full flex-col rounded-md p-0.5", className)}
      style={
        {
          ...(frameLayers.length > 0
            ? {
                marginTop: reserveFrameRoom ? `${frameRoomPercent.top}%` : 0,
                marginBottom: reserveFrameRoom ? `${frameRoomPercent.bottom}%` : 0,
              }
            : {
                marginTop: reserveFrameRoom ? frameRoom.paddingTop : 0,
                marginBottom: reserveFrameRoom ? frameRoom.paddingBottom : 0,
              }),
          ...(hasGradient
            ? {
                background: `linear-gradient(to bottom, rgba(0,0,0,0.4), rgba(0,0,0,0.4)), linear-gradient(to bottom, ${member.borderGradientStart}, ${member.borderGradientEnd})`,
                backgroundPosition: "center",
                backgroundSize: "contain",
              }
            : {}),
        } as React.CSSProperties
      }
    >
      {/* Inner overlay — 3px inset, clips content and carries the border */}
      <div
        data-slot="profile-card-inner"
        className={cn(
          "relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[5px] border border-border/20",
          hasGradient ? "bg-background/70" : "bg-accent",
        )}
      >
        {/* Banner — always shown if set; if no banner but gradient, just top padding */}
        {member.bannerUrl ? (
          <>
            <div
              data-slot="profile-banner"
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
                {/* The one place a decoration plays on its own: this card
                    is about one person, and is opened to look at them.
                    Everywhere else waits to be pointed at. */}
                <AvatarDecoration value={avatarDecoration} animate />
                {/* Larger dot with thicker ring for the profile card — and a
                    cake sized to match on the day. */}
                <PresenceBadge
                  status={member.status}
                  activities={activities}
                  isBirthday={isBirthday}
                  decorated={!!avatarDecoration}
                  className={cn(
                    "min-w-7 min-h-7 ring-4",
                    hasGradient ? `ring-[${member.borderGradientStart}]` : "ring-accent",
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
                // Up against the avatar's top rather than sitting on the row's
                // baseline: the row is as tall as the avatar, and a bubble at
                // the bottom of it reads as attached to the shoulders.
                //
                // `ml-3` on top of the row's own gap, because the tail hangs off
                // the bubble's left edge and has to land in that gap rather
                // than on the avatar.
                className={cn(
                  "mt-1 ml-2 min-w-0 self-start",
                  expanded ? "max-w-64" : "max-w-40",
                )}
              />
            )}
          </div>

          {isSelf && (
            <StatusDialog open={statusOpen} onOpenChange={setStatusOpen} />
          )}

          <div data-slot="profile-identity" className={cn("ml-4 pt-1")}>
            <div className="flex items-center gap-1.5">
              <p
                data-slot="profile-name"
                className={cn(
                  "truncate font-bold leading-tight",
                  expanded ? "text-xl" : "text-base",
                  // A gradient style paints the text with `bg-clip-text`, which
                  // needs the element to be the one carrying the background —
                  // so the style lands here rather than on a wrapper.
                  nameStyle,
                )}
              >
                {member.name}
              </p>
            </div>
            <p data-slot="profile-username" className="truncate text-sm text-muted-foreground">
              @{member.username}
            </p>
            <ProfileBadges badges={badges} />
          </div>
        </div>

        {/* Content */}
        <div
          data-slot="profile-body"
          className={cn("min-w-0 space-y-3 px-4 pb-2", expanded ? "pt-4" : "pt-4")}
        >

          {member.bio ? (
            <p data-slot="profile-bio" className="text-sm whitespace-pre-wrap">{member.bio}</p>
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
            <div data-slot="profile-member-since" className="border-t border-border/40 pt-3">
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

          <div
            data-slot="profile-actions"
            // `z-40`: above the frame (z-30) and the effect (z-20). Decoration
            // that covered these would make the card unusable.
            className="z-40 flex flex-col items-center w-full gap-1 pb-4"
          >
            {!isSelf && (
              <FriendActionButton
                userId={member.userId}
                username={member.username}
                hideMessage={hideMessageAction}
                className="w-full"
              />
            )}
            {expandable && (
              <Button
                variant="outline"
                size="default"
                title="Open profile"
                className="w-full"
                onClick={() =>
                  openProfile({ member, communityId, communityName })
                }
              >
                <Maximize2 className="size-4" />
                Open Full Profile
              </Button>
            )}
            {isSelf && (
              <>
                {/* One editor for both scopes: it has a dropdown for picking
                    the account or any server you're in, so a separate
                    "server profile" dialog would be a second way to write the
                    same fields. */}
                <Button
                  variant="outline"
                  size="default"
                  title="Edit profile"
                  className="w-full"
                  onClick={openProfileEditor}
                >
                  <UserPen className="size-4" />
                  Edit Profile
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
      {/* end inner overlay */}

      {/* Drawn outside the clipping box, so a wrapping frame keeps the part
          that hangs past the card's edges. */}
      <ProfileCssLayer css={profileCss} scopeId={member.userId} />
      <ProfileEffectLayer src={profileEffect} rounded="rounded-md" />
      {!frameHandledByHost &&
        (frameLayers.length > 0 ? (
          <ProfileFrameLayers layers={frameLayers} />
        ) : (
          <ProfileFrameLayer src={profileFrame} layout={profileFrameLayout} />
        ))}
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
      // A popover is positioned against a row and clips nothing, so the card
      // lines up with that row and the frame hangs outside the popover.
      reserveFrameRoom={false}
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
        displayNameStyle: profile?.displayNameStyle,
        profileEffect: profile?.profileEffect,
        profileFrame: profile?.profileFrame,
        profileFrameMode: profile?.profileFrameMode,
        profileFrameFit: profile?.profileFrameFit,
        profileFrameAnchor: profile?.profileFrameAnchor,
        profileFrameScale: profile?.profileFrameScale,
        profileFrameOffsetY: profile?.profileFrameOffsetY,
        profileCss: profile?.profileCss,
      }}
    />
  );
}

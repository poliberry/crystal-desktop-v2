"use client";

import { useQuery } from "convex/react";
import {
  ChevronUp,
  HeadphoneOff,
  Headphones,
  Mic,
  MicOff,
  MonitorCog,
  MonitorUp,
  Phone,
  ScreenShareOff,
  Settings,
  Video,
  VideoOff,
} from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { AudioDeviceMenuItems } from "@/components/audio-device-menu";
import { Nameplate } from "@/components/profile/nameplate";
import { useAudioPreferences } from "@/components/audio-provider";
import { useCall } from "@/components/call/call-provider";
import { CallParticipantStrip } from "@/components/call/call-participant-strip";
import { ConnectionDetails } from "@/components/call/connection-details";
import { SoundboardButton } from "@/components/call/soundboard";
import { StatusDialog } from "@/components/status-dialog";
import { useCallTitle } from "@/components/call/use-call-title";
import { PresenceBadge } from "@/components/presence-dot";
import { presenceHeadline, topActivity } from "@/components/rich-presence-card";
import type { RichPresenceActivity } from "@/types/desktop-api";
import {
  Avatar,
  AvatarDecoration,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMediaDeviceAvailability } from "@/hooks/use-media-devices";
import { ownDecorationState } from "@/lib/avatar-decorations";
import { useMyPresence, useSetPresenceStatus } from "@/hooks/use-presence";
import { useOpenSettings } from "@/components/settings/settings-dialog";
import {
  STATUS_LABEL,
  type FriendStatus,
} from "@/lib/presence";
import { ProfilePopoverContent } from "@/components/profile/profile-popover";
import { Popover, PopoverTrigger } from "../ui/popover";
import { MemberProfileCard } from "../community/member-profile-card";
import { useEffect, useRef, useState } from "react";
import { useUiPreferences } from "../ui-preferences-provider";
import { cn } from "@/lib/utils";
import { MicIcon, MicOffIcon, HeadphonesIcon, HeadphoneOffIcon, SettingsIcon, ChevronUpIcon } from "@animateicons/react/lucide";

export let USER_CARD_HEIGHT: number = 0;

export function UserCard() {
  const me = useQuery(api.users.getCurrentUser);
  const { status, manualStatus, activities } = useMyPresence();
  const setStatus = useSetPresenceStatus();
  const {
    activeCall,
    controller,
    expand,
    leaveCall,
    sharedSourceName,
    openSharePicker,
    openShareSettings,
  } = useCall();
  const { muted, deafened, toggleMuted, toggleDeafened } =
    useAudioPreferences();
  const [statusOpen, setStatusOpen] = useState(false);
  const openSettings = useOpenSettings();
  const title = useCallTitle(activeCall);
  const { communityNavStyle } = useUiPreferences();
  const { hasCamera, hasMicrophone } = useMediaDeviceAvailability();
  // Resolved here rather than by a query: this card reads the raw user
  // document, so the birthday-overrides-your-choice rule has to be applied
  // locally — see ownDecorationState.
  const { decoration, isBirthday } = ownDecorationState(me);

  if (!me) return null;

  const { cameraEnabled, screenSharing, toggleCamera, toggleScreenShare } =
    controller;

  // Fold a live screen share into the activities the presence dot reads, so
  // your own avatar shows the streaming glyph — the same thing every other
  // card does for you through `useUserActivities` / `presence.streamOf`, which
  // this card's raw presence read doesn't go through.
  const badgeActivities: RichPresenceActivity[] =
    activeCall && screenSharing
      ? [
          { type: "streaming", name: sharedSourceName || "your screen" },
          ...activities,
        ]
      : activities;

  // Your own card reads the raw profile, so the deadline has to be applied
  // here — everyone else sees it through a query that already has.
  const customStatus =
    me.customStatusExpiresAt && me.customStatusExpiresAt <= Date.now()
      ? undefined
      : me.customStatus;

  // What you are doing and what you say you are doing, on one line — the same
  // rule every other list follows now. A call outranks the plain status label
  // but not either of those: "In voice" is something the panel below already
  // says in more detail.
  const subtitle =
    presenceHeadline(customStatus, topActivity(activities)) ??
    (activeCall ? "In voice" : STATUS_LABEL[status]);

  // The card floats over the left column, so its width has to match what's
  // actually there: the rail plus the sidebar, or — with the communities
  // popover instead of the rail — the sidebar on its own.
  //
  // At the sidebar's own width the identity and the controls can't share a
  // line: 24px of avatar, four 28px buttons and the gaps between them leave
  // the name about 24px, which renders as a single letter and an ellipsis. So
  // they stack instead, which gives the name the full width and doesn't cost
  // any of the controls.
  const compact = communityNavStyle !== "rail";

  /**
   * Mute, deafen, audio devices and settings. Global — they apply whether or
   * not a call is running, and are the state any call is joined in.
   *
   * Pulled out of the row because where it belongs depends on the width:
   * beside the name when the rail leaves room for both, on its own line under
   * the name when it doesn't.
   */
  const controls = (
    <TooltipProvider>
      <div className={cn("flex shrink-0 items-center gap-1", compact && "justify-end")}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-7 shrink-0 hover:bg-black/10",
                muted && "text-destructive hover:bg-destructive/20",
              )}
              disabled={!hasMicrophone}
              onClick={toggleMuted}
            >
              {muted ? (
                <MicOffIcon duration={0.8} className="size-4" />
              ) : (
                <MicIcon duration={0.8} className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {!hasMicrophone
              ? "No microphone detected"
              : muted
                ? "Unmute"
                : "Mute"}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-7 shrink-0 hover:bg-black/10",
                deafened && "text-destructive hover:bg-destructive/20",
              )}
              onClick={toggleDeafened}
            >
              {deafened ? (
                <HeadphoneOffIcon duration={0.8} className="size-4" />
              ) : (
                <HeadphonesIcon duration={0.8} className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {deafened ? "Undeafen" : "Deafen"}
          </TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 hover:bg-black/10"
            >
              <ChevronUpIcon duration={0.8} className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="w-64">
            <AudioDeviceMenuItems />
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 hover:bg-black/10"
          onClick={openSettings}
        >
          <SettingsIcon duration={0.8} className="size-4" />
        </Button>
      </div>
    </TooltipProvider>
  );

  return (
    <div
      className={cn("absolute bottom-0 left-0 shrink-0 p-2 bg-linear-to-b from-transparent to-background", "w-80")}
    >
      {/* Screen share floating panel */}
      {activeCall && screenSharing && (
        <div className="flex items-center gap-2 border-t border-l border-r rounded-t-md border-border/50 bg-card px-2 py-1.5 text-sm">
          <MonitorUp className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate font-medium">
            Sharing{sharedSourceName ? `: ${sharedSourceName}` : ""}
          </span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-muted-foreground hover:bg-black/10"
                  onClick={openShareSettings}
                >
                  <MonitorCog className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                Change screen, audio or quality
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-destructive hover:bg-destructive/20"
                  onClick={() => void toggleScreenShare()}
                >
                  <ScreenShareOff className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Stop sharing</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      {/* Voice connected floating panel */}
      {activeCall && (
        <div
          className={`border-t border-l border-r border-border/50 bg-card ${activeCall && screenSharing ? "rounded-none" : "rounded-t-md"} p-2 shadow-sm`}
        >
          <div className="flex items-center gap-1">
            {/* The status line and the icon beside it are one component now:
                both say how the call is going, and they were saying it in a
                colour that never changed. */}
            <ConnectionDetails
              room={controller.room}
              active={!!activeCall}
              title={title}
              onExpand={expand}
            />

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                    onClick={() => void leaveCall()}
                  >
                    <Phone className="size-4 rotate-135" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Leave call</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <CallParticipantStrip />

          <div className="mt-3 grid grid-cols-4 gap-1.5">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    className="w-full h-7"
                    disabled={!hasMicrophone}
                    onClick={toggleMuted}
                  >
                    {muted ? (
                      <MicOff className="size-4 text-destructive" />
                    ) : (
                      <Mic className="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {!hasMicrophone
                    ? "No microphone detected"
                    : muted
                      ? "Unmute"
                      : "Mute"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    className="w-full h-7"
                    disabled={!hasCamera}
                    onClick={() => void toggleCamera()}
                  >
                    {cameraEnabled ? (
                      <Video className="size-4" />
                    ) : (
                      <VideoOff className="size-4 text-destructive" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {!hasCamera
                    ? "No camera"
                    : cameraEnabled
                      ? "Camera off"
                      : "Camera on"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Same trigger as the full call screen's control bar; the
                className overrides its round 48px shape for this row. */}
            <SoundboardButton variant="secondary" className="h-7 w-full rounded-md" />

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="w-full h-7"
                    onClick={() => {
                      if (screenSharing) void toggleScreenShare();
                      else openSharePicker();
                    }}
                  >
                    {screenSharing ? (
                      <ScreenShareOff className="size-4" />
                    ) : (
                      <MonitorUp className="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {screenSharing ? "Stop sharing" : "Share screen"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      )}

      {/* Identity card — floating pill */}
      <div
        className={`overflow-hidden border border-border/40 ${activeCall ? "rounded-b-md" : "rounded-md"} h-14 bg-card shadow-md`}
      >
        <div
          className={cn(
            "relative flex px-3 py-1.5",
            "items-center gap-2",
          )}
        >
          <Nameplate url={me.nameplateUrl} />
          <div className={cn("flex min-w-0 items-center gap-2", "flex-1")}>
            <Popover>
              <PopoverTrigger asChild>
                <Avatar size="default" className="shrink-0 cursor-pointer">
                  <AvatarImage src={me.imageUrl} alt={me.name} className="rounded-md" />
                  <AvatarFallback>
                    {me.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                  <AvatarDecoration value={decoration} />
                  <PresenceBadge
                    status={status}
                    activities={badgeActivities}
                    accent={me.borderGradientStart}
                    isBirthday={isBirthday}
                  />
                </Avatar>
              </PopoverTrigger>
              {/* The same transparent host every other profile card gets: the
                  card brings its own surface and its frame is drawn outside its
                  edges, so a popover panel behind it shows up as a second box
                  sticking out from under the artwork. */}
              <ProfilePopoverContent
                userId={me._id}
                side="top"
                align="start"
                className="mb-5 -ml-4"
              >
                <MemberProfileCard
                  reserveFrameRoom={false}
                  member={{
                    userId: me._id,
                    name: me.name,
                    username: me.username,
                    imageUrl: me.imageUrl,
                    bio: me.bio,
                    customStatus,
                    bannerUrl: me.bannerUrl,
                    avatarDecoration: decoration,
                    isBirthday,
                    borderGradientStart: me.borderGradientStart,
                    borderGradientEnd: me.borderGradientEnd,
                    // "invisible" appears as offline to others; show the same for self
                    status: (status === "invisible"
                      ? "offline"
                      : status) as FriendStatus,
                  }}
                />
              </ProfilePopoverContent>
            </Popover>

            {/* The name is the second way into the status dialog — the first
                (the pill on your profile card) only exists once you already
                have a custom status set. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setStatusOpen(true)}
                  className="group/name min-w-0 cursor-pointer flex-1 rounded-md px-1 py-0.5 text-left hover:bg-black/10"
                >
                  <p className="truncate text-sm font-semibold">{me.name}</p>
                  <div className="relative h-4 overflow-hidden">
                    <p className="absolute inset-0 flex items-center gap-1 truncate text-xs text-muted-foreground transition-all duration-200 group-hover/name:translate-y-full group-hover/name:opacity-0">
                      <span className="truncate">
                        {subtitle}
                      </span>
                    </p>
                    <p className="absolute inset-0 -translate-y-full truncate text-xs text-muted-foreground opacity-0 transition-all duration-200 group-hover/name:translate-y-0 group-hover/name:opacity-100">
                      @{me.username}
                    </p>
                  </div>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Set your status</TooltipContent>
            </Tooltip>
          </div>

          <StatusDialog open={statusOpen} onOpenChange={setStatusOpen} />
          {controls}
        </div>
      </div>
    </div>
  );
}

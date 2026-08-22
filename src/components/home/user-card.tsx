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
  Radio,
  ScreenShareOff,
  Settings,
  Video,
  VideoOff,
} from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { AudioDeviceMenuItems } from "@/components/audio-device-menu";
import { useAudioPreferences } from "@/components/audio-provider";
import { useCall } from "@/components/call/call-provider";
import { SoundboardButton } from "@/components/call/soundboard";
import { StatusDialog } from "@/components/status-dialog";
import { useCallTitle } from "@/components/call/use-call-title";
import { PresenceDot } from "@/components/presence-dot";
import { ActivityStatusIcon } from "@/components/rich-presence-card";
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMediaDeviceAvailability } from "@/hooks/use-media-devices";
import { useMyPresence, useSetPresenceStatus } from "@/hooks/use-presence";
import { getDesktopAPI } from "@/lib/desktop";
import {
  STATUS_DOT_CLASS,
  STATUS_LABEL,
  type FriendStatus,
  type ManualStatus,
} from "@/lib/presence";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { MemberProfileCard } from "../community/member-profile-card";
import { useEffect, useRef, useState } from "react";
import { useUiPreferences } from "../ui-preferences-provider";
import { cn } from "@/lib/utils";

const MANUAL_STATUSES: ManualStatus[] = ["online", "idle", "dnd", "invisible"];

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
  const title = useCallTitle(activeCall);
  const { communityNavStyle } = useUiPreferences();
  const { hasCamera, hasMicrophone } = useMediaDeviceAvailability();

  if (!me) return null;

  const { cameraEnabled, screenSharing, toggleCamera, toggleScreenShare } =
    controller;

  const subtitle = me.customStatus
    ? `${me.customStatus}`
    : activeCall
      ? "In voice"
      : STATUS_LABEL[status];

  return (
    <div
      className={cn(
        "shrink-0 p-2 absolute bottom-2 left-2 w-82",
        communityNavStyle === "rail" ? "w-82" : "w-64",
      )}
    >
      {/* Screen share floating panel */}
      {activeCall && screenSharing && (
        <div className="flex items-center gap-2 rounded-t-lg border-t border-l border-r border-border/50 bg-card px-2 py-1.5 text-sm">
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
          className={`${screenSharing ? "rounded-none" : "rounded-t-lg"} border-t border-l border-r border-border/50 bg-card p-2 shadow-sm`}
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={expand}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <Radio className="size-4 shrink-0 text-emerald-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-emerald-500">
                  Voice Connected
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {title}
                </p>
              </div>
            </button>

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

          <div className="mt-4 grid grid-cols-4 gap-1.5">
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
            <SoundboardButton className="h-7 w-full rounded-md" />

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
        className={`${activeCall ? "rounded-t-none rounded-b-lg" : "rounded-lg"} overflow-hidden border border-border/40 bg-card shadow-md`}
      >
        <div className="relative flex items-center gap-2 px-3 py-2.5">
          {me.nameplateUrl && (
            <img
              src={me.nameplateUrl}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-20"
              style={{
                WebkitMaskImage:
                  "linear-gradient(to left, black 0%, black 30%, transparent 100%)",
                maskImage:
                  "linear-gradient(to left, black 0%, black 30%, transparent 100%)",
              }}
            />
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Avatar size="sm" className="shrink-0 cursor-pointer">
                <AvatarImage src={me.imageUrl} alt={me.name} />
                <AvatarFallback>
                  {me.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
                <AvatarBadge className={STATUS_DOT_CLASS[status]} />
              </Avatar>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              className="w-72 p-0 mb-5 -ml-4"
            >
              <MemberProfileCard
                member={{
                  userId: me._id,
                  name: me.name,
                  username: me.username,
                  imageUrl: me.imageUrl,
                  bio: me.bio,
                  customStatus: me.customStatus,
                  bannerUrl: me.bannerUrl,
                  borderGradientStart: me.borderGradientStart,
                  borderGradientEnd: me.borderGradientEnd,
                  // "invisible" appears as offline to others; show the same for self
                  status: (status === "invisible"
                    ? "offline"
                    : status) as FriendStatus,
                }}
              />
            </PopoverContent>
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
                  {/* The activity glyph rides along with the status line, so a
                  glance at the user card says "playing / listening / watching"
                  without opening the profile card. */}
                  <p className="absolute inset-0 flex items-center gap-1 truncate text-xs text-muted-foreground transition-all duration-200 group-hover/name:translate-y-full group-hover/name:opacity-0">
                    <ActivityStatusIcon activities={activities} />
                    <span className="truncate">
                      {activities.length > 0 ? " • " : ""}
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
          <StatusDialog open={statusOpen} onOpenChange={setStatusOpen} />

          {/* Global mute/deafen — these apply whether or not a call is
              running, and are the state any call is joined in. */}
          <TooltipProvider>
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
                    <MicOff className="size-4" />
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
                    <HeadphoneOff className="size-4" />
                  ) : (
                    <Headphones className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {deafened ? "Undeafen" : "Deafen"}
              </TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 hover:bg-black/10"
                    >
                      <ChevronUp className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="top">Audio devices</TooltipContent>
              </Tooltip>
              <DropdownMenuContent side="top" align="end" className="w-64">
                <AudioDeviceMenuItems />
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 hover:bg-black/10"
                  onClick={() => void getDesktopAPI()?.settings.open()}
                >
                  <Settings className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Settings</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  );
}

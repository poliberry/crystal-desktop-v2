"use client";

import { useQuery } from "convex/react";
import { Mic, MicOff, MonitorUp, PhoneOff, Radio, ScreenShareOff, Settings, Video, VideoOff } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { useCall } from "@/components/call/call-provider";
import { useCallTitle } from "@/components/call/use-call-title";
import { PresenceDot } from "@/components/presence-dot";
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMediaDeviceAvailability } from "@/hooks/use-media-devices";
import { useMyPresence, useSetPresenceStatus } from "@/hooks/use-presence";
import { getDesktopAPI } from "@/lib/desktop";
import { STATUS_DOT_CLASS, STATUS_LABEL, type ManualStatus } from "@/lib/presence";

const MANUAL_STATUSES: ManualStatus[] = ["online", "idle", "dnd", "invisible"];

/**
 * Bottom-left card — a single card whose height adjusts to what's showing:
 * a "Voice Connected" section (with mic/camera/screen-share toggles and a
 * leave button) only appears on top while a call is active but collapsed
 * (the user is browsing elsewhere); the "who am I" row (avatar, display
 * name — hover reveals the username — status, Settings) is always there.
 * Clicking the name opens the presence switcher — this is the app's only
 * way to change status now that the topbar's status menu and Clerk
 * `UserButton` are gone.
 */
export function UserCard() {
  const me = useQuery(api.users.getCurrentUser);
  const { status, manualStatus } = useMyPresence();
  const setStatus = useSetPresenceStatus();
  const { activeCall, controller, expanded, expand, leaveCall, sharedSourceName, openSharePicker } = useCall();
  const title = useCallTitle(activeCall);
  const { hasCamera, hasMicrophone } = useMediaDeviceAvailability();

  if (!me) return null;

  const { cameraEnabled, microphoneEnabled, screenSharing, toggleCamera, toggleMicrophone, toggleScreenShare } =
    controller;

  return (
    <div className="shrink-0 border-t bg-background/60">
      {activeCall && screenSharing && (
        <div className="flex items-center gap-2 border-b border-dashed bg-primary/10 px-2 py-1.5 text-sm">
          <MonitorUp className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate font-medium">
            Sharing{sharedSourceName ? `: ${sharedSourceName}` : ""}
          </span>
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
        </div>
      )}

      {activeCall && (
        <div className="space-y-1.5 border-b border-dashed p-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={expand}
              disabled={expanded}
              className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
            >
              <Radio className="size-4 shrink-0 text-emerald-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-emerald-500">Voice Connected</p>
                <p className="truncate text-xs text-muted-foreground">{title}</p>
              </div>
            </button>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                  onClick={() => void leaveCall()}
                >
                  <PhoneOff className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Leave call</TooltipContent>
            </Tooltip>
          </div>

          <div className="flex items-center justify-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  className="size-8"
                  disabled={!hasMicrophone}
                  onClick={() => void toggleMicrophone()}
                >
                  {microphoneEnabled ? (
                    <Mic className="size-4" />
                  ) : (
                    <MicOff className="size-4 text-destructive" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {!hasMicrophone
                  ? "No microphone detected"
                  : microphoneEnabled
                    ? "Mute microphone"
                    : "Unmute microphone"}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  className="size-8"
                  disabled={!hasCamera}
                  onClick={() => void toggleCamera()}
                >
                  {cameraEnabled ? <Video className="size-4" /> : <VideoOff className="size-4 text-destructive" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {!hasCamera ? "No camera detected" : cameraEnabled ? "Turn camera off" : "Turn camera on"}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  className="size-8"
                  onClick={() => {
                    if (screenSharing) void toggleScreenShare();
                    else openSharePicker();
                  }}
                >
                  {screenSharing ? <ScreenShareOff className="size-4" /> : <MonitorUp className="size-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{screenSharing ? "Stop sharing" : "Share screen"}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 px-2 py-2">
        <Avatar size="sm">
          <AvatarImage src={me.imageUrl} alt={me.name} />
          <AvatarFallback>{me.name.slice(0, 2).toUpperCase()}</AvatarFallback>
          <AvatarBadge className={STATUS_DOT_CLASS[status]} />
        </Avatar>

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-md px-1 py-0.5 text-left hover:bg-accent/60"
                >
                  <p className="truncate text-sm font-medium">{me.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {activeCall ? "In voice" : STATUS_LABEL[status]}
                  </p>
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">@{me.username}</TooltipContent>
          </Tooltip>

          <DropdownMenuContent align="start" side="top" className="w-48">
            <DropdownMenuLabel>Set status</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={manualStatus}
              onValueChange={(value) => setStatus(value as ManualStatus)}
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

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={() => void getDesktopAPI()?.settings.open()}>
              <Settings className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Settings</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

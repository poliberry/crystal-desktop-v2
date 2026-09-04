"use client";

import {
  Camera,
  CameraOff,
  ChevronUp,
  Headphones,
  HeadphoneOff,
  LogOut,
  Mic,
  MicOff,
  MonitorCog,
  MonitorUp,
  ScreenShareOff,
} from "lucide-react";
import { useState } from "react";

import { AudioDeviceMenuItems } from "@/components/audio-device-menu";
import { SoundboardButton } from "@/components/call/soundboard";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Switch } from "./ui/switch";
import { Checkbox } from "./ui/checkbox";
import { PhoneIcon } from "@animateicons/react/lucide";

interface ControlBarProps {
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  deafened: boolean;
  screenSharing: boolean;
  cameraAvailable?: boolean;
  microphoneAvailable?: boolean;
  onToggleCamera: () => void;
  onToggleMicrophone: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
  /** Re-open the picker against the running share to change screen, audio
   * source or quality without stopping it. */
  onOpenShareSettings: () => void;
  onLeave: () => Promise<void>;
  busy: boolean;
}

function ControlButton({
  label,
  active,
  danger,
  onClick,
  disabled,
  children,
  className,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? "default" : "ghost"}
          size="icon"
          className={cn(
            "size-10",
            active && "bg-primary text-primary-foreground",
            danger &&
              "bg-destructive/15 text-destructive hover:bg-destructive/25",
            className,
          )}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ControlBar({
  cameraEnabled,
  microphoneEnabled,
  deafened,
  screenSharing,
  cameraAvailable = true,
  microphoneAvailable = true,
  onToggleCamera,
  onToggleMicrophone,
  onToggleDeafen,
  onToggleScreenShare,
  onOpenShareSettings,
  onLeave,
  busy,
}: ControlBarProps) {
  const [leaving, setLeaving] = useState(false);

  const handleLeave = async () => {
    setLeaving(true);
    try {
      await onLeave();
    } finally {
      setLeaving(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="flex items-center justify-center gap-3 px-4 py-3">
        {/* Mic, with the device picker hanging off it so switching inputs
            never means leaving the call screen. */}
        <div className="flex items-center gap-2 p-1 rounded-lg border bg-card">
          <div className="hover:bg-background/40 rounded-md">
            <ControlButton
              label={
                !microphoneAvailable
                  ? "No microphone detected"
                  : microphoneEnabled
                    ? "Mute microphone"
                    : "Unmute microphone"
              }
              onClick={onToggleMicrophone}
              disabled={busy || !microphoneAvailable}
              className="rounded-l-md rounded-r-none"
            >
              {microphoneEnabled ? (
                <Mic />
              ) : (
                <MicOff className="text-destructive" />
              )}
            </ControlButton>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-4 rounded-r-md rounded-l-none"
                >
                  <ChevronUp className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-64">
                <AudioDeviceMenuItems />
                <DropdownMenuSeparator />
                <DropdownMenuItem className="justify-between">
                  <p>Deafen</p>
                  <Checkbox
                    checked={deafened}
                    onCheckedChange={onToggleDeafen}
                    disabled={busy}
                  />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <ControlButton
            label={
              !cameraAvailable
                ? "No camera detected"
                : cameraEnabled
                  ? "Turn camera off"
                  : "Turn camera on"
            }
            onClick={onToggleCamera}
            disabled={busy || !cameraAvailable}
          >
            {cameraEnabled ? (
              <Camera />
            ) : (
              <CameraOff className="text-destructive" />
            )}
          </ControlButton>
        </div>

        <div className="flex items-center gap-2 p-1.25 rounded-lg border bg-card">
          <ControlButton
            label={screenSharing ? "Stop sharing screen" : "Share screen"}
            onClick={onToggleScreenShare}
            disabled={busy}
          >
            {screenSharing ? <ScreenShareOff /> : <MonitorUp />}
          </ControlButton>

          {screenSharing && (
            <ControlButton
              label="Change screen, audio or quality"
              onClick={onOpenShareSettings}
            >
              <MonitorCog />
            </ControlButton>
          )}

          <SoundboardButton />
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="destructive"
              className="h-13 w-18 rounded-md"
              onClick={handleLeave}
              disabled={busy || leaving}
            >
              <PhoneIcon duration={1} size={48} className="rotate-135" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Leave room</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

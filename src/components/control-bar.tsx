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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? "default" : "secondary"}
          size="icon"
          className={cn(
            "size-12 rounded-full",
            active && "bg-primary text-primary-foreground",
            danger && "bg-destructive/15 text-destructive hover:bg-destructive/25"
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
      <div className="flex items-center justify-center gap-3 rounded-full border bg-background/80 px-4 py-3 shadow-lg backdrop-blur">
        {/* Mic, with the device picker hanging off it so switching inputs
            never means leaving the call screen. */}
        <div className="relative">
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
          >
            {microphoneEnabled ? <Mic /> : <MicOff className="text-destructive" />}
          </ControlButton>

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="absolute -right-1 -top-1 size-5 rounded-full border shadow-sm"
                  >
                    <ChevronUp className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Audio devices</TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="top" align="start" className="w-64">
              <AudioDeviceMenuItems />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <ControlButton
          label={deafened ? "Undeafen" : "Deafen"}
          danger={deafened}
          onClick={onToggleDeafen}
          disabled={busy}
        >
          {deafened ? <HeadphoneOff /> : <Headphones />}
        </ControlButton>

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
          {cameraEnabled ? <Camera /> : <CameraOff className="text-destructive" />}
        </ControlButton>

        <ControlButton
          label={screenSharing ? "Stop sharing screen" : "Share screen"}
          onClick={onToggleScreenShare}
          disabled={busy}
        >
          {screenSharing ? <ScreenShareOff /> : <MonitorUp />}
        </ControlButton>

        {screenSharing && (
          <ControlButton label="Change screen, audio or quality" onClick={onOpenShareSettings}>
            <MonitorCog />
          </ControlButton>
        )}

        <SoundboardButton />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="destructive"
              size="icon"
              className="size-12 rounded-full"
              onClick={handleLeave}
              disabled={busy || leaving}
            >
              <LogOut />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Leave room</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

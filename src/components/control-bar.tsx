"use client";

import {
  Camera,
  CameraOff,
  LogOut,
  Mic,
  MicOff,
  MonitorUp,
  ScreenShare,
  ScreenShareOff,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ControlBarProps {
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  screenSharing: boolean;
  cameraAvailable?: boolean;
  microphoneAvailable?: boolean;
  onToggleCamera: () => void;
  onToggleMicrophone: () => void;
  onToggleScreenShare: () => void;
  onLeave: () => Promise<void>;
  busy: boolean;
}

function ControlButton({
  label,
  active,
  onClick,
  disabled,
  children,
}: {
  label: string;
  active?: boolean;
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
          className={cn("size-12 rounded-full", active && "bg-primary text-primary-foreground")}
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
  screenSharing,
  cameraAvailable = true,
  microphoneAvailable = true,
  onToggleCamera,
  onToggleMicrophone,
  onToggleScreenShare,
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
    <div className="flex items-center justify-center gap-3 rounded-full border bg-background/80 px-4 py-3 shadow-lg backdrop-blur">
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

      <ControlButton
        label={
          !cameraAvailable ? "No camera detected" : cameraEnabled ? "Turn camera off" : "Turn camera on"
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
  );
}

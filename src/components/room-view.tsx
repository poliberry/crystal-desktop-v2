"use client";

import { AlertTriangle } from "lucide-react";
import { Track } from "livekit-client";

import { useCall } from "@/components/call/call-provider";
import { CallGrid, type CallTile } from "@/components/call/call-grid";
import { ControlBar } from "@/components/control-bar";
import { Badge } from "@/components/ui/badge";
import { useMediaDeviceAvailability } from "@/hooks/use-media-devices";
import type { RoomController } from "@/hooks/use-room";
import { getPlatform, isElectron } from "@/lib/desktop";

export type { RoomController };

interface RoomViewProps {
  roomName: string;
  controller: RoomController;
  onLeave: () => void;
}

export function RoomView({ roomName, controller, onLeave }: RoomViewProps) {
  const {
    room,
    error,
    setError,
    participants,
    cameraEnabled,
    microphoneEnabled,
    screenSharing,
    screenShares,
    systemAudioSharing,
    toggleCamera,
    toggleMicrophone,
    toggleScreenShare,
  } = controller;

  const { openSharePicker } = useCall();
  const { hasCamera, hasMicrophone } = useMediaDeviceAvailability();

  const allParticipants = [
    room.localParticipant,
    ...participants.filter((p) => p.identity !== room.localParticipant.identity),
  ];

  const screenSharers = allParticipants.filter((p) => {
    const pub = p.getTrackPublication(Track.Source.ScreenShare);
    return screenShares.includes(p.identity) && !!pub && !pub.isMuted;
  });

  const tiles: CallTile[] = [
    ...allParticipants.map((participant) => ({
      key: `cam-${participant.identity}`,
      kind: "participant" as const,
      participant,
      isLocal: participant === room.localParticipant,
    })),
    ...screenSharers.map((participant) => ({
      key: `screen-${participant.identity}`,
      kind: "screen" as const,
      participant,
      isLocal: participant === room.localParticipant,
    })),
  ];

  const handleToggleScreenShare = () => {
    if (screenSharing) {
      void toggleScreenShare();
    } else {
      openSharePicker();
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{roomName}</h1>
          <Badge variant="secondary">{allParticipants.length} in room</Badge>
          {systemAudioSharing && <Badge>System audio</Badge>}
        </div>
        <span className="text-xs text-muted-foreground">
          {isElectron() ? `Electron · ${getPlatform()}` : "Browser preview"}
        </span>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4" />
          <span>{error}</span>
          <button className="ml-auto text-xs underline" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1">
        <CallGrid tiles={tiles} />
      </div>

      <div className="flex justify-center">
        <ControlBar
          cameraEnabled={cameraEnabled}
          microphoneEnabled={microphoneEnabled}
          screenSharing={screenSharing}
          cameraAvailable={hasCamera}
          microphoneAvailable={hasMicrophone}
          onToggleCamera={toggleCamera}
          onToggleMicrophone={toggleMicrophone}
          onToggleScreenShare={handleToggleScreenShare}
          onLeave={onLeave}
          busy={false}
        />
      </div>
    </div>
  );
}

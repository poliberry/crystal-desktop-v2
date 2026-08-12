"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Track } from "livekit-client";

import { ParticipantTile } from "@/components/participant-tile";
import { ScreenShareTile } from "@/components/screen-share-tile";
import { ScreenSharePicker } from "@/components/screen-share-picker";
import { ControlBar } from "@/components/control-bar";
import { Badge } from "@/components/ui/badge";
import type { SystemAudioChoice, useRoom } from "@/hooks/use-room";
import { getPlatform, isElectron } from "@/lib/desktop";

export type RoomController = ReturnType<typeof useRoom>;

interface RoomViewProps {
  roomName: string;
  controller: RoomController;
}

export function RoomView({ roomName, controller }: RoomViewProps) {
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
    disconnect,
    toggleCamera,
    toggleMicrophone,
    toggleScreenShare,
    startScreenShare,
  } = controller;

  const [pickerOpen, setPickerOpen] = useState(false);

  const allParticipants = [
    room.localParticipant,
    ...participants.filter((p) => p.identity !== room.localParticipant.identity),
  ];

  const screenSharers = allParticipants.filter((p) => {
    const pub = p.getTrackPublication(Track.Source.ScreenShare);
    return screenShares.includes(p.identity) && !!pub && !pub.isMuted;
  });

  const handleToggleScreenShare = () => {
    if (screenSharing) {
      void toggleScreenShare();
    } else {
      setPickerOpen(true);
    }
  };

  const handleShare = async (sourceId: string, audio: SystemAudioChoice) => {
    setPickerOpen(false);
    try {
      await startScreenShare(sourceId, audio);
    } catch {
      // error surfaced via controller.error
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

      <div className="grid flex-1 grid-cols-1 content-start gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
        {allParticipants.map((participant) => (
          <ParticipantTile
            key={participant.identity}
            participant={participant}
            isLocal={participant === room.localParticipant}
          />
        ))}
        {screenSharers.map((participant) => (
          <ScreenShareTile
            key={`screen-${participant.identity}`}
            participant={participant}
            isLocal={participant === room.localParticipant}
          />
        ))}
      </div>

      <div className="flex justify-center">
        <ControlBar
          cameraEnabled={cameraEnabled}
          microphoneEnabled={microphoneEnabled}
          screenSharing={screenSharing}
          onToggleCamera={toggleCamera}
          onToggleMicrophone={toggleMicrophone}
          onToggleScreenShare={handleToggleScreenShare}
          onLeave={disconnect}
          busy={false}
        />
      </div>

      <ScreenSharePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onShare={(sourceId, audio) => void handleShare(sourceId, audio)}
      />
    </div>
  );
}

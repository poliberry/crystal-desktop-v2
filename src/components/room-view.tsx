"use client";

import { useQuery } from "convex/react";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Track } from "livekit-client";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useAudioPreferences } from "@/components/audio-provider";
import { useCall } from "@/components/call/call-provider";
import {
  CallGrid,
  type CallTile,
  type PendingParticipant,
} from "@/components/call/call-grid";
import { ControlBar } from "@/components/control-bar";
import { Badge } from "@/components/ui/badge";
import { useMediaDeviceAvailability } from "@/hooks/use-media-devices";
import type { RoomController } from "@/hooks/use-room";
import { getPlatform, isElectron } from "@/lib/desktop";
import { startUiSoundLoop } from "@/lib/ui-sounds";

export type { RoomController };

interface RoomViewProps {
  roomName: string;
  controller: RoomController;
  onLeave: () => Promise<void>;
}

export function RoomView({ roomName, controller, onLeave }: RoomViewProps) {
  const { activeCall } = useCall();
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
    subscribeToScreenShare,
    unsubscribeFromScreenShare,
  } = controller;

  const { openSharePicker, openShareSettings } = useCall();

  // A DM or group call shows everyone in the conversation from the start, so
  // it looks like the room it's about to become rather than an empty box.
  // Community voice channels are drop-in, so nobody is "expected" there.
  const conversationId = activeCall?.kind === "dm" ? activeCall.conversationId : null;
  const conversationMembers =
    useQuery(
      api.conversations.listMembersWithPresence,
      conversationId ? { conversationId } : "skip"
    ) ?? [];
  const activeRings =
    useQuery(api.calls.listRingsForConversation, conversationId ? { conversationId } : "skip") ?? [];
  const ringingUserIds = new Set(activeRings);
  // Only a community voice channel has roles to moderate under.
  const moderation =
    activeCall?.kind === "channel"
      ? { communityId: activeCall.communityId, channelId: activeCall.channelId }
      : undefined;
  const { hasCamera, hasMicrophone } = useMediaDeviceAvailability();
  const { deafened, toggleDeafened, uiSoundVolume, outputDeviceId } = useAudioPreferences();

  const allParticipants = [
    room.localParticipant,
    ...participants.filter((p) => p.identity !== room.localParticipant.identity),
  ];

  // LiveKit only knows the name baked into the token at join time, so
  // identities are resolved here instead — against this call's community when
  // it has one, so a per-server nickname or avatar shows in the call exactly
  // as it does in the channel list beside it.
  const userIds = allParticipants.map((p) => p.identity as Id<"users">);
  const userData = useQuery(api.users.getUsersByIds, {
    userIds,
    communityId: activeCall?.kind === "channel" ? activeCall.communityId : undefined,
  });
  const profileByIdentity = new Map(userData?.map((u) => [u.id as string, u]) ?? []);

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
      imageUrl: profileByIdentity.get(participant.identity)?.imageUrl,
      name: profileByIdentity.get(participant.identity)?.name,
      accent: profileByIdentity.get(participant.identity)?.avatarAccent,
    })),
    ...screenSharers.map((participant) => ({
      key: `screen-${participant.identity}`,
      kind: "screen" as const,
      participant,
      isLocal: participant === room.localParticipant,
      name: profileByIdentity.get(participant.identity)?.name,
    })),
  ];

  const connectedIds = new Set(allParticipants.map((p) => p.identity));
  const pending: PendingParticipant[] = conversationMembers
    .filter((member) => !connectedIds.has(member.userId))
    .map((member) => ({
      userId: member.userId,
      name: member.name,
      imageUrl: member.imageUrl,
      ringing: ringingUserIds.has(member.userId),
    }));

  // Ringback: only while we're alone and someone is still being rung, so it
  // stops the moment anyone picks up.
  const waitingAlone = allParticipants.length === 1 && activeRings.length > 0;
  useEffect(() => {
    if (!waitingAlone) return;
    return startUiSoundLoop("ringOutgoing", {
      volume: uiSoundVolume,
      outputDeviceId: outputDeviceId || undefined,
    });
  }, [waitingAlone, uiSoundVolume, outputDeviceId]);

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
          {deafened && <Badge variant="destructive">Deafened</Badge>}
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
        <CallGrid
          tiles={tiles}
          pending={pending}
          moderation={moderation}
          onSubscribeScreenShare={subscribeToScreenShare}
          onUnsubscribeScreenShare={unsubscribeFromScreenShare}
        />
      </div>

      <div className="flex justify-center">
        <ControlBar
          cameraEnabled={cameraEnabled}
          microphoneEnabled={microphoneEnabled}
          deafened={deafened}
          screenSharing={screenSharing}
          cameraAvailable={hasCamera}
          microphoneAvailable={hasMicrophone}
          onToggleCamera={toggleCamera}
          onToggleMicrophone={toggleMicrophone}
          onToggleDeafen={toggleDeafened}
          onToggleScreenShare={handleToggleScreenShare}
          onOpenShareSettings={openShareSettings}
          onLeave={onLeave}
          busy={false}
        />
      </div>
    </div>
  );
}

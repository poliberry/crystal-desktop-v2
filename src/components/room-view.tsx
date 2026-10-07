"use client";

import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
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

/** How long the pointer can sit still before the header and controls leave. */
const CHROME_IDLE_MS = 2500;
const CHROME_TRANSITION = { duration: 0.28, ease: "easeOut" as const };

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
  } = controller;

  const { openSharePicker, openShareSettings, watchIntent, clearWatchIntent } = useCall();

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
      gradientStart: profileByIdentity.get(participant.identity)?.borderGradientStart,
      gradientEnd: profileByIdentity.get(participant.identity)?.borderGradientEnd,
      avatarDecoration: profileByIdentity.get(participant.identity)?.avatarDecoration,
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

  // The header and the control bar are there while the pointer is moving in the
  // room and slide away when it stops or leaves, like a video player's. They
  // stay while the pointer is on them, while the device pickers are open, and
  // while a popover (the soundboard) is — which lives in a portal outside the
  // room, so the pointer "leaving" onto it must not count.
  const [chromeShown, setChromeShown] = useState(true);
  const hoveringChrome = useRef(false);
  const pickersOpen = useRef(false);
  const idleTimer = useRef<number | undefined>(undefined);

  const popoverOpen = () =>
    !!document.querySelector('[data-slot="popover-content"][data-state="open"]');
  const canHide = () => !hoveringChrome.current && !pickersOpen.current && !popoverOpen();

  const wake = useCallback(() => {
    setChromeShown(true);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      if (canHide()) setChromeShown(false);
      // Something is holding them up: look again shortly rather than never.
      else idleTimer.current = window.setTimeout(wake, 1500);
    }, CHROME_IDLE_MS);
  }, []);

  const leaveRoom = useCallback(() => {
    window.clearTimeout(idleTimer.current);
    if (canHide()) setChromeShown(false);
    else idleTimer.current = window.setTimeout(wake, 1500);
  }, [wake]);

  useEffect(() => {
    wake();
    return () => window.clearTimeout(idleTimer.current);
  }, [wake]);

  const setPickersOpen = useCallback(
    (open: boolean) => {
      pickersOpen.current = open;
      if (open) wake();
    },
    [wake],
  );

  const chromeHover = {
    onPointerEnter: () => {
      hoveringChrome.current = true;
    },
    onPointerLeave: () => {
      hoveringChrome.current = false;
    },
  };

  const handleToggleScreenShare = () => {
    if (screenSharing) {
      void toggleScreenShare();
    } else {
      openSharePicker();
    }
  };

  return (
    <div
      className="flex h-full flex-col gap-4 p-4"
      onPointerMove={wake}
      onPointerDown={wake}
      onPointerLeave={leaveRoom}
    >
      <motion.div
        className="flex items-center justify-between"
        initial={false}
        animate={{ opacity: chromeShown ? 1 : 0, y: chromeShown ? 0 : -24 }}
        transition={CHROME_TRANSITION}
        style={{ pointerEvents: chromeShown ? "auto" : "none" }}
        {...chromeHover}
      >
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">{roomName}</h1>
          <Badge variant="secondary">{allParticipants.length} in room</Badge>
          {systemAudioSharing && <Badge>System audio</Badge>}
          {deafened && <Badge variant="destructive">Deafened</Badge>}
        </div>
        <span className="text-xs text-muted-foreground">
          {isElectron() ? `Electron · ${getPlatform()}` : "Browser preview"}
        </span>
      </motion.div>

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
          autoWatchIdentity={watchIntent}
          onAutoWatched={clearWatchIntent}
        />
      </div>

      {/* A fixed-height slot with the bar anchored to its bottom, so the bar
          grows upward over the grid when the device pickers open instead of
          pushing the tiles around. */}
      <div className="relative h-[68px] shrink-0">
        <motion.div
          className="absolute inset-x-0 bottom-0 z-20 flex justify-center"
          initial={false}
          animate={{ opacity: chromeShown ? 1 : 0, y: chromeShown ? 0 : 32 }}
          transition={CHROME_TRANSITION}
          style={{ pointerEvents: chromeShown ? "auto" : "none" }}
          {...chromeHover}
        >
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
          onPickersOpenChange={setPickersOpen}
        />
        </motion.div>
      </div>
    </div>
  );
}

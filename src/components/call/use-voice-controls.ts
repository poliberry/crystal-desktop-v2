"use client";

import { useMutation, useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useAudioPreferences } from "@/components/audio-provider";
import { useCall } from "@/components/call/call-provider";
import { keyLabel } from "@/lib/push-to-talk";
import {
  PUSH_TO_TALK_REQUIRED_REASON,
  cameraBlockedReason,
  microphoneBlockedReason,
  screenShareBlockedReason,
} from "@/lib/voice-policy";

export interface StageControls {
  role: "speaker" | "audience";
  handRaised: boolean;
  /** Why the hand can't be raised, or null. */
  raiseBlockedReason: string | null;
  onToggleHand: () => void;
  /** A speaker steps back down to the audience. */
  onLeaveStage: () => void;
}

export interface VoiceControls {
  channelId: Id<"channels"> | null;
  micBlockedReason: string | null;
  cameraBlockedReason: string | null;
  screenShareBlockedReason: string | null;
  /** Set while the call runs push-to-talk. */
  pushToTalk: { held: boolean; keyLabel: string; forced: boolean; forcedReason: string } | null;
  stage: StageControls | null;
  activities: { available: boolean; blockedReason: string | null } | null;
}

/**
 * What the call's controls should offer, and why anything is switched off.
 *
 * The rights themselves belong to the server (they are signed into the LiveKit token and held by the room); this
 * only reads them so a control that would be refused is shown off with its reason instead of failing when pressed.
 * Used by the call bar in a voice channel and the lounge; a DM call gets all-clear.
 */
export function useVoiceControls(): VoiceControls {
  const { activeCall, controller } = useCall();
  const { muted } = useAudioPreferences();
  const channelId = activeCall?.kind === "channel" ? activeCall.channelId : null;
  const channel = useQuery(api.channels.get, channelId ? { channelId } : "skip");
  const roster = useQuery(api.channels.listVoiceParticipants, channelId ? { channelId } : "skip");
  const me = useQuery(api.users.getCurrentUser);
  const raiseHand = useMutation(api.voiceChannels.raiseHand);
  const setSpeaker = useMutation(api.voiceChannels.setSpeaker);
  const { policy, inputMode, pushToTalkKey, pttHeld } = controller;

  const inChannel = !!channelId;
  const stageRole = policy.stageRole;
  const myRow = roster?.find((p) => p.id === me?._id);

  const stage: StageControls | null =
    inChannel && channel?.isStage && stageRole
      ? {
          role: stageRole,
          handRaised: myRow?.handRaisedAt !== undefined,
          raiseBlockedReason: !channel.canRequestToSpeak
            ? "You don't have permission to ask to speak on this stage."
            : !channel.canSpeak
              ? "You don't have permission to speak in this channel."
              : null,
          onToggleHand: () => {
            if (!channelId) return;
            void raiseHand({ channelId, raised: myRow?.handRaisedAt === undefined }).catch(() => {});
          },
          onLeaveStage: () => {
            if (!channelId || !me) return;
            void setSpeaker({ channelId, userId: me._id, speaker: false }).catch(() => {});
          },
        }
      : null;

  return {
    channelId,
    micBlockedReason: inChannel ? microphoneBlockedReason(policy) : null,
    cameraBlockedReason: inChannel ? cameraBlockedReason(policy) : null,
    screenShareBlockedReason: inChannel ? screenShareBlockedReason(policy) : null,
    pushToTalk:
      inChannel && inputMode === "ptt" && !muted
        ? { held: pttHeld, keyLabel: keyLabel(pushToTalkKey), forced: policy.mustPushToTalk, forcedReason: PUSH_TO_TALK_REQUIRED_REASON }
        : inChannel && inputMode === "ptt"
          ? { held: false, keyLabel: keyLabel(pushToTalkKey), forced: policy.mustPushToTalk, forcedReason: PUSH_TO_TALK_REQUIRED_REASON }
          : null,
    stage,
    activities:
      inChannel && channel && !channel.isStage && !channel.isLounge
        ? {
            available: channel.canUseActivities,
            blockedReason: channel.canUseActivities ? null : "You don't have permission to start activities in this channel.",
          }
        : null,
  };
}

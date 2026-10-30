/**
 * What the server has allowed the local participant to do in a community voice room, as the room reports it.
 *
 * The truth is in the LiveKit token (convex/lib/voiceGrant.ts): publish rights (`permissions`) and a few
 * attributes the server signs in — push-to-talk required, priority speaker, stage role, soundboard rights.
 * This reads them for the UI, so a control that LiveKit would refuse is turned off with a reason instead of
 * failing when pressed. It decides nothing itself: if this says "allowed" and the room says no, the room wins.
 * Pure — no LiveKit import — so it is tested alone (scripts/tests/voice-policy.test.mts).
 */

/** LiveKit's `TrackSource` enum values (the protocol's numbers). */
export const SOURCE = { camera: 1, microphone: 2, screenShare: 3, screenShareAudio: 4 } as const;

/** The part of LiveKit's `ParticipantPermission` this reads. */
export interface PermissionsLike {
  canPublish: boolean;
  canPublishSources?: number[];
}

/** Whether publishing `source` is allowed. No permissions reported (a DM call) or an empty source list means no restriction. */
export function canPublishSource(permissions: PermissionsLike | undefined | null, source: number): boolean {
  if (!permissions) return true;
  if (!permissions.canPublish) return false;
  const sources = permissions.canPublishSources ?? [];
  return sources.length === 0 || sources.includes(source);
}

export type StageRole = "speaker" | "audience";

export interface VoicePolicy {
  canMicrophone: boolean;
  canCamera: boolean;
  canScreenShare: boolean;
  /** Voice activity isn't allowed here: the member must push to talk. */
  mustPushToTalk: boolean;
  /** Set on a stage channel only. */
  stageRole: StageRole | null;
  priority: boolean;
}

type Attributes = Record<string, string> | undefined | null;

export function readVoicePolicy(permissions: PermissionsLike | undefined | null, attributes: Attributes): VoicePolicy {
  const stage = attributes?.stage;
  return {
    canMicrophone: canPublishSource(permissions, SOURCE.microphone),
    canCamera: canPublishSource(permissions, SOURCE.camera),
    canScreenShare: canPublishSource(permissions, SOURCE.screenShare),
    mustPushToTalk: attributes?.ptt === "1",
    stageRole: stage === "speaker" || stage === "audience" ? stage : null,
    priority: attributes?.priority === "1",
  };
}

/** A sender's soundboard rights as the server signed them. Absent means allowed, so sessions that began before these existed keep working. */
export function readSoundboardRights(attributes: Attributes): { soundboard: boolean; externalSounds: boolean } {
  return { soundboard: attributes?.sb !== "0", externalSounds: attributes?.xs !== "0" };
}

/** Why a control is off, for a tooltip — or null if it isn't. */
export function microphoneBlockedReason(policy: VoicePolicy): string | null {
  if (policy.stageRole === "audience") return "You're in the audience. Raise your hand to ask to speak.";
  if (!policy.canMicrophone) return "You don't have permission to speak in this channel.";
  return null;
}

export function cameraBlockedReason(policy: VoicePolicy): string | null {
  if (policy.stageRole === "audience") return "Only speakers can turn their camera on.";
  if (!policy.canCamera) return "You don't have permission to use video in this channel.";
  return null;
}

export function screenShareBlockedReason(policy: VoicePolicy): string | null {
  if (policy.stageRole === "audience") return "Only speakers can share their screen.";
  if (!policy.canScreenShare) return "You don't have permission to share your screen in this channel.";
  return null;
}

/** Shown where the voice activity option would be, when the community has taken it away. */
export const PUSH_TO_TALK_REQUIRED_REASON =
  "This community requires push-to-talk. Voice activity isn't available to you here.";

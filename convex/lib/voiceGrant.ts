/**
 * What a member may do inside a community voice room, worked out from their permissions.
 *
 * Pure — no database, no LiveKit — so the rules are tested on their own (scripts/tests/voice-grant.test.mts)
 * and the same answer is used when a token is minted (convex/channelCalls.ts), when a bot joins
 * (convex/botVoice.ts) and when someone's permissions change mid-call (convex/voiceSync.ts). The token's
 * grant is what LiveKit enforces, so this is the server's authority over who can publish; the client only
 * reflects it.
 *
 * Sources are spelled as plain strings here so this file needs no LiveKit import; the Node side maps them
 * to `TrackSource`.
 */

export type VoiceSource = "microphone" | "camera" | "screen_share" | "screen_share_audio";

export interface VoiceGrantInput {
  /** Speak: the microphone. */
  canSpeak: boolean;
  /** Video: the camera and screen share (with its audio). */
  canVideo: boolean;
  /** Use voice activity detection; without it the member must push to talk. */
  canUseVad: boolean;
  /** Play soundboard clips; without it the room drops their packets. */
  canSoundboard: boolean;
  /** Play clips from other communities. */
  canExternalSounds: boolean;
  /** Priority speaker: others are turned down while they talk. */
  hasPriority: boolean;
  /** A moderator's server mute: takes the microphone away. */
  serverMuted: boolean;
  /** A moderator's server deafen: takes everything they could hear away. */
  serverDeafened: boolean;
  /** The channel is a stage: only speakers are heard; everyone else listens. */
  stage: boolean;
  /** On a stage, whether they hold the power to bring people up (Mute Members). They speak without asking. */
  stageModerator: boolean;
  /** On a stage, whether a moderator has let them speak. */
  stageApproved: boolean;
}

export interface VoiceGrant {
  /** May publish anything at all. */
  canPublish: boolean;
  sources: VoiceSource[];
  canSubscribe: boolean;
  /** Data packets: soundboard, join sounds, stream-watch cues. Not for a stage's audience. */
  canPublishData: boolean;
  /** On a stage, whether they are up with the speakers. Always false off a stage. */
  stageSpeaker: boolean;
  /** Signed into the token, so a client can't claim them. Everyone in the room reads these. */
  attributes: Record<string, string>;
}

/** The stage-speaker rule on its own: a moderator, or someone a moderator approved, who is also allowed to speak. */
export function isStageSpeaker(input: Pick<VoiceGrantInput, "stage" | "canSpeak" | "stageModerator" | "stageApproved">): boolean {
  if (!input.stage) return false;
  return input.canSpeak && (input.stageModerator || input.stageApproved);
}

export function resolveVoiceGrant(input: VoiceGrantInput): VoiceGrant {
  const stageSpeaker = isStageSpeaker(input);
  // Off a stage everyone is "up"; on one, only speakers are.
  const up = !input.stage || stageSpeaker;

  const sources: VoiceSource[] = [];
  if (input.canSpeak && !input.serverMuted && up) sources.push("microphone");
  if (input.canVideo && up) sources.push("camera", "screen_share", "screen_share_audio");

  const attributes: Record<string, string> = {};
  // Only someone who can be heard has priority to speak with.
  if (input.hasPriority && input.canSpeak) attributes.priority = "1";
  if (!input.canUseVad) attributes.ptt = "1";
  // Absent means allowed, so a session that began before these existed keeps working. On a stage the audience
  // has no soundboard either, whatever their permissions say.
  if (!input.canSoundboard || !up) attributes.sb = "0";
  if (!input.canExternalSounds) attributes.xs = "0";
  if (input.stage) attributes.stage = stageSpeaker ? "speaker" : "audience";

  return {
    canPublish: sources.length > 0,
    sources,
    canSubscribe: !input.serverDeafened,
    canPublishData: up,
    stageSpeaker,
    attributes,
  };
}

/** A short string that changes whenever the grant does, so a permission change only touches LiveKit for the people it affects. */
export function voiceGrantKey(grant: VoiceGrant): string {
  const attrs = Object.entries(grant.attributes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return [grant.sources.join("+") || "-", grant.canSubscribe ? "s" : "x", grant.canPublishData ? "d" : "-", grant.stageSpeaker ? "S" : "-", attrs].join("|");
}

/** The longest status line a voice channel may carry. */
export const VOICE_STATUS_MAX = 80;

/** A voice status as it is stored: trimmed, single-line, capped. Empty clears it. */
export function cleanVoiceStatus(raw: string): string | undefined {
  const text = raw.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, VOICE_STATUS_MAX).trim();
  return text || undefined;
}

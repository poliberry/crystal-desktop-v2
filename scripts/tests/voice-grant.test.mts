// Run: npx tsx scripts/tests/voice-grant.test.mts
import { cleanVoiceStatus, isStageSpeaker, resolveVoiceGrant, voiceGrantKey, VOICE_STATUS_MAX, type VoiceGrantInput } from "../../convex/lib/voiceGrant";

let f = 0, p = 0;
const eq = (n: string, got: unknown, want: unknown) => { JSON.stringify(got) === JSON.stringify(want) ? p++ : (f++, console.log("FAIL", n, { got, want })); };

const base: VoiceGrantInput = {
  canSpeak: true, canVideo: true, canUseVad: true, canSoundboard: true, canExternalSounds: true, hasPriority: false,
  serverMuted: false, serverDeafened: false, stage: false, stageModerator: false, stageApproved: false,
};
const grant = (over: Partial<VoiceGrantInput>) => resolveVoiceGrant({ ...base, ...over });

// The ordinary channel: Speak is the microphone, Video the camera and screen (and its audio).
eq("speak + video: everything", grant({}).sources, ["microphone", "camera", "screen_share", "screen_share_audio"]);
eq("screen share is part of video (the regression)", grant({ canSpeak: false }).sources, ["camera", "screen_share", "screen_share_audio"]);
eq("speak only: the microphone alone", grant({ canVideo: false }).sources, ["microphone"]);
eq("neither: listen only, cannot publish", [grant({ canSpeak: false, canVideo: false }).canPublish, grant({ canSpeak: false, canVideo: false }).sources], [false, []]);
eq("can publish when there is a source", grant({}).canPublish, true);
eq("data packets are allowed in an ordinary channel", grant({}).canPublishData, true);
eq("subscribing is allowed", grant({}).canSubscribe, true);

// Moderator holds.
eq("server mute takes the microphone away", grant({ serverMuted: true }).sources.includes("microphone"), false);
eq("server mute leaves video alone", grant({ serverMuted: true }).sources.includes("camera"), true);
eq("server deafen takes subscribing away", grant({ serverDeafened: true }).canSubscribe, false);
eq("server deafen leaves publishing alone", grant({ serverDeafened: true }).canPublish, true);

// Signed attributes.
eq("no attributes by default", grant({}).attributes, {});
eq("priority speaker is signed", grant({ hasPriority: true }).attributes, { priority: "1" });
eq("priority without Speak is not signed (nothing to be heard over)", grant({ hasPriority: true, canSpeak: false }).attributes, {});
eq("without voice activity: push-to-talk is signed", grant({ canUseVad: false }).attributes, { ptt: "1" });
eq("no soundboard is signed", grant({ canSoundboard: false }).attributes, { sb: "0" });
eq("no external sounds is signed", grant({ canExternalSounds: false }).attributes, { xs: "0" });

// Stages.
const stage = { stage: true };
eq("audience: no publish rights at all", [grant(stage).canPublish, grant(stage).sources, grant(stage).stageSpeaker], [false, [], false]);
eq("audience: no data packets (no soundboard)", grant(stage).canPublishData, false);
eq("audience can still listen", grant(stage).canSubscribe, true);
eq("audience is labelled", grant(stage).attributes.stage, "audience");
eq("audience has no soundboard signed", grant(stage).attributes.sb, "0");
eq("a moderator is a speaker without asking", [grant({ ...stage, stageModerator: true }).stageSpeaker, grant({ ...stage, stageModerator: true }).sources.includes("microphone")], [true, true]);
eq("an approved member speaks", [grant({ ...stage, stageApproved: true }).stageSpeaker, grant({ ...stage, stageApproved: true }).canPublish], [true, true]);
eq("a speaker is labelled", grant({ ...stage, stageApproved: true }).attributes.stage, "speaker");
eq("approved but not allowed to speak stays in the audience", [grant({ ...stage, stageApproved: true, canSpeak: false }).stageSpeaker, grant({ ...stage, stageApproved: true, canSpeak: false }).canPublish], [false, false]);
eq("a muted speaker is still up but silent", [grant({ ...stage, stageApproved: true, serverMuted: true }).stageSpeaker, grant({ ...stage, stageApproved: true, serverMuted: true }).sources.includes("microphone")], [true, false]);
eq("speakers keep video", grant({ ...stage, stageApproved: true }).sources.includes("screen_share"), true);
eq("audience gets no video even with Video", grant({ ...stage, canVideo: true }).sources.includes("camera"), false);
eq("stage speaker rule alone", isStageSpeaker({ stage: true, canSpeak: true, stageModerator: false, stageApproved: true }), true);
eq("off a stage nobody is a stage speaker", isStageSpeaker({ stage: false, canSpeak: true, stageModerator: true, stageApproved: true }), false);

// Keys: change when, and only when, the grant does.
const key = (over: Partial<VoiceGrantInput>) => voiceGrantKey(grant(over));
eq("same grant, same key", key({}), key({}));
eq("a mute changes the key", key({}) !== key({ serverMuted: true }), true);
eq("a deafen changes the key", key({}) !== key({ serverDeafened: true }), true);
eq("priority changes the key", key({}) !== key({ hasPriority: true }), true);
eq("being promoted changes the key", key({ stage: true }) !== key({ stage: true, stageApproved: true }), true);
eq("a permission that changes nothing in the grant leaves the key alone", key({ stageApproved: true }), key({}));

// Status lines.
eq("status is trimmed", cleanVoiceStatus("  Playing ranked  "), "Playing ranked");
eq("status is one line", cleanVoiceStatus("a\nb\r\nc"), "a b c");
eq("empty clears", cleanVoiceStatus("   "), undefined);
eq("status is capped", cleanVoiceStatus("x".repeat(500))?.length, VOICE_STATUS_MAX);

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);

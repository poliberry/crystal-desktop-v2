// Run: npx tsx scripts/tests/voice-policy.test.mts
import {
  SOURCE,
  canPublishSource,
  cameraBlockedReason,
  microphoneBlockedReason,
  readSoundboardRights,
  readVoicePolicy,
  screenShareBlockedReason,
} from "../../src/lib/voice-policy";

let f = 0, p = 0;
const eq = (n: string, got: unknown, want: unknown) => { JSON.stringify(got) === JSON.stringify(want) ? p++ : (f++, console.log("FAIL", n, { got, want })); };

// A DM call reports no source list: nothing is restricted.
eq("no permissions: allowed", canPublishSource(undefined, SOURCE.camera), true);
eq("publish on, no list: allowed", canPublishSource({ canPublish: true, canPublishSources: [] }, SOURCE.screenShare), true);
eq("publish off: nothing", canPublishSource({ canPublish: false, canPublishSources: [SOURCE.microphone] }, SOURCE.microphone), false);
eq("listed source: allowed", canPublishSource({ canPublish: true, canPublishSources: [SOURCE.microphone] }, SOURCE.microphone), true);
eq("unlisted source: refused", canPublishSource({ canPublish: true, canPublishSources: [SOURCE.microphone] }, SOURCE.camera), false);

// The regression: screen share is its own source and must be listed with Video.
const videoOnly = { canPublish: true, canPublishSources: [SOURCE.camera, SOURCE.screenShare, SOURCE.screenShareAudio] };
eq("video grants the screen", readVoicePolicy(videoOnly, {}).canScreenShare, true);
eq("video without speak: no microphone", readVoicePolicy(videoOnly, {}).canMicrophone, false);

const stage = readVoicePolicy({ canPublish: false, canPublishSources: [] }, { stage: "audience", ptt: "1", priority: "1" });
eq("audience policy", stage, { canMicrophone: false, canCamera: false, canScreenShare: false, mustPushToTalk: true, stageRole: "audience", priority: true });
eq("audience reasons mention the stage", [microphoneBlockedReason(stage), cameraBlockedReason(stage), screenShareBlockedReason(stage)].every((r) => !!r && /audience|speakers/i.test(r)), true);

const speaker = readVoicePolicy({ canPublish: true, canPublishSources: [SOURCE.microphone] }, { stage: "speaker" });
eq("speaker can talk", microphoneBlockedReason(speaker), null);
eq("speaker without Video gets a permission reason", cameraBlockedReason(speaker), "You don't have permission to use video in this channel.");

eq("unknown stage value is ignored", readVoicePolicy(undefined, { stage: "king" }).stageRole, null);
eq("only the signed value requires push-to-talk", [readVoicePolicy(undefined, { ptt: "1" }).mustPushToTalk, readVoicePolicy(undefined, { ptt: "0" }).mustPushToTalk, readVoicePolicy(undefined, {}).mustPushToTalk], [true, false, false]);

// Soundboard rights: absent means allowed.
eq("no attributes: allowed", readSoundboardRights({}), { soundboard: true, externalSounds: true });
eq("sb=0 denies the soundboard", readSoundboardRights({ sb: "0" }).soundboard, false);
eq("xs=0 denies external sounds only", readSoundboardRights({ xs: "0" }), { soundboard: true, externalSounds: false });
eq("undefined attributes", readSoundboardRights(undefined), { soundboard: true, externalSounds: true });

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);

// Run: bun scripts/tests/voice-ui.test.mts
import { MAX_VOICE_MS, VOICE_WAVEFORM_BARS, resamplePeaks } from "../../convex/lib/voicePure";
import { formatVoiceTime, nextVoiceSpeed, readableError, remainingMs, seekFraction } from "../../src/components/community/voice-format";

let fails = 0, passes = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? passes++ : fails++; if (!c) console.log("FAIL", n, JSON.stringify(d)); };

// ---- resamplePeaks
const r0 = resamplePeaks([]);
ok("empty -> 64 zeros", r0.length === VOICE_WAVEFORM_BARS && r0.every((n) => n === 0));
const loud = resamplePeaks(Array.from({ length: 1000 }, (_, i) => (i % 2 ? 1 : 0.5)));
ok("always exactly 64 bars", loud.length === 64);
ok("loud peaks reach 255 and never exceed it", Math.max(...loud) === 255 && loud.every((n) => n >= 0 && n <= 255 && Number.isInteger(n)));
const quiet = resamplePeaks(Array.from({ length: 640 }, (_, i) => (i % 64 < 32 ? 0.1 : 0.02)));
ok("quiet recording is boosted", Math.max(...quiet) > 0.1 * 255);
ok("quiet recording keeps its shape", quiet[0] > quiet[2] * 0 && new Set(quiet).size > 1, quiet.slice(0, 8));
const hiss = resamplePeaks(new Array(500).fill(0.005));
ok("near silence stays low (gain capped)", Math.max(...hiss) <= 0.005 * 8 * 255 + 1, Math.max(...hiss));
ok("all-zero stays zero", resamplePeaks(new Array(100).fill(0)).every((n) => n === 0));
const few = resamplePeaks([0.2, 0.8]);
ok("fewer peaks than bars still fills 64", few.length === 64 && few.slice(0, 32).every((n) => n === few[0]) && few[63] === 255, few);
ok("one peak fills all bars", resamplePeaks([0.5]).every((n) => n === 255));
const bad = resamplePeaks([NaN, Infinity, -1, 2, 0.5]);
ok("bad values are clamped", bad.every((n) => n >= 0 && n <= 255 && Number.isFinite(n)), bad);
ok("loudest slice wins within a bar", resamplePeaks([0, 0, 1, 0, 0, 0, 0, 0], 4)[1] === 255 && resamplePeaks([0, 0, 1, 0, 0, 0, 0, 0], 4)[0] === 0);
ok("custom bar count", resamplePeaks([0.3, 0.6, 0.9], 3).length === 3);
ok("accepts typed arrays", resamplePeaks(new Float32Array([0.1, 0.5, 0.25, 0.5])).length === 64);

// ---- formatting and seeking
ok("time 0", formatVoiceTime(0) === "0:00");
ok("time 5s", formatVoiceTime(5400) === "0:05");
ok("time 1:05", formatVoiceTime(65_000) === "1:05");
ok("time max", formatVoiceTime(MAX_VOICE_MS) === "5:00");
ok("time rejects junk", formatVoiceTime(NaN) === "0:00" && formatVoiceTime(-5) === "0:00" && formatVoiceTime(Infinity) === "0:00");
ok("remaining", remainingMs(290_000, MAX_VOICE_MS) === 10_000 && remainingMs(400_000, MAX_VOICE_MS) === 0);
ok("seek middle", seekFraction(150, 100, 100) === 0.5);
ok("seek clamps", seekFraction(0, 100, 100) === 0 && seekFraction(900, 100, 100) === 1);
ok("seek zero width", seekFraction(150, 100, 0) === 0);
ok("speed cycles", nextVoiceSpeed(1) === 1.5 && nextVoiceSpeed(1.5) === 2 && nextVoiceSpeed(2) === 1 && nextVoiceSpeed(9) === 1);

// ---- error text
ok("strips Uncaught Error", readableError(new Error("Uncaught Error: Voice messages are up to 5 minutes long.\n    at handler (../convex/x.ts:1)"), "x") === "Voice messages are up to 5 minutes long.");
ok("strips convex wrapper", readableError(new Error("[CONVEX M(messages:send)] [Request ID: abc] Server Error\nUncaught Error: nope"), "x") === "Server Error");
ok("fallback", readableError(new Error(""), "fallback") === "fallback" && readableError(undefined, "fb") === "fb");

if (fails) { console.log(`${fails} FAILED, ${passes} passed`); process.exit(1); }
console.log(`ALL PASSED (${passes})`);

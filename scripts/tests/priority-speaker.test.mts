// Run: npx tsx scripts/tests/priority-speaker.test.mts
import {
  PRIORITY_DUCK_GAIN,
  PRIORITY_TIMING,
  PriorityTracker,
  isPriorityAttributes,
  priorityIsSpeaking,
  priorityTargetGain,
  stepPriorityGain,
  voiceGainFor,
} from "../../src/lib/priority-speaker";

let f = 0, p = 0;
const eq = (n: string, got: unknown, want: unknown) => { JSON.stringify(got) === JSON.stringify(want) ? p++ : (f++, console.log("FAIL", n, { got, want })); };

const prio = { identity: "a", attributes: { priority: "1" } };
const plain = { identity: "b", attributes: {} };
const claimed = { identity: "c", attributes: { priority: "yes" } };

eq("only the signed value counts", [isPriorityAttributes({ priority: "1" }), isPriorityAttributes({ priority: "yes" }), isPriorityAttributes({}), isPriorityAttributes(undefined)], [true, false, false, false]);

// Who triggers the duck.
eq("a priority speaker ducks the others", priorityIsSpeaking([prio, plain], "me"), true);
eq("only ordinary speakers: no duck", priorityIsSpeaking([plain, claimed], "me"), false);
eq("my own priority doesn't duck me", priorityIsSpeaking([{ identity: "me", attributes: { priority: "1" } }], "me"), false);
eq("nobody speaking: no duck", priorityIsSpeaking([], "me"), false);

// Who is ducked.
eq("ordinary voices follow the shared level", voiceGainFor(plain, 0.3), 0.3);
eq("priority voices are exempt", voiceGainFor(prio, 0.3), 1);
eq("duck target", [priorityTargetGain(true), priorityTargetGain(false)], [PRIORITY_DUCK_GAIN, 1]);

// The fade: quick down, slower up, snaps at the end.
const down = stepPriorityGain(1, PRIORITY_DUCK_GAIN, 50);
eq("moves towards a lower target", down < 1 && down > PRIORITY_DUCK_GAIN, true);
const downLong = stepPriorityGain(1, PRIORITY_DUCK_GAIN, 2000);
eq("arrives at the lower target", downLong, PRIORITY_DUCK_GAIN);
const up = stepPriorityGain(PRIORITY_DUCK_GAIN, 1, 50);
eq("rises more slowly than it falls", (1 - down) / (1 - PRIORITY_DUCK_GAIN) > (up - PRIORITY_DUCK_GAIN) / (1 - PRIORITY_DUCK_GAIN), true);
eq("at target stays put", stepPriorityGain(1, 1, 16), 1);
eq("time never runs backwards", stepPriorityGain(1, 0.3, -100), 1);

// The hold.
const t = new PriorityTracker();
eq("quiet at first", t.update(0, false), false);
eq("ducks while a priority speaker talks", t.update(1000, true), true);
eq("holds through a short pause", t.update(1000 + PRIORITY_TIMING.hold - 1, false), true);
eq("lets go after the hold", t.update(1000 + PRIORITY_TIMING.hold + 1, false), false);

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);

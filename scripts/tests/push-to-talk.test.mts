// Run: npx tsx scripts/tests/push-to-talk.test.mts
import {
  DEFAULT_PUSH_TO_TALK_KEY,
  effectiveInputMode,
  isBindableKey,
  isInputMode,
  isTypingTarget,
  keyLabel,
  matchesPushToTalk,
  shouldTransmit,
} from "../../src/lib/push-to-talk";

let f = 0, p = 0;
const eq = (n: string, got: unknown, want: unknown) => { JSON.stringify(got) === JSON.stringify(want) ? p++ : (f++, console.log("FAIL", n, { got, want })); };

// The mode a call runs in.
eq("VAD chosen and allowed: VAD", effectiveInputMode("vad", true), "vad");
eq("PTT chosen and allowed: PTT", effectiveInputMode("ptt", true), "ptt");
eq("VAD chosen but not allowed: forced to PTT", effectiveInputMode("vad", false), "ptt");
eq("PTT chosen, VAD not allowed: still PTT", effectiveInputMode("ptt", false), "ptt");

// When the mic sends.
eq("VAD, unmuted: sends", shouldTransmit({ muted: false, mode: "vad", keyHeld: false }), true);
eq("VAD, muted: silent", shouldTransmit({ muted: true, mode: "vad", keyHeld: false }), false);
eq("PTT, key up: silent", shouldTransmit({ muted: false, mode: "ptt", keyHeld: false }), false);
eq("PTT, key held: sends", shouldTransmit({ muted: false, mode: "ptt", keyHeld: true }), true);
eq("PTT, key held but muted: mute wins", shouldTransmit({ muted: true, mode: "ptt", keyHeld: true }), false);

// Keys.
const ev = (code: string, key: string, target?: { tagName?: string; isContentEditable?: boolean }) => ({ code, key, target });
eq("the bound key matches", matchesPushToTalk(ev("Backquote", "`"), "Backquote"), true);
eq("another key does not", matchesPushToTalk(ev("KeyA", "a"), "Backquote"), false);
eq("no binding matches nothing", matchesPushToTalk(ev("Backquote", "`"), ""), false);
eq("a typing key in a text field is left to the field", matchesPushToTalk(ev("Backquote", "`", { tagName: "INPUT" }), "Backquote"), false);
eq("a typing key in an editor is left to it", matchesPushToTalk(ev("KeyV", "v", { isContentEditable: true }), "KeyV"), false);
eq("a non-typing key still works in a field", matchesPushToTalk(ev("ControlLeft", "Control", { tagName: "TEXTAREA" }), "ControlLeft"), true);
eq("the same key outside a field works", matchesPushToTalk(ev("KeyV", "v", { tagName: "DIV" }), "KeyV"), true);
eq("inputs are typing targets", isTypingTarget({ tagName: "input" }), true);
eq("buttons are not", isTypingTarget({ tagName: "BUTTON" }), false);
eq("no target is not", isTypingTarget(null), false);

// Labels and bindings.
eq("backquote label", keyLabel("Backquote"), "`");
eq("letter label", keyLabel("KeyV"), "V");
eq("digit label", keyLabel("Digit5"), "5");
eq("modifier label", keyLabel("ControlLeft"), "Left Control");
eq("F-key label", keyLabel("F13"), "F13");
eq("unset label", keyLabel(""), "Not set");
eq("escape cannot be bound", isBindableKey("Escape"), false);
eq("an ordinary key can", isBindableKey("KeyV"), true);
eq("default key is bindable", isBindableKey(DEFAULT_PUSH_TO_TALK_KEY), true);
eq("input mode guard", [isInputMode("vad"), isInputMode("ptt"), isInputMode("open")], [true, true, false]);

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);

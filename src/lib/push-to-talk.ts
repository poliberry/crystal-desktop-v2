/**
 * How the microphone is opened in a call: by voice activity (the mic is live whenever it isn't muted) or by
 * push-to-talk (live only while a key is held).
 *
 * A community can take voice activity away from a member (the Use Voice Activity permission); the server
 * signs that into their LiveKit token as the `ptt` participant attribute and `channels.get` mirrors it as
 * `canUseVad`. A member without it is held to push-to-talk whatever they chose here — the choice is theirs
 * for every call where the community allows it, and is left as it was for the rest. Pure — no DOM, no
 * LiveKit — so the rules are tested alone (scripts/tests/push-to-talk.test.mts).
 */

export type InputMode = "vad" | "ptt";

export const DEFAULT_PUSH_TO_TALK_KEY = "Backquote";

export const isInputMode = (value: unknown): value is InputMode => value === "vad" || value === "ptt";

/** The mode a call actually runs in: push-to-talk when it's chosen, or when the community requires it. */
export function effectiveInputMode(preferred: InputMode, vadAllowed: boolean): InputMode {
  return vadAllowed ? preferred : "ptt";
}

/** Whether the microphone should be sending right now. Muted always wins; push-to-talk also needs the key held. */
export function shouldTransmit(input: { muted: boolean; mode: InputMode; keyHeld: boolean }): boolean {
  if (input.muted) return false;
  return input.mode === "vad" || input.keyHeld;
}

/** The part of a keyboard event this needs, so tests can pass a plain object. */
export interface KeyLike {
  code: string;
  key: string;
  repeat?: boolean;
  target?: unknown;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Whether the key event is aimed at something people type into. */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const { isContentEditable, tagName } = target as { tagName?: string; isContentEditable?: boolean };
  return !!isContentEditable || EDITABLE_TAGS.has((tagName ?? "").toUpperCase());
}

/**
 * Whether a key event is the push-to-talk key. While typing in a field, a key that types a character
 * (a letter, a backtick) belongs to the field and isn't taken; a key that doesn't type anything (Control,
 * Alt, F-keys, Caps Lock) still works, so a person can talk while writing a message.
 */
export function matchesPushToTalk(event: KeyLike, code: string): boolean {
  if (!code || event.code !== code) return false;
  if (isTypingTarget(event.target) && event.key.length === 1) return false;
  return true;
}

/** A readable name for a key code: "Backquote" → "`", "KeyV" → "V", "ControlLeft" → "Left Control". */
export function keyLabel(code: string): string {
  if (!code) return "Not set";
  const named: Record<string, string> = {
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Space: "Space",
    CapsLock: "Caps Lock",
    ControlLeft: "Left Control",
    ControlRight: "Right Control",
    ShiftLeft: "Left Shift",
    ShiftRight: "Right Shift",
    AltLeft: "Left Alt",
    AltRight: "Right Alt",
    MetaLeft: "Left Meta",
    MetaRight: "Right Meta",
  };
  if (named[code]) return named[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Numpad ${code.slice(6)}`;
  return code.replace(/([a-z])([A-Z0-9])/g, "$1 $2");
}

/** A code that can be bound: anything but Escape, which cancels the binding dialog. */
export const isBindableKey = (code: string): boolean => !!code && code !== "Escape" && code !== "Unidentified";

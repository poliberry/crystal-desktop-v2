"use client";

import { useSyncExternalStore } from "react";

/**
 * Text-to-speech messages (Send TTS). The server only flags a message as TTS; every reader speaks
 * it themselves, with the browser's own voices, if they have not turned it off.
 *
 * Only messages that arrive while the channel is open and the window is in front are ever spoken —
 * never history, and never a message that landed while the reader was elsewhere.
 */

const KEY = "crystal.chat.speakTts";
const listeners = new Set<() => void>();

/** Whether this device speaks TTS messages. On unless turned off. */
export function readSpeakTts(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeSpeakTts(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Storage unavailable: the default (on) stands for this session.
  }
  if (!on) stopSpeaking();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSpeakTts(): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(subscribe, readSpeakTts, () => true);
  return [value, writeSpeakTts];
}

/** Whether this browser can speak at all. */
export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

/** Longest a spoken message runs: a TTS message is a line, not an audiobook. */
export const MAX_SPOKEN_CHARS = 280;
/** More than this waiting to be spoken and the oldest are dropped, so a burst can't keep talking for minutes. */
const MAX_QUEUED = 3;

/**
 * Message text as it should be read out: mentions become "mention", custom emoji their name, links
 * "link", and markdown noise is dropped.
 */
export function speechText(text: string): string {
  return text
    .replace(/<@&[a-z0-9]+>/gi, "role mention")
    .replace(/<@!?[a-z0-9]+>/gi, "mention")
    .replace(/<a?:([a-zA-Z0-9_]+):[a-zA-Z0-9]+>/g, (_all, name: string) => name.replace(/_/g, " "))
    .replace(/\bhttps?:\/\/\S+/gi, "link")
    .replace(/```[\s\S]*?```/g, "code block")
    .replace(/[*_~`>|#]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SPOKEN_CHARS);
}

/**
 * Whether a message should be spoken now. `liveAfter` is the newest message the reader already had
 * when the channel opened (server time on both sides, so no clock skew): anything not newer is history.
 */
export function shouldSpeak(args: {
  tts: boolean;
  createdAt: number;
  liveAfter: number | null;
  alreadySpoken: boolean;
  enabled: boolean;
  windowActive: boolean;
}): boolean {
  if (!args.tts || args.alreadySpoken || !args.enabled || !args.windowActive) return false;
  // Until the first page has loaded nothing is known to be live.
  if (args.liveAfter === null) return false;
  return args.createdAt > args.liveAfter;
}

const spoken = new Set<string>();

/** Whether `id` has been spoken (or deliberately skipped) already; marks it so a re-render doesn't repeat it. */
export function claimSpeech(id: string): boolean {
  if (spoken.has(id)) return true;
  spoken.add(id);
  // A long session shouldn't grow this forever.
  if (spoken.size > 500) spoken.delete(spoken.values().next().value as string);
  return false;
}

let queued = 0;

export function speak(text: string): void {
  if (!canSpeak()) return;
  const words = speechText(text);
  if (!words) return;
  const synth = window.speechSynthesis;
  if (queued >= MAX_QUEUED) {
    synth.cancel();
    queued = 0;
  }
  const utterance = new SpeechSynthesisUtterance(words);
  const done = () => {
    queued = Math.max(0, queued - 1);
  };
  utterance.onend = done;
  utterance.onerror = done;
  queued++;
  synth.speak(utterance);
}

export function stopSpeaking(): void {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  queued = 0;
}

/** Whether the app is in front of the reader right now. */
export function windowIsActive(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();
}

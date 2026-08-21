import type { SystemAudioChoice } from "@/hooks/use-room";

/**
 * Remembers the user's preferred "share audio" choice (off / system / a
 * specific app) across screen shares and app restarts, so the picker doesn't
 * reset to "off" every time. A local machine preference, not account data —
 * stored client-side only.
 */
const STORAGE_KEY = "crystal:default-audio-choice";

export function getDefaultAudioChoice(): SystemAudioChoice {
  if (typeof window === "undefined") return { mode: "off" };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { mode: "off" };
    const parsed = JSON.parse(raw) as Partial<SystemAudioChoice>;
    if (parsed.mode === "system") return { mode: "system" };
    if (parsed.mode === "app" && typeof parsed.appId === "string") {
      return { mode: "app", appId: parsed.appId };
    }
  } catch {
    /* ignore malformed storage */
  }
  return { mode: "off" };
}

export function setDefaultAudioChoice(choice: SystemAudioChoice): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    /* ignore quota/availability errors */
  }
}

/**
 * App-wide audio, device and stream-quality preferences.
 *
 * These are machine preferences, not account data — they live in
 * localStorage, and because the Settings window is a separate Electron
 * `BrowserWindow` sharing the same origin, both windows read and write the
 * same key and pick each other's changes up through the `storage` event (see
 * `AudioPreferencesProvider`).
 */

/** What audio to share alongside a screen share. */
export type SystemAudioChoice =
  | { mode: "off" }
  | { mode: "system" }
  | { mode: "app"; appId: string };

/** Screen-share capture resolutions, highest first. */
export const STREAM_RESOLUTIONS = [
  { key: "1080p", label: "1080p", width: 1920, height: 1080 },
  { key: "720p", label: "720p", width: 1280, height: 720 },
  { key: "480p", label: "480p", width: 854, height: 480 },
] as const;

export type StreamResolutionKey = (typeof STREAM_RESOLUTIONS)[number]["key"];

/** Screen-share capture frame rates, highest first. */
export const STREAM_FRAME_RATES = [60, 30, 15] as const;

export type StreamFrameRate = (typeof STREAM_FRAME_RATES)[number];

export interface StreamQuality {
  resolution: StreamResolutionKey;
  frameRate: StreamFrameRate;
}

export interface AudioPreferences {
  /** `""` means "whatever the OS default is" — the same convention
   * `setSinkId("")` uses, so it survives the default device changing. */
  inputDeviceId: string;
  outputDeviceId: string;
  /** Global mic mute. Applies outside a call too, and is the state the mic
   * is published in when joining one. */
  muted: boolean;
  /** Global deafen: silences every incoming stream except screen-share
   * audio. Implies (but is stored separately from) `muted`, so undeafening
   * can restore whatever the mute state was before. */
  deafened: boolean;
  /** Mic mute state to restore when undeafening. */
  mutedBeforeDeafen: boolean;
  /** Run the Krisp noise filter over the microphone before publishing it.
   * A machine preference rather than a per-call one — it costs CPU, so a
   * weak machine should be able to turn it off once and be done. */
  noiseSuppression: boolean;
  quality: StreamQuality;
  /** Default "share audio" choice for the next screen share. */
  shareAudio: SystemAudioChoice;
  /** 0–1 multiplier applied to soundboard playback. */
  soundboardVolume: number;
  /** 0–1 multiplier applied to the app's own effects (join, mute, ringing).
   * Zero silences them entirely. */
  uiSoundVolume: number;
  richPresenceEnabled: boolean;
}

export const DEFAULT_AUDIO_PREFERENCES: AudioPreferences = {
  inputDeviceId: "",
  outputDeviceId: "",
  muted: false,
  deafened: false,
  mutedBeforeDeafen: false,
  noiseSuppression: true,
  quality: { resolution: "1080p", frameRate: 30 },
  shareAudio: { mode: "off" },
  soundboardVolume: 0.7,
  uiSoundVolume: 0.5,
  richPresenceEnabled: true,
};

export const AUDIO_PREFERENCES_STORAGE_KEY = "crystal:audio-preferences";

/** Pre-existing key holding just the share-audio choice, folded into the
 * unified preferences on first read so nobody loses their setting. */
const LEGACY_SHARE_AUDIO_KEY = "crystal:default-audio-choice";

function parseShareAudio(value: unknown): SystemAudioChoice | null {
  if (!value || typeof value !== "object") return null;
  const choice = value as Partial<SystemAudioChoice>;
  if (choice.mode === "system") return { mode: "system" };
  if (choice.mode === "off") return { mode: "off" };
  if (choice.mode === "app" && typeof (choice as { appId?: unknown }).appId === "string") {
    return { mode: "app", appId: (choice as { appId: string }).appId };
  }
  return null;
}

function parseQuality(value: unknown): StreamQuality | null {
  if (!value || typeof value !== "object") return null;
  const q = value as Partial<StreamQuality>;
  const resolution = STREAM_RESOLUTIONS.some((r) => r.key === q.resolution)
    ? (q.resolution as StreamResolutionKey)
    : null;
  const frameRate = STREAM_FRAME_RATES.includes(q.frameRate as StreamFrameRate)
    ? (q.frameRate as StreamFrameRate)
    : null;
  if (!resolution || !frameRate) return null;
  return { resolution, frameRate };
}

function clampVolume(value: unknown, fallback: number): number {
  return typeof value === "number" && value >= 0 && value <= 1 ? value : fallback;
}

/** Read the stored preferences, filling in defaults for anything missing or
 * malformed. Safe to call during SSR (returns the defaults). */
export function readAudioPreferences(): AudioPreferences {
  if (typeof window === "undefined") return DEFAULT_AUDIO_PREFERENCES;

  let stored: Partial<AudioPreferences> = {};
  try {
    const raw = window.localStorage.getItem(AUDIO_PREFERENCES_STORAGE_KEY);
    if (raw) stored = JSON.parse(raw) as Partial<AudioPreferences>;
  } catch {
    /* malformed storage — fall through to defaults */
  }

  let shareAudio = parseShareAudio(stored.shareAudio);
  if (!shareAudio) {
    try {
      const legacy = window.localStorage.getItem(LEGACY_SHARE_AUDIO_KEY);
      if (legacy) shareAudio = parseShareAudio(JSON.parse(legacy));
    } catch {
      /* ignore */
    }
  }

  return {
    inputDeviceId: typeof stored.inputDeviceId === "string" ? stored.inputDeviceId : "",
    outputDeviceId: typeof stored.outputDeviceId === "string" ? stored.outputDeviceId : "",
    muted: stored.muted === true,
    deafened: stored.deafened === true,
    mutedBeforeDeafen: stored.mutedBeforeDeafen === true,
    noiseSuppression: stored.noiseSuppression !== false,
    quality: parseQuality(stored.quality) ?? DEFAULT_AUDIO_PREFERENCES.quality,
    shareAudio: shareAudio ?? DEFAULT_AUDIO_PREFERENCES.shareAudio,
    soundboardVolume: clampVolume(stored.soundboardVolume, DEFAULT_AUDIO_PREFERENCES.soundboardVolume),
    uiSoundVolume: clampVolume(stored.uiSoundVolume, DEFAULT_AUDIO_PREFERENCES.uiSoundVolume),
    richPresenceEnabled: stored.richPresenceEnabled !== false,
  };
}

export function writeAudioPreferences(prefs: AudioPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUDIO_PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota/availability errors */
  }
}

/** Capture constraints for a screen share at the given quality. */
export function resolveStreamResolution(quality: StreamQuality): {
  width: number;
  height: number;
  frameRate: number;
} {
  const preset =
    STREAM_RESOLUTIONS.find((r) => r.key === quality.resolution) ?? STREAM_RESOLUTIONS[0];
  return { width: preset.width, height: preset.height, frameRate: quality.frameRate };
}

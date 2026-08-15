/**
 * Types shared between the Electron main/preload layer and the Next.js
 * renderer. Kept in a single place so the renderer can type the global
 * `window.desktopAPI` object exposed via the context bridge.
 */

export interface SystemAudioState {
  /** Whether PulseAudio + pactl are usable on this machine. */
  available: boolean;
  /** Whether the virtual capture sink is currently active. */
  enabled: boolean;
  /**
   * PulseAudio source name of the virtual monitor (e.g.
   * "crystal_system_audio.monitor"), for diagnostics only. Chromium refuses
   * to open monitor sources via plain `getUserMedia({ deviceId })` — the
   * renderer actually captures this sink's audio through
   * `getDisplayMedia()` instead (see `acquireDisplayMediaAudioTrack` in
   * `src/lib/system-audio.ts`), after this module makes the monitor's sink
   * the default output.
   */
  captureDeviceId: string | null;
  /**
   * Name of the real output sink the app should route its OWN audio to via
   * `setSinkId`, so its audio is NOT captured by the monitor.
   */
  playbackSink: string | null;
  /** PulseAudio module indexes loaded while capture is active. */
  moduleIndexes: number[];
  /** Whether the PCM recorder (parec/pw-record) is currently streaming. */
  captureRunning: boolean;
  /** Capture mode: "system" shares every app, "app" only the selected ones. */
  mode: "system" | "app";
  /** Selected app ids when mode is "app". */
  selectedApps: string[];
}

export interface AppInfo {
  platform: "linux" | "darwin" | "win32" | string;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
}

export type UpdaterPhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "not-available"
  | "unsupported"
  | "error";

export interface UpdaterState {
  phase: UpdaterPhase;
  currentVersion: string;
  availableVersion: string | null;
  progressPercent: number | null;
  error: string | null;
}

/**
 * Result of starting the macOS ScreenCaptureKit helper. `started === true`
 * means raw interleaved Float32 PCM at `sampleRate` Hz is being streamed.
 */
export interface SystemAudioMacStart {
  started: boolean;
  sampleRate?: number;
  channels?: number;
  error?: string;
}

export interface SystemAudioMacInfo {
  running: boolean;
  helper: string | null;
}

/**
 * Result of starting Linux system-audio capture. `started === true` means
 * interleaved Float32 PCM at `sampleRate` Hz is being streamed from the
 * virtual sink's monitor (via `parec`/`pw-record`).
 */
export interface SystemAudioLinuxStart {
  started: boolean;
  sampleRate?: number;
  channels?: number;
  /** Real output sink the app should route its own audio to. */
  playbackSink?: string | null;
  error?: string;
}

export interface SystemAudioLinuxInfo {
  running: boolean;
  recorder: string | null;
  playbackSink: string | null;
}

/** A running application whose audio can be shared on Linux. */
export interface AudioApp {
  /** Stable key used for selection (the app's process binary, falling back to its name). */
  id: string;
  /** Human-readable name (e.g. "Firefox", "Spotify"). */
  name: string;
  binary: string | null;
  /** Number of active audio streams the app currently has. */
  streams: number;
}

/** A shareable screen or window, as reported by Electron's desktopCapturer. */
export interface ScreenSource {
  id: string;
  name: string;
  type: "screen" | "window";
  displayId: string;
  thumbnail: string | null;
}

export interface DesktopAPI {
  isElectron: boolean;
  platform: string;
  appInfo(): Promise<AppInfo>;
  settings: {
    open(): Promise<void>;
  };
  updater: {
    getState(): Promise<UpdaterState>;
    check(): Promise<UpdaterState>;
    download(): Promise<UpdaterState>;
    install(): Promise<void>;
    openReleases(): Promise<void>;
    onStateChange(cb: (state: UpdaterState) => void): () => void;
  };
  systemAudio: {
    enable(): Promise<SystemAudioState>;
    disable(): Promise<void>;
    info(): Promise<SystemAudioState>;
  };
  systemAudioMac?: {
    enable(): Promise<SystemAudioMacStart>;
    disable(): Promise<{ stopped: boolean }>;
    info(): Promise<SystemAudioMacInfo>;
    onAudio(cb: (data: ArrayBuffer) => void): () => void;
  };
  systemAudioLinux?: {
    enable(): Promise<SystemAudioLinuxStart>;
    disable(): Promise<{ stopped: boolean }>;
    info(): Promise<SystemAudioLinuxInfo>;
    listAudioApps(): Promise<AudioApp[]>;
    setMode(mode: "system" | "app", appIds?: string[]): Promise<void>;
    onAudio(cb: (data: ArrayBuffer) => void): () => void;
  };
  screenShare?: {
    getSources(): Promise<ScreenSource[]>;
    setSource(id: string): Promise<boolean>;
  };
}

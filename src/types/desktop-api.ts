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
  /** Release channel this build came from — see electron/channels.ts. */
  channel: ReleaseChannel;
  /** The channel's display name ("Canary"). */
  channelLabel: string;
  /** Installed application name, which differs per channel so channels can be
   * installed side by side ("Crystal", "Crystal Canary"). */
  productName: string;
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
}

/** Mirrors `ReleaseChannel` in electron/channels.ts. */
export type ReleaseChannel = "stable" | "ptb" | "canary" | "development";

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
  channel: ReleaseChannel;
  channelLabel: string;
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

/**
 * A Rich Presence activity resolved by the main process — a detected game, an
 * activity pushed over the Discord-compatible IPC socket, or now-playing
 * music. See electron/richPresence.ts.
 */
export type RichPresenceActivityType = "playing" | "listening" | "watching" | "streaming";

export interface RichPresenceActivity {
  type: RichPresenceActivityType;
  /** Game name, or the app playing the music ("Spotify", "Microsoft Edge"). */
  name: string;
  /** Track title, for music. */
  details?: string;
  /** Artist, for music. */
  state?: string;
  album?: string;
  imageUrl?: string;
  startedAt?: number;
  durationMs?: number;
  positionMs?: number;
  /** Set by the main process: local clock reading when `positionMs` was
   * sampled, so the reporter can advance it to send time. */
  positionSampledAt?: number;
  /** Set by Convex when the activity is stored: server clock reading that
   * `positionMs` is accurate as of. This is what viewers interpolate
   * against — see `useInterpolatedPosition`. */
  positionUpdatedAt?: number;
  /** Up to two link buttons under the card. Only custom activities set these
   * — nothing we detect has anywhere to point. */
  buttons?: { label: string; url: string }[];
  source?: "detectable" | "ipc" | "music" | "custom";
}

/** Diagnostics for the Settings → Voice & Video panel. */
export interface RichPresenceStatus {
  enabled: boolean;
  /** How many entries of Discord's detectables catalog are loaded. */
  detectableCount: number;
  /** The `discord-ipc-N` socket we bound, or null if every slot was taken. */
  ipcPath: string | null;
  /** Number of games/apps currently connected to that socket. */
  ipcClients: number;
  activities: RichPresenceActivity[];
}

/** What's currently focused in the renderer — reported to the main process
 * so a background notification isn't fired for the thing you're already
 * looking at (see electron/backgroundNotifier.ts). */
export type ActiveNotificationView = { kind: "conversation" | "channel"; id: string } | null;

/** Where to jump to after clicking a background notification. */
export type NavigateTarget =
  | { kind: "conversation"; conversationId: string }
  | { kind: "channel"; communityId: string; channelId: string };

export interface DesktopAPI {
  isElectron: boolean;
  platform: string;
  appInfo(): Promise<AppInfo>;
  settings: {
    open(): Promise<void>;
  };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximizedChange(cb: (maximized: boolean) => void): () => void;
    /** Scale this window's contents (Settings → Accessibility → Zoom).
     * Optional so a renderer running against an older preload — a packaged
     * build whose window was opened before an update — falls back to CSS
     * `zoom` instead of throwing. */
    setZoomFactor?(factor: number): Promise<number>;
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
  richPresence?: {
    /** Everything currently detected, richest first. */
    get(): Promise<RichPresenceActivity[]>;
    status(): Promise<RichPresenceStatus>;
    setEnabled(enabled: boolean): Promise<RichPresenceStatus>;
    onChange(cb: (activities: RichPresenceActivity[]) => void): () => void;
  };
  notifications: {
    configure(url: string, token: string | null, userId: string | null): Promise<void>;
    setActiveView(view: ActiveNotificationView): Promise<void>;
    onNavigate(cb: (target: NavigateTarget) => void): () => void;
  };
  auth?: {
    onCallback(cb: (url: string) => void): () => void;
  };
  /**
   * "Pop out" a video tile into a real, separate always-on-top
   * `BrowserWindow` — not Document Picture-in-Picture, which Electron's
   * bare `BrowserWindow` (no full browser UI) doesn't implement. Rather
   * than a second LiveKit connection (which would show up as a duplicate,
   * silent participant to everyone else in the call), the main window
   * captures the focused tile's `<video>` element to a canvas and streams
   * JPEG frames over IPC; the pip window (`src/app/pip/page.tsx`) just
   * draws whatever frames it receives. Video-only — the call's audio stays
   * with the main window's existing LiveKit connection.
   */
  pip: {
    open(options?: { width?: number; height?: number; title?: string }): Promise<boolean>;
    close(): Promise<void>;
    /** Main window → main process: forward a captured frame (JPEG data URL). */
    sendFrame(dataUrl: string): void;
    /** Pip window: receive frames forwarded from the main window. */
    onFrame(cb: (dataUrl: string) => void): () => void;
    /** Main window: fires when the pip window closes (its own close button, or programmatically). */
    onClosed(cb: () => void): () => void;
    /** Main window: the pip window's actual current content size, so frames
     * can be captured at a matching resolution instead of a fixed guess. */
    onSize(cb: (size: { width: number; height: number }) => void): () => void;
  };
}

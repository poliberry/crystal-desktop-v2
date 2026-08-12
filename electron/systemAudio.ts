import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Linux "share system audio" layer backed by PulseAudio (or the PipeWire
 * pulse-compat layer, which ships `pactl` too).
 *
 * How it works
 * ------------
 * 1. Load a `module-null-sink` virtual sink named `crystal_system_audio`.
 * 2. Capture the sink's monitor directly with `parec` (or `pw-record`) and
 *    stream the raw PCM to the renderer, which feeds it into an AudioWorklet →
 *    MediaStreamAudioDestinationNode and publishes it as a LiveKit
 *    `ScreenShareAudio` track (see `acquirePcmLoopbackTrack` in
 *    src/lib/system-audio.ts).
 * 3. Load `module-loopback` from `crystal_system_audio.monitor` back to the
 *    real hardware output so the user still hears what is being shared.
 *
 * Two sharing modes:
 *  - "system": the virtual sink becomes the *default* sink so every other
 *    application plays into it; everything non-self is routed into the sink.
 *  - "app": the user picks specific applications; only their streams are
 *    routed into the sink and the system default is left untouched, so only
 *    the selected apps' audio is shared.
 *
 * Capturing the *virtual sink's* monitor explicitly (rather than asking
 * Chromium to capture the "default sink" via the experimental
 * `PulseaudioLoopbackForScreenShare` feature) is what makes this reliable:
 *   - Capture never depends on the system default sink and never grabs the
 *     hardware monitor (which would include the app's own output → echo).
 *   - It drops the buggy Chromium loopback path entirely, which produced
 *     choppy/crackly audio and started silent.
 *
 * The app's OWN audio is kept out of the capture by routing every playback
 * element to the real hardware sink with `HTMLMediaElement.setSinkId()` (see
 * src/lib/system-audio.ts) AND by a periodic "routing guardian" below that
 * re-moves any of the app's Pulse streams to the hardware sink. Because the
 * app never writes into the virtual sink, it can never re-capture itself and
 * no microphone/feedback loop can enter the shared stream.
 */

const SINK_NAME = "crystal_system_audio";
const LOOPBACK_LATENCY_MS = "20";
const CAPTURE_SAMPLE_RATE = 48000;
const CAPTURE_CHANNELS = 2;
const CAPTURE_LATENCY_MS = "50";
const INPUT_GUARD_INTERVAL_MS = 400;
const CAPTURE_RESTART_DELAY_MS = 600;
const CAPTURE_MAX_RESTARTS = 8;

/** application.process.binary values that must never be moved into the capture sink. */
const SELF_BINARIES = new Set(["electron", "Electron", "Crystal", "crystal", "pulseaudio", "pipewire"]);

export type SystemAudioMode = "system" | "app";

export interface SystemAudioState {
  available: boolean;
  enabled: boolean;
  captureDeviceId: string | null;
  playbackSink: string | null;
  moduleIndexes: number[];
  /** Whether the PCM recorder (`parec`/`pw-record`) is currently streaming. */
  captureRunning: boolean;
  mode: SystemAudioMode;
  selectedApps: string[];
}

/** A running application whose audio can be shared. */
export interface AudioApp {
  /** Stable key used for selection (the app's process binary, falling back to its name). */
  id: string;
  /** Human-readable name (e.g. "Firefox", "Spotify"). */
  name: string;
  binary: string | null;
  /** Number of active audio streams the app currently has. */
  streams: number;
}

/** Receives interleaved Float32 PCM (48000 Hz stereo) captured from the virtual sink. */
export type SystemAudioPcmListener = (data: ArrayBuffer) => void;

class LinuxSystemAudio {
  private enabled = false;
  private moduleIndexes: number[] = [];
  private playbackSink: string | null = null;
  private originalDefaultSink: string | null = null;
  private available = false;
  private availabilityChecked = false;
  private hardwareSink: string | null = null;

  private mode: SystemAudioMode = "system";
  private selectedApps = new Set<string>();

  private inputGuard: ReturnType<typeof setInterval> | null = null;

  private captureChild: ChildProcess | null = null;
  private captureListeners = new Set<SystemAudioPcmListener>();
  private pcmAcc = Buffer.alloc(0);
  private recorderResolved = false;
  private recorder: "parec" | "pw-record" | null = null;
  private captureRestarts = 0;
  private captureRestartTimer: ReturnType<typeof setTimeout> | null = null;

  private pactl(args: string[]): Promise<string> {
    return execFileAsync("pactl", args, {
      timeout: 10_000,
      maxBuffer: 4 * 1024 * 1024,
    }).then((r) => r.stdout.trim());
  }

  /** Pre-flight that primes cached state so the first enable() is fast. */
  async warmUp(): Promise<void> {
    await Promise.all([this.checkAvailability(), this.resolveRecorder()]).catch(() => {});
  }

  async checkAvailability(): Promise<boolean> {
    if (this.availabilityChecked) return this.available;
    try {
      await this.pactl(["--version"]);
      await this.pactl(["info"]); // throws when no pulse server is running
      this.available = true;
    } catch {
      this.available = false;
    }
    this.availabilityChecked = true;
    return this.available;
  }

  /** Which CLI tool can record a monitor source on this machine. */
  async resolveRecorder(): Promise<"parec" | "pw-record" | null> {
    if (this.recorderResolved) return this.recorder;
    this.recorderResolved = true;
    for (const bin of ["parec", "pw-record"] as const) {
      try {
        await execFileAsync(bin, ["--version"], { timeout: 5_000 });
        this.recorder = bin;
        break;
      } catch {
        /* try next */
      }
    }
    return this.recorder;
  }

  getRecorder(): string | null {
    return this.recorder;
  }

  async getInfo(): Promise<SystemAudioState> {
    const available = await this.checkAvailability();
    return {
      available,
      enabled: this.enabled,
      captureDeviceId: this.enabled ? `${SINK_NAME}.monitor` : null,
      playbackSink: this.playbackSink,
      moduleIndexes: [...this.moduleIndexes],
      captureRunning: !!this.captureChild,
      mode: this.mode,
      selectedApps: [...this.selectedApps],
    };
  }

  onAudioData(cb: SystemAudioPcmListener): () => void {
    this.captureListeners.add(cb);
    return () => this.captureListeners.delete(cb);
  }

  getPlaybackSink(): string | null {
    return this.playbackSink;
  }

  /** Unload any leftover modules from a previous (possibly crashed) session. */
  private async cleanupStale(): Promise<void> {
    const modules = await this.pactl(["list", "short", "modules"]).catch(() => "");
    const stale = modules
      .split("\n")
      .filter((line) => line.includes(SINK_NAME))
      .map((line) => parseInt(line.split("\t")[0] ?? "", 10))
      .filter((n) => Number.isInteger(n));

    for (const index of stale) {
      await this.pactl(["unload-module", String(index)]).catch(() => {});
    }
    this.moduleIndexes = [];
  }

  /**
   * Periodic routing guardian (runs while capture is enabled):
   *  - the app's OWN streams (Electron/Crystal) are kept on the real hardware
   *    sink so its audio can never enter the captured monitor,
   *  - "system" mode: every OTHER application's stream is kept on the virtual
   *    capture sink so its audio is always shared,
   *  - "app" mode: only the selected applications' streams are kept on the
   *    capture sink; everything else is left on whatever sink it chose.
   * Streams created by daemon modules (loopbacks) have no client and are left
   * untouched so monitoring never loops back into the capture.
   */
  private async routeSinkInputs(): Promise<void> {
    if (!this.hardwareSink) return;
    const inputs = await this.pactl(["list", "sink-inputs"]).catch(() => "");
    const blocks = inputs.split(/Sink Input #/).slice(1);
    if (blocks.length === 0) return;

    const sinks = await this.pactl(["list", "short", "sinks"]).catch(() => "");
    const nameByIndex = new Map<string, string>();
    for (const line of sinks.split("\n")) {
      const [idx, name] = line.split("\t");
      if (idx && name) nameByIndex.set(idx, name);
    }

    for (const block of blocks) {
      const idMatch = block.match(/^(\d+)/);
      if (!idMatch) continue;

      // Daemon/module streams (e.g. the monitor loopback) have no client.
      const clientMatch = block.match(/Client: (\d+|n\/a)/);
      if (!clientMatch || clientMatch[1] === "n/a") continue;

      const pidMatch = block.match(/application\.process\.id = "?(\d+)"?/);
      const binaryMatch = block.match(/application\.process\.binary = "([^"]*)"/);
      const binary = binaryMatch?.[1] ?? "";
      if (SELF_BINARIES.has(binary)) continue;
      const appName = block.match(/application\.name = "([^"]*)"/)?.[1] ?? "";
      const isSelf =
        pidMatch?.[1] === String(process.pid) || /electron|crystal/i.test(binary);

      const sinkIndex = block.match(/Sink: (\d+)/)?.[1];
      const currentSink = sinkIndex ? nameByIndex.get(sinkIndex) : undefined;

      let target: string | null;
      if (isSelf) {
        target = this.hardwareSink;
      } else if (this.mode === "system") {
        target = SINK_NAME;
      } else if (this.selectedApps.has(binary) || this.selectedApps.has(appName)) {
        target = SINK_NAME;
      } else {
        target = null; // "app" mode, not selected → leave alone
      }

      if (target === null || currentSink === target) continue;
      await this.pactl(["move-sink-input", idMatch[1], target]).catch(() => {});
    }
  }

  /** Move anything currently on the capture sink that is no longer selected back to hardware. */
  private async moveUnselectedInputsToPlayback(): Promise<void> {
    if (!this.hardwareSink) return;
    const inputs = await this.pactl(["list", "sink-inputs"]).catch(() => "");
    const blocks = inputs.split(/Sink Input #/).slice(1);

    const sinks = await this.pactl(["list", "short", "sinks"]).catch(() => "");
    const nameByIndex = new Map<string, string>();
    for (const line of sinks.split("\n")) {
      const [idx, name] = line.split("\t");
      if (idx && name) nameByIndex.set(idx, name);
    }

    for (const block of blocks) {
      const idMatch = block.match(/^(\d+)/);
      if (!idMatch) continue;
      const clientMatch = block.match(/Client: (\d+|n\/a)/);
      if (!clientMatch || clientMatch[1] === "n/a") continue;

      const sinkIndex = block.match(/Sink: (\d+)/)?.[1];
      const currentSink = sinkIndex ? nameByIndex.get(sinkIndex) : undefined;
      if (currentSink !== SINK_NAME) continue;

      const binaryMatch = block.match(/application\.process\.binary = "([^"]*)"/);
      const binary = binaryMatch?.[1] ?? "";
      if (SELF_BINARIES.has(binary)) continue;
      const appName = block.match(/application\.name = "([^"]*)"/)?.[1] ?? "";
      const pidMatch = block.match(/application\.process\.id = "?(\d+)"?/);
      const isSelf =
        pidMatch?.[1] === String(process.pid) || /electron|crystal/i.test(binary);
      if (isSelf) continue;
      if (this.selectedApps.has(binary) || this.selectedApps.has(appName)) continue;

      await this.pactl(["move-sink-input", idMatch[1], this.hardwareSink]).catch(() => {});
    }
  }

  private startInputGuard(): void {
    if (this.inputGuard) return;
    this.inputGuard = setInterval(() => {
      void this.routeSinkInputs();
    }, INPUT_GUARD_INTERVAL_MS);
  }

  private stopInputGuard(): void {
    if (this.inputGuard) {
      clearInterval(this.inputGuard);
      this.inputGuard = null;
    }
  }

  /**
   * Switch the capture mode. Safe to call before or while sharing is active.
   * In "app" mode the virtual sink stops being the system default (so new,
   * unselected apps never end up shared) and any previously-captured-but-
   * unselected stream is moved back to the real output.
   */
  async setMode(mode: SystemAudioMode, appIds: string[] = []): Promise<void> {
    this.mode = mode;
    this.selectedApps = new Set(appIds.filter((id): id is string => typeof id === "string"));
    if (!this.enabled) return;

    try {
      if (mode === "system") {
        const cur = await this.pactl(["get-default-sink"]).catch(() => "");
        if (cur !== SINK_NAME) await this.pactl(["set-default-sink", SINK_NAME]);
      } else {
        const cur = await this.pactl(["get-default-sink"]).catch(() => "");
        if (cur === SINK_NAME && this.originalDefaultSink) {
          await this.pactl(["set-default-sink", this.originalDefaultSink]).catch(() => {});
        }
        await this.moveUnselectedInputsToPlayback();
      }
      await this.routeSinkInputs();
    } catch (err) {
      console.error("[system-audio] setMode failed:", err);
    }
  }

  async enable(): Promise<SystemAudioState> {
    const available = await this.checkAvailability();
    if (!available) {
      throw new Error("PulseAudio is not available (install pulseaudio/pactl).");
    }
    if (this.enabled) return this.getInfo();

    // Independent lookups in parallel: leftover modules + the current default.
    const [, defaultSink] = await Promise.all([
      this.cleanupStale(),
      this.pactl(["get-default-sink"]).catch(() => null),
    ]);
    this.originalDefaultSink = defaultSink;

    const hardwareSink =
      defaultSink ??
      (await this.firstHardwareSink()) ??
      (await this.pactl(["get-default-sink"]).catch(() => null));

    if (!hardwareSink) {
      throw new Error("No PulseAudio output sink available.");
    }

    // 1. Virtual sink that (selected) applications play into.
    const nullIndex = parseInt(
      await this.pactl([
        "load-module",
        "module-null-sink",
        `sink_name=${SINK_NAME}`,
        "sink_properties=device.description=Crystal System Audio",
      ]),
      10
    );
    this.moduleIndexes.push(nullIndex);

    // 2. Start the recorder immediately — it connects to the monitor while we
    //    finish wiring the sink up, so the first shared samples arrive sooner.
    await this.ensureCaptureStreaming();

    // 3. Make the sink the default in "system" mode only; "app" mode leaves
    //    the system default alone. Load the monitoring loopback in parallel.
    const [loopbackIndexStr] = await Promise.all([
      this.pactl([
        "load-module",
        "module-loopback",
        `source=${SINK_NAME}.monitor`,
        `sink=${hardwareSink}`,
        `latency_msec=${LOOPBACK_LATENCY_MS}`,
        "channels=2",
      ]),
      this.mode === "system"
        ? this.pactl(["set-default-sink", SINK_NAME])
        : this.pactl(["get-default-sink"]).then((cur) =>
            cur === SINK_NAME && this.originalDefaultSink
              ? this.pactl(["set-default-sink", this.originalDefaultSink!])
              : Promise.resolve("")
          ),
    ]);
    this.moduleIndexes.push(parseInt(loopbackIndexStr, 10));

    this.playbackSink = hardwareSink;
    this.hardwareSink = hardwareSink;
    this.enabled = true;

    // Keep the routing right from the start, then poll.
    await this.routeSinkInputs();
    this.startInputGuard();

    return this.getInfo();
  }

  private spawnRecorder(recorder: "parec" | "pw-record"): ChildProcess {
    const device = `${SINK_NAME}.monitor`;
    const args =
      recorder === "pw-record"
        ? [
            "--raw",
            "--target",
            device,
            "--rate",
            String(CAPTURE_SAMPLE_RATE),
            "--channels",
            String(CAPTURE_CHANNELS),
            "--format",
            "s16",
            "-",
          ]
        : [
            "--device",
            device,
            "--rate",
            String(CAPTURE_SAMPLE_RATE),
            "--channels",
            String(CAPTURE_CHANNELS),
            "--format",
            "s16le",
            "--raw",
            "--latency-msec",
            CAPTURE_LATENCY_MS,
          ];
    return spawn(recorder, args, { stdio: ["ignore", "pipe", "ignore"] });
  }

  /** Spawn (if needed) the recorder and stream raw PCM from the monitor to listeners. */
  private async ensureCaptureStreaming(): Promise<void> {
    if (this.captureChild) return;
    const recorder = await this.resolveRecorder();
    if (!recorder) {
      throw new Error(
        "No audio recorder found. Install pulseaudio-utils (parec) or pipewire-utils (pw-record)."
      );
    }

    const child = this.spawnRecorder(recorder);
    this.captureChild = child;
    this.pcmAcc = Buffer.alloc(0);

    child.stdout?.on("data", (chunk: Buffer) => {
      this.captureRestarts = 0;
      if (this.captureListeners.size === 0) return;
      this.pcmAcc = Buffer.concat([this.pcmAcc, chunk]);
      const frameBytes = CAPTURE_CHANNELS * 2;
      const n = this.pcmAcc.length - (this.pcmAcc.length % frameBytes);
      if (n > 0) {
        const frame = this.pcmAcc.subarray(0, n);
        this.pcmAcc = this.pcmAcc.subarray(n);
        const buf = LinuxSystemAudio.s16leToFloat32(frame);
        for (const cb of this.captureListeners) {
          try {
            cb(buf);
          } catch {
            /* a listener's error must never kill the capture */
          }
        }
      }
    });

    child.on("error", (err) => {
      console.error("[system-audio] recorder failed:", err.message);
      if (this.captureChild === child) this.captureChild = null;
    });

    child.on("exit", () => {
      if (this.captureChild === child) this.captureChild = null;
      if (this.enabled && this.captureListeners.size > 0 && !this.captureRestartTimer) {
        this.scheduleCaptureRestart();
      }
    });
  }

  /** Public entry used by main.ts to guarantee the recorder is streaming. */
  async startCapture(): Promise<void> {
    if (!this.enabled) await this.enable();
    await this.ensureCaptureStreaming();
  }

  private scheduleCaptureRestart(): void {
    if (this.captureRestarts >= CAPTURE_MAX_RESTARTS) {
      console.error("[system-audio] recorder kept exiting; giving up on restart.");
      this.captureRestarts = 0;
      return;
    }
    this.captureRestarts += 1;
    this.captureRestartTimer = setTimeout(() => {
      this.captureRestartTimer = null;
      if (!this.enabled) return;
      void this.ensureCaptureStreaming().catch((err) => {
        console.error("[system-audio] recorder restart failed:", err.message);
      });
    }, CAPTURE_RESTART_DELAY_MS);
  }

  async stopCapture(): Promise<void> {
    if (this.captureRestartTimer) {
      clearTimeout(this.captureRestartTimer);
      this.captureRestartTimer = null;
    }
    const child = this.captureChild;
    this.captureChild = null;
    if (child) {
      child.stdout?.removeAllListeners("data");
      child.kill("SIGTERM");
      const killer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 1500);
      child.once("exit", () => clearTimeout(killer));
    }
  }

  async disable(): Promise<void> {
    // Mark disabled first so a recorder exit (async) can't schedule a restart
    // that would re-enable capture right after we tear everything down.
    this.enabled = false;
    this.stopInputGuard();
    await this.stopCapture();
    if (this.originalDefaultSink) {
      await this.pactl(["set-default-sink", this.originalDefaultSink]).catch(() => {});
      this.originalDefaultSink = null;
    }

    for (const index of [...this.moduleIndexes].reverse()) {
      await this.pactl(["unload-module", String(index)]).catch(() => {});
    }
    this.moduleIndexes = [];
    this.enabled = false;
    this.playbackSink = null;
    this.hardwareSink = null;
  }

  /** Enumerate currently-audio-playing applications that can be shared. */
  async listAudioApps(): Promise<AudioApp[]> {
    const inputs = await this.pactl(["list", "sink-inputs"]).catch(() => "");
    const blocks = inputs.split(/Sink Input #/).slice(1);
    const byId = new Map<string, AudioApp>();

    for (const block of blocks) {
      const clientMatch = block.match(/Client: (\d+|n\/a)/);
      if (!clientMatch || clientMatch[1] === "n/a") continue;

      const binaryMatch = block.match(/application\.process\.binary = "([^"]*)"/);
      const binary = binaryMatch?.[1] ?? null;
      if (binary && SELF_BINARIES.has(binary)) continue;

      const appName =
        block.match(/application\.name = "([^"]*)"/)?.[1] ?? binary ?? "Unknown";
      const id = binary ?? appName;

      const existing = byId.get(id);
      if (existing) {
        existing.streams += 1;
      } else {
        byId.set(id, { id, name: appName, binary, streams: 1 });
      }
    }

    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  private async firstHardwareSink(): Promise<string | null> {
    const sinks = await this.pactl(["list", "short", "sinks"]).catch(() => "");
    const line = sinks
      .split("\n")
      .find((l) => !l.includes(SINK_NAME) && l.trim().length > 0);
    return line?.split("\t")[1] ?? null;
  }

  private static s16leToFloat32(buf: Buffer): ArrayBuffer {
    const n = buf.length >> 1;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
    return out.buffer;
  }
}

export default new LinuxSystemAudio();

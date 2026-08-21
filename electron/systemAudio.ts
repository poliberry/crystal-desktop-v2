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
/** How many input-guard ticks between hardware-sink revalidation (~4.8s). */
const HARDWARE_SINK_REVALIDATE_TICKS = 12;
/**
 * Consecutive fought-over moves before we stop trying to move a stream and
 * back off. Kept deliberately low: each `pactl move-sink-input` that gets
 * immediately reversed by a competing processor (e.g. EasyEffects) causes an
 * audible dropout, so we want to give up after as few fights as possible.
 */
const STREAM_FLAP_THRESHOLD = 1;
/**
 * How long to leave a stream alone after it keeps being reclaimed by another
 * processor. Reduced from 15 s to limit how long audio goes un-captured if
 * the competing processor later releases the stream.
 */
const STREAM_FLAP_BACKOFF_MS = 5_000;
/**
 * Debounce window for `pactl subscribe` events before triggering a hardware-
 * sink revalidation. Multiple events often arrive in a burst when the user
 * changes the output device in pavucontrol.
 */
const SINK_WATCH_DEBOUNCE_MS = 300;

/** application.process.binary values that must never be moved into the capture sink. */
const SELF_BINARIES = new Set(["electron", "Electron", "Crystal", "crystal", "pulseaudio", "pipewire"]);

/**
 * PulseAudio/PipeWire module types that back a software sink rather than real
 * hardware output. Third-party audio processors (EasyEffects and similar)
 * insert themselves this way — if one has been set as the system default, it
 * must never be mistaken for "the" hardware sink (see `listVirtualSinkNames`).
 */
const VIRTUAL_SINK_MODULES = new Set([
  "module-null-sink",
  "module-filter-chain",
  "module-remap-sink",
  "module-combine-sink",
  "module-ladspa-sink",
  "module-echo-cancel",
]);

/**
 * PipeWire-native virtual sinks (e.g. EasyEffects running in native PipeWire
 * mode rather than through the PulseAudio compat layer) do NOT show a
 * recognised Owner Module in `pactl list sinks`, so they cannot be caught by
 * VIRTUAL_SINK_MODULES alone. We supplement that check with name/description
 * pattern matching so they are never mistaken for real hardware output.
 *
 * VIRTUAL_SINK_NAME_RX  – matches the sink's `Name:` field.
 * VIRTUAL_SINK_DESC_RX  – matches the sink's `device.description` property.
 */
const VIRTUAL_SINK_NAME_RX = /^easyeffects[_-]/i;
const VIRTUAL_SINK_DESC_RX = /easy\s*effects/i;

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
  private hardwareSinkGuardTicks = 0;
  private hardwareSinkRevalidation: Promise<void> | null = null;
  /**
   * Per sink-input flap tracking: detects a competing audio processor (e.g.
   * EasyEffects) repeatedly reclaiming a stream right after we move it onto
   * the capture sink. Fighting that every guardian tick is what produces
   * audible crackle, so once a stream flaps a few times we back off instead.
   */
  private streamMoveState = new Map<string, { target: string; flips: number; backoffUntil: number }>();

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

  /**
   * `pactl subscribe` child that watches for sink/server events so we can
   * react to pavucontrol device switches immediately instead of waiting for
   * the next HARDWARE_SINK_REVALIDATE_TICKS polling cycle.
   */
  private sinkWatchChild: ChildProcess | null = null;
  private sinkWatchDebounce: ReturnType<typeof setTimeout> | null = null;

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
    if (blocks.length === 0) {
      this.streamMoveState.clear();
      return;
    }

    const sinks = await this.pactl(["list", "short", "sinks"]).catch(() => "");
    const nameByIndex = new Map<string, string>();
    for (const line of sinks.split("\n")) {
      const [idx, name] = line.split("\t");
      if (idx && name) nameByIndex.set(idx, name);
    }

    const seenIds = new Set<string>();

    for (const block of blocks) {
      const idMatch = block.match(/^(\d+)/);
      if (!idMatch) continue;
      const id = idMatch[1];
      seenIds.add(id);

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

      if (target === null) {
        this.streamMoveState.delete(id);
        continue;
      }
      if (currentSink === target) continue;

      if (isSelf) {
        await this.pactl(["move-sink-input", id, target]).catch(() => {});
        continue;
      }

      const flapState = this.streamMoveState.get(id);
      if (flapState && flapState.target === target) {
        if (Date.now() < flapState.backoffUntil) continue;
        if (flapState.flips >= STREAM_FLAP_THRESHOLD) {
          console.warn(
            `[system-audio] "${appName || binary || id}" keeps getting pulled off the capture sink by another audio app (e.g. an effects processor) — leaving it alone for ${STREAM_FLAP_BACKOFF_MS / 1000}s instead of fighting it.`
          );
          flapState.backoffUntil = Date.now() + STREAM_FLAP_BACKOFF_MS;
          flapState.flips = 0;
          continue;
        }
      } else {
        this.streamMoveState.set(id, { target, flips: 0, backoffUntil: 0 });
      }

      // Re-read from the map so the increment is always applied — the `flapState`
      // binding above is `undefined` on the very first visit (the entry didn't
      // exist yet when the const was bound), which previously caused the first
      // fought-over move to not count toward the flap threshold.
      const liveState = this.streamMoveState.get(id)!;
      const moved = await this.pactl(["move-sink-input", id, target]).then(() => true).catch(() => false);
      if (moved) liveState.flips += 1;
    }

    for (const id of this.streamMoveState.keys()) {
      if (!seenIds.has(id)) this.streamMoveState.delete(id);
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

  /**
   * Spawn `pactl subscribe` and trigger an immediate hardware-sink
   * revalidation whenever the server's default sink changes or a sink is
   * added/removed. This gives sub-second reaction time to output-device
   * switches made in pavucontrol, compared with the ~4.8 s polling fallback.
   *
   * The child is restarted automatically if it exits unexpectedly (pactl can
   * occasionally die when the PipeWire/PulseAudio session restarts).
   */
  private startSinkWatcher(): void {
    if (this.sinkWatchChild) return;

    const trySpawn = () => {
      if (!this.enabled) return;
      const child = spawn("pactl", ["subscribe"], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      this.sinkWatchChild = child;

      child.stdout?.on("data", (chunk: Buffer) => {
        if (!this.enabled) return;
        const text = chunk.toString();
        // We only care about server (default-sink change) or sink topology events.
        if (!/Event '[^']+' on (server|sink\b)/.test(text)) return;
        if (this.sinkWatchDebounce) return;
        this.sinkWatchDebounce = setTimeout(() => {
          this.sinkWatchDebounce = null;
          if (!this.enabled || this.hardwareSinkRevalidation) return;
          this.hardwareSinkRevalidation = this.revalidateHardwareSink().finally(() => {
            this.hardwareSinkRevalidation = null;
          });
        }, SINK_WATCH_DEBOUNCE_MS);
      });

      child.on("error", () => {
        if (this.sinkWatchChild === child) this.sinkWatchChild = null;
      });

      child.on("exit", () => {
        if (this.sinkWatchChild !== child) return;
        this.sinkWatchChild = null;
        // Restart after a brief delay if still enabled (e.g. PipeWire restarted).
        if (this.enabled) setTimeout(trySpawn, 2_000);
      });
    };

    trySpawn();
  }

  private stopSinkWatcher(): void {
    if (this.sinkWatchDebounce) {
      clearTimeout(this.sinkWatchDebounce);
      this.sinkWatchDebounce = null;
    }
    const child = this.sinkWatchChild;
    this.sinkWatchChild = null;
    if (!child) return;
    child.stdout?.removeAllListeners("data");
    child.kill("SIGTERM");
    const killer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 1_500);
    child.once("exit", () => clearTimeout(killer));
  }

  private startInputGuard(): void {
    if (this.inputGuard) return;
    this.hardwareSinkGuardTicks = 0;
    this.inputGuard = setInterval(() => {
      void this.routeSinkInputs();
      this.hardwareSinkGuardTicks += 1;
      if (this.hardwareSinkGuardTicks >= HARDWARE_SINK_REVALIDATE_TICKS) {
        this.hardwareSinkGuardTicks = 0;
        if (!this.hardwareSinkRevalidation) {
          this.hardwareSinkRevalidation = this.revalidateHardwareSink().finally(() => {
            this.hardwareSinkRevalidation = null;
          });
        }
      }
    }, INPUT_GUARD_INTERVAL_MS);
  }

  private async stopInputGuard(): Promise<void> {
    if (this.inputGuard) {
      clearInterval(this.inputGuard);
      this.inputGuard = null;
    }
    if (this.hardwareSinkRevalidation) {
      await this.hardwareSinkRevalidation.catch(() => {});
      this.hardwareSinkRevalidation = null;
    }
  }

  /**
   * The hardware sink is resolved once when sharing starts, but the real
   * output can change afterward — the user switching devices in pavucontrol,
   * or a conflicting app (e.g. EasyEffects) reclaiming the default. Staying
   * pinned to a stale or now-virtual sink is what breaks playback entirely;
   * re-check periodically and re-wire the "hear what you're sharing" loopback
   * if the right target moved.
   */
  private async revalidateHardwareSink(): Promise<void> {
    if (!this.enabled || !this.hardwareSink) return;
    try {
      let sinksShort: string;
      let virtualNames: Set<string>;
      let currentDefault: string | null;
      try {
        [sinksShort, virtualNames, currentDefault] = await Promise.all([
          this.pactl(["list", "short", "sinks"]).catch(() => ""),
          this.listVirtualSinkNames(),
          this.pactl(["get-default-sink"]).catch(() => null),
        ]);
      } catch (err) {
        console.error("[system-audio] sink detection failed, skipping revalidation:", err);
        return;
      }
      const sinkNames = new Set(
        sinksShort
          .split("\n")
          .map((l) => l.split("\t")[1])
          .filter((n): n is string => !!n)
      );

      const stillValid = sinkNames.has(this.hardwareSink) && !virtualNames.has(this.hardwareSink);
      const candidateDefault =
        currentDefault && currentDefault !== SINK_NAME && !virtualNames.has(currentDefault)
          ? currentDefault
          : null;

      let nextHardwareSink = this.hardwareSink;
      if (!stillValid) {
        nextHardwareSink = candidateDefault ?? (await this.firstHardwareSink()) ?? this.hardwareSink;
      } else if (candidateDefault && candidateDefault !== this.hardwareSink) {
        // The user picked a different real output device — follow it.
        nextHardwareSink = candidateDefault;
      }

      if (nextHardwareSink !== this.hardwareSink) {
        await this.retargetLoopback(nextHardwareSink);
      }
    } catch (err) {
      console.error("[system-audio] hardware sink revalidation failed:", err);
    }
  }

  /** Re-point the "hear what you're sharing" loopback at a new hardware sink. */
  private async retargetLoopback(nextHardwareSink: string): Promise<void> {
    if (!this.enabled) return;
    const staleModuleIndexes = this.moduleIndexes.slice(1); // [0] is the null-sink itself
    const loopbackIndexStr = await this.pactl([
      "load-module",
      "module-loopback",
      `source=${SINK_NAME}.monitor`,
      `sink=${nextHardwareSink}`,
      `latency_msec=${LOOPBACK_LATENCY_MS}`,
      "channels=2",
    ]).catch(() => null);
    if (loopbackIndexStr === null) return;

    this.hardwareSink = nextHardwareSink;
    this.playbackSink = nextHardwareSink;
    this.moduleIndexes.push(parseInt(loopbackIndexStr, 10));

    for (const index of staleModuleIndexes) {
      const unloaded = await this.pactl(["unload-module", String(index)]).then(() => true).catch(() => false);
      if (unloaded) this.moduleIndexes = this.moduleIndexes.filter((i) => i !== index);
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
    const [, defaultSink, virtualSinkNames] = await Promise.all([
      this.cleanupStale(),
      this.pactl(["get-default-sink"]).catch(() => null),
      this.listVirtualSinkNames(),
    ]);
    this.originalDefaultSink = defaultSink;

    // If the current default is itself virtual (e.g. an effects processor
    // like EasyEffects that made itself the default output), it isn't a
    // usable playback target for the "hear what you're sharing" loopback —
    // looping back into it would just re-run captured audio through the
    // processor a second time. Find a real hardware sink instead.
    const hardwareSink =
      (defaultSink && !virtualSinkNames.has(defaultSink) ? defaultSink : null) ??
      (await this.firstHardwareSink()) ??
      defaultSink ??
      null;

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
    // React to device changes in pavucontrol immediately instead of waiting
    // for the next HARDWARE_SINK_REVALIDATE_TICKS polling cycle.
    this.startSinkWatcher();

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
    await this.stopInputGuard();
    this.stopSinkWatcher();
    this.streamMoveState.clear();
    this.hardwareSinkGuardTicks = 0;
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
    const [sinks, virtualNames] = await Promise.all([
      this.pactl(["list", "short", "sinks"]).catch(() => ""),
      this.listVirtualSinkNames(),
    ]);
    for (const line of sinks.split("\n")) {
      const name = line.split("\t")[1];
      if (name && !virtualNames.has(name)) return name;
    }
    return null;
  }

  /**
   * Sink names that are software-backed rather than real hardware output:
   * our own capture sink, and anything owned by a filter/remap/combine
   * module. Covers third-party audio processors (EasyEffects and similar)
   * that route through a virtual sink of their own, so they're never
   * mistaken for "the" hardware output.
   *
   * Two detection paths run in parallel:
   *  1. Module-based  — Owner Module is in VIRTUAL_SINK_MODULES (covers
   *     PulseAudio mode and PipeWire-pulse compat mode).
   *  2. Pattern-based — name or device.description matches known virtual-sink
   *     markers (covers PipeWire-native mode where sinks created inside the
   *     PipeWire graph have no Owner Module visible via the compat layer).
   */
  private async listVirtualSinkNames(): Promise<Set<string>> {
    const [sinksRaw, modulesRaw] = await Promise.all([
      this.pactl(["list", "sinks"]),
      this.pactl(["list", "short", "modules"]),
    ]);

    const moduleNameByIndex = new Map<string, string>();
    for (const line of modulesRaw.split("\n")) {
      const [idx, name] = line.split("\t");
      if (idx && name) moduleNameByIndex.set(idx, name);
    }

    const virtual = new Set<string>([SINK_NAME]);
    const blocks = sinksRaw.split(/Sink #/).slice(1);
    for (const block of blocks) {
      const nameMatch = block.match(/Name: (\S+)/);
      if (!nameMatch) continue;
      const sinkName = nameMatch[1];

      // Path 1: module-based detection (PulseAudio / PipeWire-pulse compat).
      const ownerMatch = block.match(/Owner Module: (\d+)/);
      if (ownerMatch) {
        const moduleName = moduleNameByIndex.get(ownerMatch[1]);
        if (moduleName && VIRTUAL_SINK_MODULES.has(moduleName)) {
          virtual.add(sinkName);
          continue;
        }
      }

      // Path 2: pattern-based detection for PipeWire-native virtual sinks
      // (e.g. EasyEffects) whose Owner Module is not in VIRTUAL_SINK_MODULES.
      if (VIRTUAL_SINK_NAME_RX.test(sinkName)) {
        virtual.add(sinkName);
        continue;
      }
      const descMatch = block.match(/device\.description = "([^"]*)"/);
      if (descMatch && VIRTUAL_SINK_DESC_RX.test(descMatch[1])) {
        virtual.add(sinkName);
      }
    }
    return virtual;
  }

  private static s16leToFloat32(buf: Buffer): ArrayBuffer {
    const n = buf.length >> 1;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
    return out.buffer;
  }
}

export default new LinuxSystemAudio();

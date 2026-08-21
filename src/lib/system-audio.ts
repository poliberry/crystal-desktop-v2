"use client";

import {
  LocalAudioTrack,
  Room,
  Track,
  createLocalAudioTrack,
} from "livekit-client";

import { getDesktopAPI, getPlatform, isElectron } from "@/lib/desktop";

/**
 * Cross-platform "share system audio" layer.
 *
 * The app captures the *other* applications' audio and publishes it into the
 * LiveKit room, without capturing its own audio output:
 *
 *  - Linux (Electron): a PulseAudio `null` sink is created and set as the
 *    default sink, so every other application plays into it, while the app
 *    itself routes its own playback to the real hardware sink (via
 *    `HTMLMediaElement.setSinkId` and a main-process routing guardian) so it
 *    never enters the monitor. The main process captures that virtual sink's
 *    monitor directly with `parec`/`pw-record` and streams raw PCM over IPC;
 *    this renderer injects it through an AudioWorklet →
 *    MediaStreamAudioDestinationNode (the same `acquirePcmLoopbackTrack`
 *    pipeline macOS uses) and publishes it as a LiveKit `ScreenShareAudio`
 *    track. See `electron/systemAudio.ts` for the pactl work.
 *  - macOS (Electron): a bundled Swift helper (`CrystalSystemAudio`) uses
 *    ScreenCaptureKit to capture the system output with the Crystal app's own
 *    audio excluded via the content filter. Raw PCM is streamed over IPC and
 *    injected through an AudioWorklet → MediaStreamAudioDestinationNode, which
 *    feeds LiveKit and (optionally) the local speakers. See
 *    `native/SystemAudioCapture`.
 *  - Windows: Chromium captures system audio through `getDisplayMedia`,
 *    answered in the main process with `audio: "loopback"` (native WASAPI
 *    loopback of the *entire default output device* — Electron has no
 *    process-tree exclusion for this mode, unlike macOS/Linux above). There is
 *    no reliable way to detect which *other* enumerated output device is
 *    actually connected to something audible, so this app's own playback is
 *    left on the default device untouched (normal call audio keeps working)
 *    unless the user has a known virtual-cable device installed (VB-Cable,
 *    VoiceMeeter, ...), in which case local playback is steered onto it via
 *    `playbackSink` / `routeElementToPlayback` (the same mechanism Linux uses)
 *    so it's excluded from the loopback capture. Without one, the shared
 *    system audio may include this app's own call audio — a known Windows
 *    limitation. See `acquireWindowsSystemAudioTrack` below and
 *    `electron/main.ts`.
 */

let activeTrack: LocalAudioTrack | null = null;
let playbackSink: string | null = null;
let captureDeviceId: string | null = null;
let routingObserver: MutationObserver | null = null;

// --- PCM loopback (macOS ScreenCaptureKit helper / Linux parec) state ----
interface PcmCapture {
  ctx: AudioContext;
  dest: MediaStreamAudioDestinationNode;
  worklet: AudioWorkletNode;
  unsub: () => void;
}

let pcmCapture: PcmCapture | null = null;

// AudioWorklet that turns a stream of interleaved Float32 PCM (48 kHz stereo)
// into a real-time media stream. Keeps a spool; drops old audio if the UI
// stalls so it never buffers indefinitely.
const PCM_WORKLET_SOURCE = `
class CrystalSystemAudioWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(0);
    this.max = 48000 * 2 * 4;
    this.port.onmessage = (e) => {
      const frames = e.data && e.data.frames;
      if (!(frames instanceof Float32Array) || frames.length === 0) return;
      if (this.buf.length === 0) {
        this.buf = frames;
      } else {
        const nb = new Float32Array(this.buf.length + frames.length);
        nb.set(this.buf, 0);
        nb.set(frames, this.buf.length);
        this.buf = nb;
      }
      if (this.buf.length > this.max) this.buf = this.buf.slice(this.buf.length - this.max);
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length < 2) return true;
    const n = out[0].length;
    const need = n * 2;
    for (let c = 0; c < out.length; c++) out[c].fill(0);
    if (this.buf.length >= need) {
      const b = this.buf;
      const l = out[0];
      const r = out[1];
      for (let i = 0; i < n; i++) {
        l[i] = b[i * 2];
        r[i] = b[i * 2 + 1];
      }
      this.buf = b.slice(need);
    }
    return true;
  }
}
registerProcessor("crystal-system-audio-worklet", CrystalSystemAudioWorklet);
`.trim();

function stopPcmCapture(): void {
  const c = pcmCapture;
  pcmCapture = null;
  if (!c) return;
  try {
    c.unsub();
  } catch {
    /* noop */
  }
  try {
    c.worklet.disconnect();
    c.worklet.port.close();
  } catch {
    /* noop */
  }
  try {
    c.dest.disconnect();
  } catch {
    /* noop */
  }
  try {
    void c.ctx.close();
  } catch {
    /* noop */
  }
}

/** Tear down the PCM pipeline and disable the platform's capture backend. */
async function stopCaptureBackend(): Promise<void> {
  stopPcmCapture();
  const api = getDesktopAPI();
  if (!api) return;
  const platform = getPlatform();
  if (platform === "darwin") {
    await api.systemAudioMac?.disable().catch(() => {});
  } else if (platform === "linux") {
    await api.systemAudioLinux?.disable().catch(() => {});
  }
}

export function isSystemAudioSharing(): boolean {
  return activeTrack !== null;
}

export function getPlaybackSink(): string | null {
  return playbackSink;
}

function hasAudioSinkSupport(el: HTMLMediaElement): el is HTMLMediaElement & {
  setSinkId(sinkId: string): Promise<void>;
} {
  return typeof (el as unknown as { setSinkId?: unknown }).setSinkId === "function";
}

let outputDevicesCache: MediaDeviceInfo[] | null = null;

/**
 * Map a PulseAudio sink *name* to a device id `setSinkId()` will accept.
 * Chromium keys audiooutput devices by id from `enumerateDevices()`, which on
 * Linux derives from (but is not always identical to) the sink name. Returns
 * null when nothing matches; the main-process self-guard then keeps the app's
 * own streams out of the capture sink instead.
 */
async function resolveOutputDeviceId(targetSink: string): Promise<string | null> {
  if (!outputDevicesCache) {
    outputDevicesCache = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === "audiooutput"
    );
  }
  const exact = outputDevicesCache.find(
    (d) => d.deviceId === targetSink || (d.label && d.label === targetSink)
  );
  if (exact) return exact.deviceId;
  const partial = outputDevicesCache.find(
    (d) =>
      d.deviceId &&
      (d.deviceId.includes(targetSink) || targetSink.includes(d.deviceId))
  );
  return partial?.deviceId ?? null;
}

/**
 * Route a media element's audio output to the real hardware sink, keeping the
 * app's own playback out of the PulseAudio monitor that is being shared.
 * Safe to call for every attached track while system audio sharing is active.
 */
export async function routeElementToPlayback(el: HTMLMediaElement): Promise<void> {
  if (!playbackSink || !hasAudioSinkSupport(el)) return;
  const resolved = await resolveOutputDeviceId(playbackSink);
  if (!resolved) return;
  try {
    if (el.sinkId !== resolved) {
      await el.setSinkId(resolved);
    }
  } catch (err) {
    console.warn("[system-audio] setSinkId failed", err);
  }
}

/**
 * Routes every audio/video element currently in the DOM to the hardware sink.
 */
export async function routeAllElementsToPlayback(): Promise<void> {
  const elements = Array.from(document.querySelectorAll<HTMLMediaElement>("audio, video"));
  await Promise.all(elements.map(routeElementToPlayback));
}

/** Send a media element's audio output back to the system default device. */
async function resetElementPlayback(el: HTMLMediaElement): Promise<void> {
  if (!hasAudioSinkSupport(el) || el.sinkId === "") return;
  try {
    await el.setSinkId("");
  } catch (err) {
    console.warn("[system-audio] setSinkId reset failed", err);
  }
}

/** Routes every audio/video element currently in the DOM back to the default device. */
async function resetAllElementsPlayback(): Promise<void> {
  const elements = Array.from(document.querySelectorAll<HTMLMediaElement>("audio, video"));
  await Promise.all(elements.map(resetElementPlayback));
}

/**
 * Find a real *virtual* audio-cable output device (VB-Cable, VoiceMeeter,
 * etc.) to steer this app's own playback onto, so it's off the device that
 * Windows WASAPI loopback is capturing.
 *
 * Deliberately does NOT fall back to "any other output device": there is no
 * way to tell from the browser whether some other enumerated device is
 * actually connected to something audible (HDMI-out with nothing plugged in,
 * a disabled endpoint, etc.), and guessing wrong routes the user's own call
 * audio to silence instead of their speakers. A virtual-cable device is safe
 * to assume is intentionally installed and consumed by something (the user
 * set it up for exactly this kind of routing) — a real device is not.
 * Returns null (skip self-exclusion, capture is not touched) otherwise.
 */
async function resolveWindowsAlternateSink(): Promise<string | null> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices.filter((d) => d.kind === "audiooutput");
  const virtualCable = outputs.find((d) => /cable|vb-audio|voicemeeter/i.test(d.label));
  return virtualCable?.deviceId ?? null;
}

function watchNewMediaElements() {
  if (!playbackSink || routingObserver) return;
  routingObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLMediaElement) {
          void routeElementToPlayback(node);
        } else if (node instanceof Element) {
          node.querySelectorAll<HTMLMediaElement>("audio, video").forEach((el) => {
            void routeElementToPlayback(el);
          });
        }
      }
    }
  });
  routingObserver.observe(document.body, { childList: true, subtree: true });
}

function stopWatchingNewMediaElements() {
  routingObserver?.disconnect();
  routingObserver = null;
}

/**
 * Chromium requires `video: true` on every `getDisplayMedia()` call, so this
 * grabs (and immediately discards) a throwaway video track purely to unlock
 * the audio track we actually want. Used on Windows — the main process's
 * `setDisplayMediaRequestHandler` (electron/main.ts) answers with
 * `audio: "loopback"`, a native WASAPI loopback of the whole default output
 * device (no self-exclusion — see `acquireWindowsSystemAudioTrack`, which
 * reroutes this app's own playback away from that device). (Linux no longer
 * uses this path: it captures the virtual sink's monitor directly with
 * `parec`/`pw-record`, see `acquireLinuxSystemAudioTrack`.)
 */
async function acquireDisplayMediaAudioTrack(): Promise<LocalAudioTrack> {
  const media = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });
  media.getVideoTracks().forEach((t) => t.stop());

  const msTrack = media.getAudioTracks()[0];
  if (!msTrack) {
    throw new Error("System audio was not enabled in the share prompt.");
  }
  const track = new LocalAudioTrack(msTrack, undefined, true);
  track.source = Track.Source.ScreenShareAudio;
  return track;
}

async function acquireLinuxSystemAudioTrack(): Promise<LocalAudioTrack | null> {
  const linuxApi = getDesktopAPI()?.systemAudioLinux;
  if (!linuxApi) return null;

  captureDeviceId = "crystal_system_audio.monitor";

  try {
    const track = await acquirePcmLoopbackTrack({
      start: () => linuxApi.enable(),
      onAudio: linuxApi.onAudio,
      stop: () => linuxApi.disable(),
      monitor: false,
    });
    track.source = Track.Source.ScreenShareAudio;
    return track;
  } catch (err) {
    await stopCaptureBackend();
    throw err;
  }
}

async function acquireMacLoopbackTrack(): Promise<LocalAudioTrack | null> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const device = devices.find(
    (d) =>
      d.kind === "audioinput" &&
      /blackhole|background music|loopback/i.test(d.label)
  );
  if (!device) {
    throw new Error(
      "No loopback device found. Install BlackHole (or Background Music) to share system audio on macOS."
    );
  }

  captureDeviceId = device.deviceId;
  const track = await createLocalAudioTrack({
    deviceId: device.deviceId,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  });
  return track;
}

async function acquireWindowsSystemAudioTrack(): Promise<LocalAudioTrack | null> {
  const track = await acquireDisplayMediaAudioTrack();

  // WASAPI loopback captures the entire default output device, which
  // includes this app's own received call audio unless we steer our own
  // playback onto a virtual-cable device first. Most users won't have one
  // installed, so this is a best-effort mitigation, not a guarantee — see
  // `resolveWindowsAlternateSink` for why we never guess at a real device.
  try {
    const alternate = await resolveWindowsAlternateSink();
    if (alternate) playbackSink = alternate;
  } catch (err) {
    console.warn("[system-audio] Failed to resolve an alternate playback sink", err);
  }

  return track;
}

async function acquireMacScreenCaptureKitTrack(): Promise<LocalAudioTrack | null> {
  const macApi = getDesktopAPI()?.systemAudioMac;
  if (!macApi) return null;

  const track = await acquirePcmLoopbackTrack({
    start: () => macApi.enable(),
    onAudio: macApi.onAudio,
    stop: () => macApi.disable(),
    monitor: true,
  });
  track.source = Track.Source.ScreenShareAudio;
  return track;
}

/**
 * Shared pipeline for the PCM-over-IPC backends (macOS ScreenCaptureKit helper
 * and Linux `parec`/`pw-record`): the backend streams interleaved Float32 PCM
 * over IPC, this feeds an AudioWorklet → MediaStreamAudioDestinationNode, and
 * LiveKit publishes the resulting track.
 *
 * `monitor` controls local monitoring: macOS plays the capture back to the
 * speakers itself, while Linux gets its monitoring from the PulseAudio
 * loopback module — connecting the AudioContext to `ctx.destination` on Linux
 * would echo the capture back into the virtual sink (an infinite loop), so it
 * must stay off there.
 */
async function acquirePcmLoopbackTrack(opts: {
  start: () => Promise<{
    started: boolean;
    sampleRate?: number;
    playbackSink?: string | null;
    error?: string;
  }>;
  onAudio: (cb: (data: ArrayBuffer) => void) => () => void;
  stop: () => Promise<unknown>;
  monitor?: boolean;
}): Promise<LocalAudioTrack> {
  const res = await opts.start();
  if (!res.started) {
    throw new Error(res.error ?? "Failed to start system audio capture.");
  }
  if (res.playbackSink) playbackSink = res.playbackSink;

  const sampleRate = res.sampleRate ?? 48000;
  const ctx = new AudioContext({ sampleRate });
  await ctx.resume().catch(() => {});

  const blob = new Blob([PCM_WORKLET_SOURCE], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  const dest = ctx.createMediaStreamDestination();
  const worklet = new AudioWorkletNode(ctx, "crystal-system-audio-worklet", {
    outputChannelCount: [2],
  });
  worklet.connect(dest);
  if (opts.monitor) {
    // Local monitoring: the sharer hears what is being shared.
    worklet.connect(ctx.destination);
  }

  // IPC chunks are independent PCM blocks, but re-align defensively anyway.
  let pending = new Uint8Array(0);
  const unsub = opts.onAudio((data) => {
    if (!pcmCapture) return;
    const incoming = new Uint8Array(data);
    const merged = new Uint8Array(pending.length + incoming.length);
    merged.set(pending);
    merged.set(incoming, pending.length);
    const whole = merged.length - (merged.length % 8);
    if (whole > 0) {
      const frames = new Float32Array(merged.buffer, 0, whole / 4);
      worklet.port.postMessage({ frames });
    }
    pending = merged.subarray(whole);
  });

  const track = dest.stream.getAudioTracks()[0];
  if (!track) {
    unsub();
    await opts.stop().catch(() => {});
    try {
      worklet.disconnect();
      dest.disconnect();
    } catch {
      /* noop */
    }
    void ctx.close();
    throw new Error("Failed to create an audio track from system audio.");
  }

  pcmCapture = { ctx, dest, worklet, unsub };
  return new LocalAudioTrack(track, undefined, true);
}

/**
 * Start sharing system audio. Returns the published track on success.
 */
export async function shareSystemAudio(room: Room): Promise<LocalAudioTrack> {
  if (activeTrack) return activeTrack;

  const platform = getPlatform();
  let track: LocalAudioTrack | null = null;

  if (platform === "linux" && isElectron()) {
    track = await acquireLinuxSystemAudioTrack();
  } else if (platform === "darwin" && isElectron() && getDesktopAPI()?.systemAudioMac) {
    track = await acquireMacScreenCaptureKitTrack();
  } else if (platform === "darwin") {
    track = await acquireMacLoopbackTrack();
  } else if (platform === "win32") {
    track = await acquireWindowsSystemAudioTrack();
  }

  if (!track) {
    throw new Error("System audio is not supported on this platform.");
  }

  try {
    await room.localParticipant.publishTrack(track, {
      source: Track.Source.ScreenShareAudio,
    });
  } catch (err) {
    if (pcmCapture) stopPcmCapture();
    throw err;
  }

  activeTrack = track;
  watchNewMediaElements();
  void routeAllElementsToPlayback();
  return track;
}

/**
 * Stop sharing system audio and tear down any virtual capture device.
 */
export async function stopSystemAudio(room: Room): Promise<void> {
  await stopCaptureBackend();

  if (activeTrack) {
    await room.localParticipant.unpublishTrack(activeTrack).catch(() => {});
    activeTrack.stop();
    activeTrack.detach();
    activeTrack = null;
  }

  captureDeviceId = null;
  stopWatchingNewMediaElements();
  playbackSink = null;
  await resetAllElementsPlayback();
}

/** Toggle helper used by the control bar. */
export async function toggleSystemAudio(room: Room): Promise<{
  sharing: boolean;
  error?: string;
}> {
  if (activeTrack) {
    await stopSystemAudio(room);
    return { sharing: false };
  }
  try {
    await shareSystemAudio(room);
    return { sharing: true };
  } catch (err) {
    return {
      sharing: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

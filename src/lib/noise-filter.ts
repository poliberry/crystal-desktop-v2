/**
 * Krisp noise suppression for the local microphone.
 *
 * LiveKit ships Krisp as a *track processor*: it sits between the raw capture
 * and the published track, so remote participants hear the cleaned audio and
 * nothing else in the app has to know about it.
 *
 *   microphone → getUserMedia → [ Krisp ] → published track
 *
 * The plugin is ~6 MB (the models are inlined in the bundle), so it is only
 * ever pulled in through a dynamic `import()` — a user who leaves the setting
 * off never downloads it. Everything here fails soft: noise suppression not
 * loading is never a reason for a call not to connect.
 */

import { Track } from "livekit-client";
import type {
  AudioProcessorOptions,
  LocalAudioTrack,
  Room,
  TrackProcessor,
} from "livekit-client";

/** The processor's own `name`, which is how we recognise ours on a track we
 * didn't necessarily attach it to ourselves. */
const FILTER_NAME = "livekit-noise-filter";

type NoiseFilter = TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> & {
  setEnabled(enabled: boolean): Promise<boolean | undefined>;
  isEnabled(): boolean;
};

/**
 * Whether the filter can run here at all, answered without downloading it.
 *
 * Mirrors the plugin's own `isKrispNoiseFilterSupported()` — which only rules
 * out Safari before 17.4 — so the UI can gate the toggle up front instead of
 * pulling in megabytes to find out.
 */
export function isNoiseSuppressionSupported(): boolean {
  if (typeof window === "undefined" || typeof AudioWorkletNode === "undefined") return false;

  const ua = navigator.userAgent;
  if (!/^((?!chrome|android|crios|fxios).)*safari/i.test(ua)) return true;
  const version = /version\/(\d+)\.(\d+)/i.exec(ua);
  if (!version) return false;
  const major = Number(version[1]);
  const minor = Number(version[2]);
  return major > 17 || (major === 17 && minor >= 4);
}

/**
 * Load the plugin and build a fresh processor, or `null` if it can't run.
 *
 * A processor instance belongs to exactly one track: LiveKit destroys it when
 * that track stops, and a destroyed one can't be revived — so this always
 * hands back a new one rather than caching a singleton.
 */
export async function createNoiseFilter(): Promise<NoiseFilter | null> {
  if (!isNoiseSuppressionSupported()) return null;
  try {
    const { KrispNoiseFilter, isKrispNoiseFilterSupported } = await import(
      "@livekit/krisp-noise-filter"
    );
    if (!isKrispNoiseFilterSupported()) return null;
    return KrispNoiseFilter() as NoiseFilter;
  } catch (err) {
    console.warn("Noise suppression unavailable", err);
    return null;
  }
}

/** The Krisp processor already on this track, if it's ours. */
function attachedFilter(track: LocalAudioTrack): NoiseFilter | null {
  const processor = track.getProcessor();
  return processor?.name === FILTER_NAME ? (processor as NoiseFilter) : null;
}

/** The published microphone track, if the mic is live. */
export function localMicrophoneTrack(room: Room): LocalAudioTrack | undefined {
  const pub = room.localParticipant?.getTrackPublication(Track.Source.Microphone);
  return pub?.audioTrack as LocalAudioTrack | undefined;
}

/**
 * Bring a live microphone track in line with the user's preference, and
 * report whether the filter ended up running.
 *
 * Turning it off leaves the processor attached and bypassed rather than
 * detaching it: `setProcessor`/`stopProcessor` republish the track (an
 * audible gap for everyone else), while `setEnabled` is instant. Attaching is
 * therefore lazy — a user who never turns it on never pays for it.
 */
export async function applyNoiseSuppression(
  track: LocalAudioTrack | undefined,
  enabled: boolean
): Promise<boolean> {
  if (!track) return false;

  const existing = attachedFilter(track);
  if (existing) {
    try {
      await existing.setEnabled(enabled);
    } catch (err) {
      console.warn("Could not toggle noise suppression", err);
    }
    return existing.isEnabled();
  }

  if (!enabled) return false;

  const filter = await createNoiseFilter();
  if (!filter) return false;
  try {
    await track.setProcessor(filter);
    // `setProcessor` on an already-published track doesn't re-run the
    // plugin's own publish hook, so ask for it explicitly.
    await filter.setEnabled(true);
    return filter.isEnabled();
  } catch (err) {
    console.warn("Could not enable noise suppression", err);
    return false;
  }
}

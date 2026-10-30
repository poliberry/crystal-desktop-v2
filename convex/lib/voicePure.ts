import { effectiveFileType } from "./mediaType";

/**
 * Voice messages, as plain functions: what a recording has to look like to be sent as one. The
 * audio itself is an ordinary attachment; the message carries its length and a waveform to draw.
 */

/** Longest a voice message can be: five minutes. A little slack is allowed for the recorder's last chunk. */
export const MAX_VOICE_MS = 5 * 60 * 1000;
export const VOICE_SLACK_MS = 2000;
/** Bars in the waveform a voice message carries. */
export const VOICE_WAVEFORM_BARS = 64;

export interface VoiceMessageInput {
  durationMs: number;
  waveform: number[];
}

/**
 * Check a voice message and the attachments it was sent with, returning what to store. A voice
 * message is one audio file and nothing else: no text, no other files. Throws, saying what is wrong.
 */
export function cleanVoiceMessage(
  input: VoiceMessageInput,
  attachments: readonly { fileName: string; fileType: string }[],
  body: { hasText: boolean },
): VoiceMessageInput {
  if (attachments.length !== 1) throw new Error("A voice message is a single recording.");
  const type = effectiveFileType(attachments[0].fileType, attachments[0].fileName);
  if (!type.startsWith("audio/") && type !== "video/webm") throw new Error("A voice message has to be an audio recording.");
  if (body.hasText) throw new Error("A voice message can't carry text.");
  if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) throw new Error("That recording is empty.");
  if (input.durationMs > MAX_VOICE_MS + VOICE_SLACK_MS) throw new Error("Voice messages are up to 5 minutes long.");
  if (!Array.isArray(input.waveform) || input.waveform.length > VOICE_WAVEFORM_BARS * 2) throw new Error("That waveform isn't valid.");
  const waveform = input.waveform.map((n) => (Number.isFinite(n) ? Math.min(255, Math.max(0, Math.round(n))) : 0));
  return { durationMs: Math.round(input.durationMs), waveform };
}

/** Peak amplitudes (0–1) from raw samples, reduced to `bars` bars of 0–255. */
export function waveformFromSamples(samples: ArrayLike<number>, bars = VOICE_WAVEFORM_BARS): number[] {
  const out: number[] = [];
  if (samples.length === 0) return new Array(bars).fill(0);
  const size = samples.length / bars;
  for (let b = 0; b < bars; b++) {
    const from = Math.floor(b * size);
    const to = Math.max(from + 1, Math.floor((b + 1) * size));
    let peak = 0;
    for (let i = from; i < to && i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
    out.push(Math.min(255, Math.round(peak * 255)));
  }
  return out;
}

/** The most a quiet recording is boosted by, so room hiss isn't blown up into a wall of full-height bars. */
const MAX_PEAK_GAIN = 8;

/**
 * Peaks sampled while recording (each 0–1, however many there are) reduced to exactly `bars` bars of
 * 0–255. Each bar is the loudest peak in its slice; the whole thing is then scaled up so the loudest bar
 * is full height, which keeps a quiet recording's shape visible, but only by a capped amount so near
 * silence stays low. Never exceeds 255.
 */
export function resamplePeaks(peaks: ArrayLike<number>, bars = VOICE_WAVEFORM_BARS): number[] {
  if (peaks.length === 0 || bars <= 0) return new Array(Math.max(0, bars)).fill(0);
  const clean = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
  const size = peaks.length / bars;
  const reduced: number[] = [];
  let loudest = 0;
  for (let b = 0; b < bars; b++) {
    // With fewer peaks than bars, neighbouring bars share a peak rather than leaving gaps.
    const from = Math.min(peaks.length - 1, Math.floor(b * size));
    const to = Math.max(from + 1, Math.floor((b + 1) * size));
    let peak = 0;
    for (let i = from; i < to && i < peaks.length; i++) peak = Math.max(peak, clean(peaks[i]));
    reduced.push(peak);
    loudest = Math.max(loudest, peak);
  }
  if (loudest === 0) return reduced.map(() => 0);
  const gain = Math.min(1 / loudest, MAX_PEAK_GAIN);
  return reduced.map((p) => Math.min(255, Math.round(p * gain * 255)));
}

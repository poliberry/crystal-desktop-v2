/**
 * Minimal 16-bit mono PCM WAV writer, shared by the soundboard and UI sound
 * generators. Both write short synthesized clips, so there's no need for a
 * real audio library — just the 44-byte canonical header and samples.
 */

export const SAMPLE_RATE = 44100;

/** Wrap a Float32 sample buffer (-1..1) in a WAV container. */
export function toWav(samples) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16); // PCM fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

/** Render `durationMs` of audio by sampling `fn(timeSeconds, progress)`. */
export function render(durationMs, fn) {
  const length = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = fn(i / SAMPLE_RATE, i / length);
  }
  return out;
}

export const sine = (t, freq) => Math.sin(2 * Math.PI * freq * t);
export const square = (t, freq) => (sine(t, freq) >= 0 ? 1 : -1);
export const saw = (t, freq) => 2 * ((t * freq) % 1) - 1;

/** Exponential decay with a short attack, so nothing clicks on onset. */
export const decay = (progress, rate = 6) =>
  Math.min(1, progress * 60) * Math.exp(-rate * progress);

/** Trapezoidal envelope — flat middle, soft edges. For sustained tones where
 * an exponential decay would sound like a pluck. */
export function envelope(progress, attack = 0.08, release = 0.25) {
  const rise = Math.min(1, progress / attack);
  const fall = Math.min(1, (1 - progress) / release);
  return Math.max(0, Math.min(rise, fall));
}

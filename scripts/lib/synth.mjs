/**
 * The small synthesis kit behind the UI sounds: plucked "bubble" voices, soft
 * sustained tones, a touch of reverb, and level control.
 *
 * The earlier clips were bare sine waves with an envelope, which is why they
 * sounded like test tones. What makes the sounds people know from chat apps
 * feel friendly is a handful of small things this adds:
 *
 *  - a pitch that *glides* into the note over a few milliseconds, which is the
 *    round "bloop" rather than a flat beep;
 *  - a few soft harmonics, each fading faster than the one below, so the note
 *    is bright at the start and mellow at the end;
 *  - notes that overlap and ring into each other instead of being cut;
 *  - a short, quiet room round the whole thing so it sits somewhere rather than
 *    being a dry electronic click;
 *  - every clip levelled to a stated peak, so the set is balanced by design.
 */
import { SAMPLE_RATE } from "./wav.mjs";

const TAU = Math.PI * 2;

/** Seconds → samples. */
const samples = (seconds) => Math.max(1, Math.round(seconds * SAMPLE_RATE));

/** Equal-tempered note names to Hz: `note("A4")`, `note("F#5")`. */
export function note(name) {
  const match = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!match) throw new Error(`bad note ${name}`);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1]];
  const semitone = base + (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0);
  const midi = (Number(match[3]) + 1) * 12 + semitone;
  return 440 * 2 ** ((midi - 69) / 12);
}

/** A deterministic noise source, so a re-run writes byte-identical files. */
function noiseSource(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x80000000 - 1;
  };
}

/**
 * One plucked note.
 *
 * `glide` is how far below the target the pitch starts, as a fraction (0.12 =
 * starts 12% flat — or sharp, if negative) and `glideMs` how long it takes to
 * arrive. `partials` are `[multiple, amount, decayMultiple]` — each decays
 * `decayMultiple` times faster than the fundamental, which is what makes the
 * note mellow as it rings.
 */
export function pluck({
  freq,
  durationMs = 220,
  decayMs = 90,
  glide = 0.1,
  glideMs = 28,
  attackMs = 3,
  partials = [
    [2, 0.28, 2.2],
    [3, 0.1, 3.4],
  ],
  gain = 1,
}) {
  const length = samples(durationMs / 1000);
  const out = new Float32Array(length);
  const attack = samples(attackMs / 1000);
  let phases = new Float64Array(partials.length + 1);
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    const arrive = Math.exp(-t / (glideMs / 1000));
    const f = freq * (1 - glide * arrive);
    const rise = i < attack ? i / attack : 1;
    let value = 0;
    // fundamental
    phases[0] += (TAU * f) / SAMPLE_RATE;
    value += Math.sin(phases[0]) * Math.exp(-t / (decayMs / 1000));
    for (let p = 0; p < partials.length; p++) {
      const [multiple, amount, decayMultiple] = partials[p];
      phases[p + 1] += (TAU * f * multiple) / SAMPLE_RATE;
      value += amount * Math.sin(phases[p + 1]) * Math.exp(-(t * decayMultiple) / (decayMs / 1000));
    }
    out[i] = value * rise * gain;
  }
  // A short fade on the very end so a long tail never ends on a step.
  const fade = Math.min(length, samples(0.008));
  for (let i = 0; i < fade; i++) out[length - 1 - i] *= i / fade;
  return out;
}

/**
 * A soft sustained note — an organ-ish sine with a gentle swell — for the
 * heavier actions (deafen) where a pluck would feel too light.
 */
export function tone({ freq, durationMs = 220, attackMs = 22, releaseMs = 140, gain = 1, partials = [[2, 0.08]] }) {
  const length = samples(durationMs / 1000);
  const out = new Float32Array(length);
  const attack = samples(attackMs / 1000);
  const release = samples(releaseMs / 1000);
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    let value = Math.sin(TAU * freq * t);
    for (const [multiple, amount] of partials) value += amount * Math.sin(TAU * freq * multiple * t);
    const rise = Math.min(1, i / attack);
    const fall = Math.min(1, (length - i) / release);
    out[i] = value * Math.sin((Math.PI / 2) * rise) * Math.sin((Math.PI / 2) * fall) * gain;
  }
  return out;
}

/** A tiny filtered-noise tick, for the "click" at the front of a camera or mute
 * sound. */
export function tick({ durationMs = 14, gain = 0.5, cutoffHz = 3200, seed = 7 }) {
  const length = samples(durationMs / 1000);
  const out = new Float32Array(length);
  const noise = noiseSource(seed);
  const a = 1 - Math.exp((-TAU * cutoffHz) / SAMPLE_RATE);
  let state = 0;
  for (let i = 0; i < length; i++) {
    state += a * (noise() - state);
    out[i] = state * Math.exp((-i / length) * 6) * gain;
  }
  return out;
}

/** Lay `voice` into `buffer` starting `atMs` in, growing the buffer if needed. */
export function place(buffer, voice, atMs, gain = 1) {
  const start = samples(atMs / 1000) - 1;
  const needed = start + voice.length;
  let target = buffer;
  if (needed > buffer.length) {
    target = new Float32Array(needed);
    target.set(buffer);
  }
  for (let i = 0; i < voice.length; i++) target[start + i] += voice[i] * gain;
  return target;
}

/** A sequence of `[voice, atMs, gain?]` mixed into one buffer. */
export function sequence(parts) {
  let buffer = new Float32Array(0);
  for (const [voice, atMs, gain] of parts) buffer = place(buffer, voice, atMs, gain ?? 1);
  return buffer;
}

/** One-pole low-pass: takes the fizz off a bright sound. */
export function lowpass(input, cutoffHz) {
  const out = new Float32Array(input.length);
  const a = 1 - Math.exp((-TAU * cutoffHz) / SAMPLE_RATE);
  let state = 0;
  for (let i = 0; i < input.length; i++) {
    state += a * (input[i] - state);
    out[i] = state;
  }
  return out;
}

/** Gentle saturation, so stacked notes add up warmly instead of clipping. */
export function softClip(input, drive = 1.4) {
  const out = new Float32Array(input.length);
  const norm = Math.tanh(drive);
  for (let i = 0; i < input.length; i++) out[i] = Math.tanh(input[i] * drive) / norm;
  return out;
}

/**
 * A small room: four parallel combs into two all-passes (Schroeder's), mixed in
 * underneath the dry sound. The clip is lengthened to hold the tail.
 */
export function room(input, { mix = 0.18, tailMs = 260, decay = 0.62 } = {}) {
  const tail = samples(tailMs / 1000);
  const length = input.length + tail;
  const dry = new Float32Array(length);
  dry.set(input);

  const combTimes = [0.0297, 0.0371, 0.0411, 0.0437].map(samples);
  const wet = new Float32Array(length);
  for (const delay of combTimes) {
    const line = new Float32Array(delay);
    let index = 0;
    for (let i = 0; i < length; i++) {
      const delayed = line[index];
      const next = dry[i] + delayed * decay;
      line[index] = next;
      index = (index + 1) % delay;
      wet[i] += delayed * 0.25;
    }
  }
  // All-pass diffusion.
  let diffused = wet;
  for (const [delaySeconds, g] of [
    [0.005, 0.7],
    [0.0017, 0.7],
  ]) {
    const delay = samples(delaySeconds);
    const line = new Float32Array(delay);
    const out = new Float32Array(length);
    let index = 0;
    for (let i = 0; i < length; i++) {
      const delayed = line[index];
      const value = -g * diffused[i] + delayed;
      line[index] = diffused[i] + g * value;
      index = (index + 1) % delay;
      out[i] = value;
    }
    diffused = out;
  }
  const softened = lowpass(diffused, 4800);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = dry[i] + softened[i] * mix * 4;
  return out;
}

/** Scale so the loudest sample is exactly `peak`. */
export function normalize(input, peak) {
  let max = 0;
  for (let i = 0; i < input.length; i++) max = Math.max(max, Math.abs(input[i]));
  if (max === 0) return input;
  const scale = peak / max;
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] * scale;
  return out;
}

/** Trim trailing near-silence and finish on a short fade, so a clip ends
 * where it is actually quiet. */
export function trimTail(input, floor = 0.0008, fadeMs = 12) {
  let end = input.length;
  while (end > 1 && Math.abs(input[end - 1]) < floor) end--;
  const out = input.slice(0, end);
  // And begin on one: a click that starts mid-wave is a click in the speaker.
  const fadeIn = Math.min(out.length, samples(0.002));
  for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn;
  const fade = Math.min(out.length, samples(fadeMs / 1000));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}

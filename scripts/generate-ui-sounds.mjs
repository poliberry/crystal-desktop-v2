/**
 * Generates the app's UI sound effects into `public/sounds/ui/`.
 *
 * Synthesized rather than shipped as recordings so the repo carries no
 * third-party audio and every clip is short, quiet and consistent in level.
 * Re-run with `bun scripts/generate-ui-sounds.mjs` after editing a recipe; the
 * generated `.wav` files are committed, so nothing runs at build or run time.
 *
 * The vocabulary is deliberately consistent, in the spirit of Discord's:
 * a rising interval means "on / connected / enabled", the same interval
 * falling means "off / disconnected / disabled". That way the meaning of a
 * new sound is guessable from the ones already learned.
 *
 * The clip list here must stay in sync with `UI_SOUNDS` in
 * `src/lib/ui-sounds.ts`, which is what the app actually reads — with the
 * exception of the ringtones, which are supplied audio files this script
 * deliberately doesn't touch.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decay, envelope, render, sine, toWav } from "./lib/wav.mjs";

const OUT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "sounds",
  "ui"
);

/** Two notes in sequence — the building block for every on/off pair. */
function twoTone(firstHz, secondHz, { durationMs = 260, gain = 0.32 } = {}) {
  return render(durationMs, (t, p) => {
    // Second note starts halfway; each gets its own envelope so the
    // transition is a clean re-articulation rather than a glide.
    const inSecond = p >= 0.5;
    const local = inSecond ? (p - 0.5) * 2 : p * 2;
    const freq = inSecond ? secondHz : firstHz;
    // A quiet octave above adds presence without raising loudness much.
    const tone = sine(t, freq) + 0.25 * sine(t, freq * 2);
    return gain * tone * envelope(local, 0.12, 0.4);
  });
}

/** A single soft note. */
function blip(freqHz, { durationMs = 120, gain = 0.3, decayRate = 9 } = {}) {
  return render(durationMs, (t, p) => gain * sine(t, freqHz) * decay(p, decayRate));
}

const RECIPES = {
  // --- calls ---------------------------------------------------------------
  // The most "important" pair, so a perfect fifth: unmistakable and warm.
  "call-join": () => twoTone(440, 659.25, { durationMs: 300, gain: 0.34 }),
  "call-leave": () => twoTone(659.25, 440, { durationMs: 300, gain: 0.34 }),

  // --- screen share --------------------------------------------------------
  // Brighter and airier than the call pair, so the two don't blur together.
  "screenshare-start": () => twoTone(587.33, 880, { durationMs: 260, gain: 0.26 }),
  "screenshare-stop": () => twoTone(880, 587.33, { durationMs: 260, gain: 0.26 }),

  // --- microphone ----------------------------------------------------------
  // Short and dry: these fire constantly, so anything with a tail would grate.
  unmute: () => blip(720, { durationMs: 110, gain: 0.28, decayRate: 14 }),
  mute: () => blip(480, { durationMs: 110, gain: 0.28, decayRate: 14 }),

  // --- deafen --------------------------------------------------------------
  // Lower and rounder than mute — deafening is the heavier action.
  undeafen: () => twoTone(392, 523.25, { durationMs: 200, gain: 0.26 }),
  deafen: () => twoTone(523.25, 392, { durationMs: 200, gain: 0.26 }),

  // --- camera --------------------------------------------------------------
  "camera-on": () => blip(880, { durationMs: 130, gain: 0.22, decayRate: 11 }),
  "camera-off": () => blip(587.33, { durationMs: 130, gain: 0.22, decayRate: 11 }),

  // --- messages ------------------------------------------------------------
  // Deliberately the quietest thing here; it fires unprompted.
  message: () =>
    render(240, (t, p) => {
      const body = sine(t, 987.77) + 0.4 * sine(t, 1318.51);
      return 0.18 * body * decay(p, 8);
    }),

  // --- ringing -------------------------------------------------------------
  // `ring.wav`, `ring_2_percent.wav` and `ring-outgoing.wav` are deliberately
  // absent: those are supplied audio files, not generated ones, and listing
  // them here would mean re-running this script silently overwrote them.
};

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [name, build] of Object.entries(RECIPES)) {
  const file = path.join(OUT_DIR, `${name}.wav`);
  fs.writeFileSync(file, toWav(build()));
  console.log("wrote", path.relative(process.cwd(), file));
}

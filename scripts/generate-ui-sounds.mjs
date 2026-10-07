/**
 * Generates the app's UI sound effects into `public/sounds/ui/`.
 *
 * Synthesized rather than shipped as recordings so the repo carries no
 * third-party audio and every clip is short, quiet and consistent in level.
 * Re-run with `bun scripts/generate-ui-sounds.mjs` after editing a recipe; the
 * generated `.wav` files are committed, so nothing runs at build or run time.
 *
 * Built from plucked, gliding "bubble" voices with a little room round them —
 * see `lib/synth.mjs` — rather than bare sine waves.
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

import {
  lowpass,
  normalize,
  note,
  pluck,
  room,
  sequence,
  softClip,
  tick,
  tone,
  trimTail,
} from "./lib/synth.mjs";
import { toWav } from "./lib/wav.mjs";

const OUT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "sounds",
  "ui"
);

/**
 * Every clip is built the same way — notes, then a small room, then levelled to
 * a stated peak — so the set is balanced by design rather than by ear, one clip
 * at a time. `peak` is the loudest sample, 0–1; the numbers below are the
 * *relationships* that matter:
 *
 *   calls (join/leave)      loudest — they are the events you must not miss
 *   deafen, screen share    a step down
 *   mute, camera, viewers   short and light: they fire all the time
 *   message                 quietest — it arrives unprompted
 *
 * Joining and leaving are the same notes rising and falling, so the pair is
 * learned as one idea; a bright, glassy colour means someone else, a rounder
 * one means you.
 */
function finish(buffer, { peak, mix = 0.16, tailMs = 240, cutoff = 7500 }) {
  const roomy = room(buffer, { mix, tailMs });
  // Two things keep these soft rather than sharp: the filter sits well below
  // where a note's upper harmonics live (the per-clip `cutoff`s are relative —
  // brighter clips still stay brighter than darker ones), run twice for a
  // steeper roll-off; and everything is taken down a little from the stated
  // peak, because a quieter sound reads as gentler as well as softer.
  const rounded = lowpass(lowpass(roomy, cutoff * SOFTNESS), cutoff * SOFTNESS * 1.6);
  return trimTail(normalize(softClip(rounded, 1.05), peak * LEVEL));
}

/** How far below each clip's own `cutoff` the filter actually sits. */
const SOFTNESS = 0.5;
/** Overall level against the peaks written below. */
const LEVEL = 0.85;

/** A bubbly pluck — the round "bloop" most of these are made from. */
const bloop = (name, opts = {}) =>
  pluck({ freq: note(name), durationMs: 260, decayMs: 80, glide: 0.06, glideMs: 30, attackMs: 9, partials: [[2, 0.16, 2.6], [3, 0.04, 4]], ...opts });

/** A glassier pluck, with a bell-like partial, for "someone else" events. */
const glass = (name, opts = {}) =>
  pluck({
    freq: note(name),
    durationMs: 320,
    decayMs: 110,
    glide: 0.03,
    glideMs: 20,
    attackMs: 9,
    partials: [
      [2, 0.2, 2.4],
      [2.76, 0.06, 4.5],
    ],
    ...opts,
  });

const RECIPES = {
  // --- calls ---------------------------------------------------------------
  // Three notes climbing a major arpeggio, each ringing into the next. The
  // last is the longest, so the phrase resolves instead of just stopping.
  "call-join": () =>
    finish(
      sequence([
        [bloop("E5", { durationMs: 200 }), 0, 0.85],
        [bloop("A5", { durationMs: 220 }), 85, 0.95],
        [glass("E6", { durationMs: 420, decayMs: 150 }), 175, 1],
      ]),
      { peak: 0.46, tailMs: 300 }
    ),
  // The same three notes walking back down, softer and without the sparkle on
  // top: leaving is an exhale.
  "call-leave": () =>
    finish(
      sequence([
        [bloop("E6", { durationMs: 200, glide: -0.05 }), 0, 0.8],
        [bloop("A5", { durationMs: 220, glide: -0.05 }), 90, 0.85],
        [bloop("E5", { durationMs: 380, decayMs: 120, glide: -0.05 }), 185, 0.9],
      ]),
      { peak: 0.4, tailMs: 280, cutoff: 5200 }
    ),

  // --- screen share --------------------------------------------------------
  // Brighter and airier than the call pair so the two never blur together: two
  // glassy notes a fifth apart.
  "screenshare-start": () =>
    finish(
      sequence([
        [glass("D5", { durationMs: 240 }), 0, 0.85],
        [glass("A5", { durationMs: 380, decayMs: 130 }), 95, 1],
      ]),
      { peak: 0.38, tailMs: 280 }
    ),
  "screenshare-stop": () =>
    finish(
      sequence([
        [glass("A5", { durationMs: 240, glide: -0.03 }), 0, 0.85],
        [glass("D5", { durationMs: 380, decayMs: 130, glide: -0.03 }), 95, 0.95],
      ]),
      { peak: 0.34, tailMs: 280, cutoff: 6200 }
    ),

  // --- stream viewers ------------------------------------------------------
  // Someone tuned into *your* stream. Two quick light plinks, so it registers
  // without pulling you out of what you are presenting, and is nothing like
  // your own share starting or stopping.
  "viewer-join": () =>
    finish(
      sequence([
        [glass("B5", { durationMs: 170, decayMs: 70 }), 0, 0.8],
        [glass("E6", { durationMs: 240, decayMs: 90 }), 70, 1],
      ]),
      { peak: 0.3, mix: 0.12, tailMs: 200 }
    ),
  "viewer-leave": () =>
    finish(
      sequence([
        [glass("E6", { durationMs: 170, decayMs: 70, glide: -0.03 }), 0, 0.75],
        [glass("B5", { durationMs: 240, decayMs: 90, glide: -0.03 }), 70, 0.85],
      ]),
      { peak: 0.26, mix: 0.12, tailMs: 200, cutoff: 5800 }
    ),

  // --- microphone ----------------------------------------------------------
  // Short and dry: these fire constantly. A bubble that opens upward to turn
  // the mic on and closes downward to turn it off, with a soft tick at the front
  // for the feeling of a switch.
  unmute: () =>
    finish(
      sequence([
        [tick({ durationMs: 10, gain: 0.25, cutoffHz: 1800, seed: 3 }), 0, 0.6],
        [bloop("G5", { durationMs: 130, decayMs: 42, glide: 0.16, glideMs: 34, partials: [[2, 0.1, 2.6]] }), 6, 1],
      ]),
      { peak: 0.32, mix: 0.06, tailMs: 90 }
    ),
  mute: () =>
    finish(
      sequence([
        [tick({ durationMs: 10, gain: 0.25, cutoffHz: 1800, seed: 5 }), 0, 0.6],
        [bloop("D5", { durationMs: 130, decayMs: 42, glide: -0.16, glideMs: 34, partials: [[2, 0.08, 2.8]] }), 6, 1],
      ]),
      { peak: 0.3, mix: 0.06, tailMs: 90, cutoff: 4600 }
    ),

  // --- deafen --------------------------------------------------------------
  // Lower and rounder than mute — deafening is the heavier action: a two-note
  // soft swell instead of a pluck, going down to deafen and up to undo it.
  undeafen: () =>
    finish(
      sequence([
        [tone({ freq: note("C5"), durationMs: 180, attackMs: 16, releaseMs: 110 }), 0, 0.8],
        [tone({ freq: note("G5"), durationMs: 260, attackMs: 16, releaseMs: 170 }), 105, 1],
      ]),
      { peak: 0.36, mix: 0.14, tailMs: 220, cutoff: 5200 }
    ),
  deafen: () =>
    finish(
      sequence([
        [tone({ freq: note("G5"), durationMs: 180, attackMs: 16, releaseMs: 110 }), 0, 0.8],
        [tone({ freq: note("C5"), durationMs: 260, attackMs: 16, releaseMs: 170 }), 105, 1],
      ]),
      { peak: 0.34, mix: 0.14, tailMs: 220, cutoff: 3800 }
    ),

  // --- camera --------------------------------------------------------------
  // A shutter-ish tick into a light pluck: up for on, down for off.
  "camera-on": () =>
    finish(
      sequence([
        [tick({ durationMs: 16, gain: 0.4, cutoffHz: 2200, seed: 11 }), 0, 0.7],
        [glass("C6", { durationMs: 230, decayMs: 75, glide: 0.06 }), 14, 1],
      ]),
      { peak: 0.3, mix: 0.1, tailMs: 160 }
    ),
  "camera-off": () =>
    finish(
      sequence([
        [tick({ durationMs: 16, gain: 0.4, cutoffHz: 1800, seed: 13 }), 0, 0.7],
        [glass("F5", { durationMs: 230, decayMs: 75, glide: -0.06 }), 14, 0.9],
      ]),
      { peak: 0.27, mix: 0.1, tailMs: 160, cutoff: 5000 }
    ),

  // --- messages ------------------------------------------------------------
  // The quietest thing here; it fires unprompted. Two quick bell-ish plinks, the
  // second a fourth above, so it is a "pop-pop" you can pick out from the rest
  // without it ever being a jolt.
  message: () =>
    finish(
      sequence([
        [glass("G5", { durationMs: 220, decayMs: 80, glide: 0.05 }), 0, 0.85],
        [glass("C6", { durationMs: 340, decayMs: 120, glide: 0.05 }), 105, 1],
      ]),
      { peak: 0.26, mix: 0.13, tailMs: 260 }
    ),

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

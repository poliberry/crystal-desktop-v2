/**
 * Generates the built-in soundboard clips into `public/sounds/`.
 *
 * They're synthesized rather than shipped as recordings so the repo carries no
 * third-party audio and every clip is guaranteed short, quiet and normalized.
 * Re-run with `bun scripts/generate-default-sounds.mjs` after editing a recipe;
 * the generated `.wav` files are committed, so the app never needs this at
 * build or run time.
 *
 * The clip list here must stay in sync with `BUILTIN_SOUNDS` in
 * `src/lib/soundboard.ts`, which is what the UI actually reads.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decay, render, saw, sine, square, toWav } from "./lib/wav.mjs";

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "sounds");

const RECIPES = {
  ping: () => render(260, (t, p) => 0.5 * sine(t, 1046) * decay(p, 7)),

  boop: () => render(200, (t, p) => 0.5 * sine(t, 480 - 220 * p) * decay(p, 5)),

  pop: () => render(110, (t, p) => 0.55 * sine(t, 720 - 380 * p) * decay(p, 16)),

  chime: () =>
    render(900, (t, p) => {
      // Three notes of a major triad, each entering a beat after the last.
      const notes = [
        [523.25, 0],
        [659.25, 0.12],
        [783.99, 0.24],
      ];
      let value = 0;
      for (const [freq, start] of notes) {
        if (p < start) continue;
        const local = (p - start) / (1 - start);
        value += sine(t, freq) * decay(local, 4);
      }
      return 0.28 * value;
    }),

  buzz: () => render(340, (t, p) => 0.28 * square(t, 118) * decay(p, 2.2)),

  zap: () =>
    render(300, (t, p) => {
      // Pitch-swept saw plus a little noise for the "electric" edge.
      const tone = saw(t, 1400 - 1150 * p);
      const noise = Math.sin(t * 99991) * 0.35;
      return 0.32 * (tone + noise) * decay(p, 7);
    }),

  horn: () =>
    render(750, (t, p) => {
      // Vibrato saw with a stacked fifth — a polite stand-in for an airhorn.
      const vibrato = 1 + 0.012 * sine(t, 6);
      const body = saw(t, 262 * vibrato) + 0.6 * saw(t, 392 * vibrato);
      const envelope = Math.min(1, p * 12) * Math.min(1, (1 - p) * 6);
      return 0.22 * body * envelope;
    }),

  drumroll: () =>
    render(800, (t, p) => {
      // Accelerating noise hits, ending on an accent.
      const hits = 18;
      const position = Math.pow(p, 0.65) * hits;
      const local = position % 1;
      const noise = Math.sin(t * 73331) + Math.sin(t * 41231);
      const accent = p > 0.94 ? 2.2 : 1;
      return 0.16 * noise * Math.exp(-9 * local) * accent;
    }),
};

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [name, build] of Object.entries(RECIPES)) {
  const file = path.join(OUT_DIR, `${name}.wav`);
  fs.writeFileSync(file, toWav(build()));
  console.log("wrote", path.relative(process.cwd(), file));
}

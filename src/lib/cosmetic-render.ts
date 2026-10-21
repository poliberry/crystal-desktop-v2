import type { MotionSpec } from "../../convex/lib/motion";

/**
 * Turning a motion design into the frames of a transparent cosmetic video.
 *
 * Shared by Studio's export (`src/studio/submit.ts`) and the collection renderer (`scripts/render-cosmetics.mjs`), so
 * a creator's export and Crystal's own remakes play by the same rules:
 *
 *  - The video is the whole design once: the intro, then one pass of the idle. A player plays it from 0 when a
 *    cosmetic first appears and, at the end, seeks back to `loopFrom` and goes round the idle for as long as it is
 *    on screen (see `src/components/motion/cosmetic-video.tsx`).
 *  - Only the very start fades in. Nothing fades out at the end of the file or dips at `loopFrom`: a dip there is a
 *    blink every time the idle comes round.
 *  - The seam is made seamless by construction. Over the last `crossfade` seconds the frame is blended towards the
 *    frame one idle earlier, so the last frame of the file *is* the frame at `loopFrom`. Particles, drifting noise and
 *    anything else that isn't exactly periodic cross over smoothly instead of jumping.
 */

export interface CosmeticTiming {
  duration: number;
  /** Where the idle starts: the time a player seeks back to at the end of the file. */
  loopFrom: number;
  /** Seconds at the end of the idle that are blended into its own beginning. */
  crossfade: number;
  /** Seconds the very first frames fade in over (on top of whatever the design does itself). */
  fadeIn: number;
}

/** The longest a cosmetic video runs, seconds. */
export const COSMETIC_MAX_SECONDS = 12;

export function cosmeticTiming(spec: Pick<MotionSpec, "duration" | "loop">): CosmeticTiming {
  const duration = Math.min(COSMETIC_MAX_SECONDS, Math.max(0.5, spec.duration));
  const from = spec.loop.mode === "loop" && typeof spec.loop.from === "number" && spec.loop.from > 0 ? spec.loop.from : 0;
  // A design with no intro of its own still gets a short one: its first moments are the fade in, played once.
  const loopFrom = Math.round(Math.min(from || Math.min(0.6, duration * 0.2), duration - 0.25) * 1000) / 1000;
  const idle = duration - loopFrom;
  // Never more of the idle than a third, and never more of the intro than it has (the blend reads one idle back).
  const crossfade = Math.round(Math.max(0, Math.min(idle / 3, loopFrom, 0.9)) * 1000) / 1000;
  return { duration, loopFrom, crossfade, fadeIn: Math.min(0.5, loopFrom) };
}

/** A canvas-like thing with a 2D context that can be drawn from. */
type Drawable = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A smooth step: 0 at 0, 1 at 1, no corners. */
const smooth = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};

/**
 * Draw the video frame at file time `t` into `out` (cleared first). `render(time)` draws the design at a time and
 * returns its canvas; it is called once, or twice in the crossfade.
 */
export function drawCosmeticFrame(out: Ctx2D, render: (time: number) => Drawable, t: number, timing: CosmeticTiming): void {
  const { duration, loopFrom, crossfade, fadeIn } = timing;
  const idle = duration - loopFrom;
  const w = out.canvas.width;
  const h = out.canvas.height;
  out.save();
  out.clearRect(0, 0, w, h);
  const start = fadeIn > 0 ? smooth(t / fadeIn) : 1;
  const blendFrom = duration - crossfade;
  if (crossfade > 0 && t > blendFrom) {
    // Premultiplied colours add, so drawing A at (1 - k) and B at k with "lighter" is exactly the linear blend of the two.
    const k = smooth((t - blendFrom) / crossfade);
    out.globalCompositeOperation = "lighter";
    out.globalAlpha = 1 - k;
    out.drawImage(render(t), 0, 0, w, h);
    out.globalAlpha = k;
    out.drawImage(render(t - idle), 0, 0, w, h);
  } else {
    out.globalAlpha = start;
    out.drawImage(render(t), 0, 0, w, h);
  }
  out.restore();
}

// --- Flash safety -------------------------------------------------------------------------------------------------------

/**
 * A check of a cosmetic's frames against photosensitivity guidance, and against a much stricter "calm" budget.
 *
 * WCAG 2.x's general flash threshold counts a *flash* as a pair of opposing changes in relative luminance of 10% or
 * more of the maximum, where the darker state is below 0.80, and fails more than three of them in any one second over
 * a sizeable area. A cosmetic is decoration over someone's profile, so the budget here is far below that: no opposing
 * pair of 10% changes inside one second anywhere, the whole picture's brightness never moving by more than a few
 * percent per second, and no saturated-red flashing at all.
 *
 * Frames are judged as they will be seen: composited over the app's dark and light backgrounds, at the opacity the app
 * draws them at (a nameplate is drawn at about 20%). Luminance is measured per tile of a coarse grid, which is about the
 * size of the smallest area the guidance cares about at a profile card's size.
 */
export interface FlashOptions {
  fps: number;
  /** How opaque the app draws it. */
  opacity: number;
  /** Tiles across and down. */
  grid?: [number, number];
}

export interface FlashReport {
  frames: number;
  /** WCAG general flashes in the worst one-second window of the worst tile, over either background. */
  wcagFlashesPerSecond: number;
  /** Opposing ≥10% luminance changes inside one second, anywhere (the calm budget allows none). */
  calmViolations: number;
  /** Largest change of a tile's luminance between two consecutive frames. */
  maxTileStep: number;
  /** Largest change of the whole picture's mean luminance within any one second. */
  maxGlobalSwingPerSecond: number;
  /** Saturated-red transitions (a red flash is judged more strictly than any other). */
  redFlashes: number;
  /** Mean absolute difference (0–255) between the last frame and the loop point's frame, before the crossfade fix-up is applied it should be ~0. */
  seamDifference?: number;
  pass: boolean;
  problems: string[];
}

const BACKGROUNDS: [number, number, number][] = [[0x11, 0x12, 0x16], [0xf7, 0xf7, 0xf8]];
const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const LIN = Array.from({ length: 256 }, (_, i) => lin(i));

export class FlashMonitor {
  private readonly gx: number;
  private readonly gy: number;
  /** Per background, per tile: luminance series. */
  private readonly series: number[][][];
  private readonly global: number[][];
  private readonly red: number[][];
  private frames = 0;

  constructor(private readonly options: FlashOptions) {
    [this.gx, this.gy] = options.grid ?? [8, 8];
    this.series = BACKGROUNDS.map(() => Array.from({ length: this.gx * this.gy }, () => []));
    this.global = BACKGROUNDS.map(() => []);
    this.red = BACKGROUNDS.flatMap(() => Array.from({ length: this.gx * this.gy }, () => []));
  }

  /** One frame of straight (not premultiplied) RGBA, as `getImageData` gives it. */
  add(data: Uint8ClampedArray | Uint8Array, width: number, height: number): void {
    const { gx, gy } = this;
    const tiles = gx * gy;
    const sums = BACKGROUNDS.map(() => new Float64Array(tiles));
    const redSum = new Float64Array(tiles * BACKGROUNDS.length);
    const counts = new Float64Array(tiles);
    const step = Math.max(1, Math.floor(Math.min(width, height) / 96));
    const o = this.options.opacity;
    for (let y = 0; y < height; y += step) {
      const ty = Math.min(gy - 1, Math.floor((y / height) * gy));
      for (let x = 0; x < width; x += step) {
        const tx = Math.min(gx - 1, Math.floor((x / width) * gx));
        const tile = ty * gx + tx;
        const i = (y * width + x) * 4;
        const a = (data[i + 3] / 255) * o;
        for (let k = 0; k < BACKGROUNDS.length; k++) {
          const bg = BACKGROUNDS[k];
          // Compositing in sRGB space, as browsers do, then measuring.
          const cr = LIN[Math.round(data[i] * a + bg[0] * (1 - a))];
          const cg = LIN[Math.round(data[i + 1] * a + bg[1] * (1 - a))];
          const cb = LIN[Math.round(data[i + 2] * a + bg[2] * (1 - a))];
          sums[k][tile] += 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
          // Saturated red, as seen: judged on the composited colour (WCAG's R / (R + G + B) >= 0.8, measured as
          // (R - G - B) x 320). Judging the source pixel and its alpha separately would count the rounding noise of
          // nearly clear pixels as red flicker.
          const total = cr + cg + cb;
          redSum[k * tiles + tile] += total > 0 && cr / total >= 0.8 ? Math.max(0, cr - cg - cb) * 320 : 0;
        }
        counts[tile]++;
      }
    }
    for (let k = 0; k < BACKGROUNDS.length; k++) {
      let all = 0;
      for (let t = 0; t < tiles; t++) {
        const v = sums[k][t] / Math.max(1, counts[t]);
        this.series[k][t].push(v);
        all += v;
      }
      this.global[k].push(all / tiles);
    }
    for (let t = 0; t < tiles * BACKGROUNDS.length; t++) this.red[t].push(redSum[t] / Math.max(1, counts[t % tiles]));
    this.frames++;
  }

  /**
   * `skipFrames`: frames of intro, in which the picture fades up from nothing. The fade itself is one long, one-way
   * change of brightness (it is what any picture appearing does), so the intro is held to a different rule from the
   * idle: its overall brightness must move one way only, while the idle must not swing by more than 6% in any second.
   * Per-tile flash counting applies to both. `loopFrom`: the frame the player seeks back to at the end, so the
   * seam is judged as it is seen, the end of the idle running straight into its beginning.
   */
  report(extra: { seamDifference?: number; skipFrames?: number; loopFrom?: number } = {}): FlashReport {
    const { fps } = this.options;
    const window = Math.max(1, Math.round(fps));
    const skip = extra.skipFrames ?? 0;
    const looped = (s: number[]) => (extra.loopFrom === undefined ? s : s.concat(s.slice(extra.loopFrom, extra.loopFrom + window)));
    let wcag = 0;
    let calm = 0;
    let maxStep = 0;
    let swing = 0;
    let redFlashes = 0;
    let introReverses = 0;
    const events: string[] = [];
    let maxStepAt = "";
    const at = (frame: number) => `${(frame / fps).toFixed(2)}s`;
    this.series.forEach((bySeries, bg) => {
      bySeries.forEach((raw, tile) => {
        const s = looped(raw);
        for (let i = 1; i < s.length; i++) {
          const step = Math.abs(s[i] - s[i - 1]);
          if (step > maxStep) {
            maxStep = step;
            maxStepAt = `tile ${tile % this.gx},${Math.floor(tile / this.gx)} on ${bg ? "light" : "dark"} at ${at(i)}`;
          }
        }
        const pairs = flashPairs(transitions(s, 0.1), window, 0.8);
        wcag = Math.max(wcag, pairs.worst);
        calm += pairs.windows;
        if (pairs.first !== undefined && events.length < 6) events.push(`tile ${tile % this.gx},${Math.floor(tile / this.gx)} on ${bg ? "light" : "dark"} at ${at(pairs.first)}`);
      });
    });
    for (const raw of this.global) {
      const g = looped(raw);
      for (let i = skip; i < g.length; i++) {
        for (let j = i + 1; j < Math.min(g.length, i + window); j++) swing = Math.max(swing, Math.abs(g[j] - g[i]));
      }
      introReverses = Math.max(introReverses, transitions(g.slice(0, skip + 1), 0.015).length - 1);
    }
    // WCAG's red flash: a change of (R - G - B) × 320 of 20 or more in saturated red, judged the same way.
    for (const raw of this.red) {
      const pairs = flashPairs(transitions(looped(raw), 20), window, Infinity);
      redFlashes += pairs.windows;
      if (pairs.first !== undefined && events.length < 6) events.push(`red at ${at(pairs.first)}`);
    }
    const problems: string[] = [];
    if (wcag > 3) problems.push(`fails WCAG general flash (${wcag} flashes in one second)`);
    if (calm > 0) problems.push(`${calm} opposing 10% luminance changes inside one second`);
    if (maxStep > 0.04) problems.push(`a tile's brightness jumps ${(maxStep * 100).toFixed(1)}% between two frames (${maxStepAt})`);
    if (swing > 0.06) problems.push(`the picture's overall brightness swings ${(swing * 100).toFixed(1)}% within one second`);
    if (introReverses > 0) problems.push("the intro's overall brightness goes up and down instead of fading one way");
    if (redFlashes > 0) problems.push(`${redFlashes} saturated-red transitions`);
    if (extra.seamDifference !== undefined && extra.seamDifference > 2) problems.push(`the loop seam differs by ${extra.seamDifference.toFixed(2)}/255`);
    if (problems.length && events.length) problems.push(`(first at: ${events.join(", ")})`);
    return {
      frames: this.frames,
      wcagFlashesPerSecond: wcag,
      calmViolations: calm,
      maxTileStep: round(maxStep),
      maxGlobalSwingPerSecond: round(swing),
      redFlashes,
      seamDifference: extra.seamDifference === undefined ? undefined : round(extra.seamDifference),
      pass: problems.length === 0,
      problems,
    };
  }
}

const round = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Flashes among turning points: a flash is a pair of opposing transitions. `worst` is the most whole flashes inside any
 * one window; `windows` is how many transitions begin a window holding at least one opposing pair.
 */
function flashPairs(turns: { at: number; dir: 1 | -1; low: number }[], window: number, darkBelow: number): { worst: number; windows: number; first?: number } {
  let worst = 0;
  let windows = 0;
  let first: number | undefined;
  for (let i = 0; i < turns.length; i++) {
    let pairs = 0;
    for (let j = i + 1; j < turns.length && turns[j].at - turns[i].at <= window; j++) {
      if (turns[j].dir !== turns[j - 1].dir && Math.min(turns[j].low, turns[j - 1].low) < darkBelow) pairs++;
    }
    worst = Math.max(worst, Math.floor((pairs + 1) / 2));
    if (pairs > 0) {
      windows++;
      first ??= turns[i].at;
    }
  }
  return { worst, windows, first };
}

/** Turning points of a series that moved by at least `threshold` from the last one, with the darker of the two levels. */
function transitions(s: number[], threshold: number): { at: number; dir: 1 | -1; low: number }[] {
  const out: { at: number; dir: 1 | -1; low: number }[] = [];
  if (!s.length) return out;
  let anchor = s[0];
  let anchorAt = 0;
  let extreme = s[0];
  let dir: 0 | 1 | -1 = 0;
  for (let i = 1; i < s.length; i++) {
    const v = s[i];
    if (dir === 0) {
      if (Math.abs(v - anchor) >= threshold) {
        dir = v > anchor ? 1 : -1;
        extreme = v;
        out.push({ at: i, dir, low: Math.min(anchor, v) });
      }
      continue;
    }
    if ((dir === 1 && v > extreme) || (dir === -1 && v < extreme)) {
      extreme = v;
      continue;
    }
    if (Math.abs(v - extreme) >= threshold) {
      dir = dir === 1 ? -1 : 1;
      out.push({ at: i, dir, low: Math.min(extreme, v) });
      anchor = extreme;
      anchorAt = i;
      extreme = v;
    }
  }
  void anchorAt;
  return out;
}

/** Mean absolute difference of two equally sized RGBA frames, premultiplied, 0–255. */
export function frameDifference(a: Uint8ClampedArray | Uint8Array, b: Uint8ClampedArray | Uint8Array): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 16) {
    const aa = a[i + 3] / 255;
    const ba = b[i + 3] / 255;
    sum += Math.abs(a[i] * aa - b[i] * ba) + Math.abs(a[i + 1] * aa - b[i + 1] * ba) + Math.abs(a[i + 2] * aa - b[i + 2] * ba) + Math.abs(a[i + 3] - b[i + 3]);
    n += 4;
  }
  return n ? sum / n : 0;
}

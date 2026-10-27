/**
 * The page side of `scripts/render-cosmetics.mjs`: runs in a hidden Electron window (Chromium's canvas, the one the app
 * draws with), draws each remade design (scripts/cosmetics/designs-*.ts) frame by frame, checks every frame against the
 * calm-motion budget, and pipes the frames straight into two ffmpeg encoders as raw RGBA:
 *
 *  - VP9 with alpha in WebM, which Chromium (the desktop app, Chrome, Edge) and Firefox play with transparency;
 *  - HEVC with alpha in MP4 (VideoToolbox), which is what Safari and every iOS browser need for transparency;
 *  - for an effect or decoration, "stacked alpha" H.264 in MP4: twice the height, the colour premultiplied by alpha on
 *    top and the alpha as grey below. Android's decoders drop VP9's alpha; the mobile app plays this one and puts the
 *    halves back together in a shader (crystal-mobile src/lib/cosmetics/StackedAlphaVideo.tsx).
 *
 * Node is available here: the window is a local tool, never the app.
 */
import { FlashMonitor, frameDifference, type FlashReport } from "../../src/lib/cosmetic-render";
import { STAGES, smooth, timeAt, type Design } from "./kit";
import { NAMEPLATES } from "./designs-nameplates";
import { EFFECTS } from "./designs-effects";
import { DECORATIONS } from "./designs-decorations";

// Node's own `require`, reached through `window` so the bundler leaves it alone.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodeRequire = (window as unknown as { require: (id: string) => any }).require;
const fs = nodeRequire("node:fs");
const path = nodeRequire("node:path");
const { spawn } = nodeRequire("node:child_process");
const { ipcRenderer } = nodeRequire("electron");
// The window has Node, but this file is bundled for the browser, so Node's globals are declared rather than imported.
declare const Buffer: { from(buffer: ArrayBufferLike, offset: number, length: number): Uint8Array };

const ALL: Design[] = [...NAMEPLATES, ...EFFECTS, ...DECORATIONS];

interface Job {
  out: string;
  fps: number;
  crf: number;
  only?: string[];
  ffmpeg: string;
  hevc: boolean;
}

export interface RenderedItem {
  slug: string;
  name: string;
  kind: Design["kind"];
  description: string;
  refract?: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  loopFrom: number;
  video: string;
  hevc?: string;
  poster: string;
  sheet: string;
  bytes: number;
  hevcBytes?: number;
  stacked?: string;
  stackedBytes?: number;
  flash: FlashReport;
}

async function pngOf(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

function encoder(job: Job, args: string[]) {
  const child = spawn(job.ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  child.stderr.on("data", (d: Uint8Array) => (err += String(d)));
  const done = new Promise<void>((resolve, reject) => child.on("close", (code: number) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err}`)))));
  const write = (bytes: Uint8ClampedArray) =>
    new Promise<void>((resolve, reject) => {
      const ok = child.stdin.write(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), (e: Error | null) => (e ? reject(e) : undefined));
      if (ok) resolve();
      else child.stdin.once("drain", () => resolve());
    });
  return { write, end: () => (child.stdin.end(), done) };
}

const input = (job: Job, w: number, h: number) => ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${w}x${h}`, "-r", String(job.fps), "-i", "-", "-an"];

function vp9(job: Job, file: string, w: number, h: number, loopFrom: number, crf: number) {
  return encoder(job, [
    ...input(job, w, h),
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
    "-b:v", "0", "-crf", String(crf), "-deadline", "good", "-cpu-used", "1", "-row-mt", "1",
    "-auto-alt-ref", "0", "-lag-in-frames", "0", "-g", String(job.fps * 2),
    // A keyframe exactly where the idle begins, so seeking back to it is instant and exact.
    "-force_key_frames", `0,${loopFrom}`,
    "-metadata:s:v:0", "alpha_mode=1",
    file,
  ]);
}

function hevc(job: Job, file: string, w: number, h: number, loopFrom: number, quality: number) {
  return encoder(job, [
    ...input(job, w, h),
    "-c:v", "hevc_videotoolbox", "-pix_fmt", "bgra", "-alpha_quality", "0.8", "-q:v", String(quality),
    "-g", String(job.fps * 2), "-force_key_frames", `0,${loopFrom}`,
    "-tag:v", "hvc1", "-movflags", "+faststart",
    file,
  ]);
}

/** Stacked-alpha H.264 (see the top of this file). Its input is the stacked frame, `w × 2h`, built by `stack`. */
function stackedH264(job: Job, file: string, w: number, h: number, loopFrom: number) {
  return encoder(job, [
    "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${w}x${h * 2}`, "-r", String(job.fps), "-i", "-", "-an",
    "-vf", "format=yuv420p",
    "-c:v", "libx264", "-profile:v", "high", "-level", "4.1", "-preset", "slow", "-crf", "16",
    "-g", String(job.fps * 2), "-force_key_frames", `0,${loopFrom}`,
    "-tag:v", "avc1", "-movflags", "+faststart",
    file,
  ]);
}

/** One RGBA frame as a stacked-alpha frame: colour × alpha over the top half, alpha as grey over the bottom. */
function stack(data: Uint8ClampedArray, out: Uint8ClampedArray): Uint8ClampedArray {
  const half = data.length;
  for (let i = 0; i < half; i += 4) {
    const a = data[i + 3];
    out[i] = (data[i] * a + 127) / 255;
    out[i + 1] = (data[i + 1] * a + 127) / 255;
    out[i + 2] = (data[i + 2] * a + 127) / 255;
    out[i + 3] = 255;
    out[half + i] = out[half + i + 1] = out[half + i + 2] = a;
    out[half + i + 3] = 255;
  }
  return out;
}

/** A strip of frames over a dark and a light card, for looking at. */
function contactSheet(d: Design, frames: HTMLCanvasElement[], opacity: number): HTMLCanvasElement {
  const { w, h } = STAGES[d.kind];
  const cw = d.kind === "nameplate" ? 480 : d.kind === "effect" ? 200 : 160;
  const ch = Math.round((cw * h) / w);
  const pad = 8;
  const rows: [string, number][] = d.kind === "nameplate" ? [["#111216", 1], ["#111216", opacity], ["#f7f7f8", opacity]] : [["#111216", 1], ["#f7f7f8", 1]];
  const sheet = document.createElement("canvas");
  sheet.width = frames.length * (cw + pad) + pad;
  sheet.height = rows.length * (ch + pad) + pad;
  const ctx = sheet.getContext("2d")!;
  ctx.fillStyle = "#2a2b30";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  rows.forEach(([bg, a], row) => {
    frames.forEach((f, i) => {
      const x = pad + i * (cw + pad);
      const y = pad + row * (ch + pad);
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, cw, ch);
      if (d.kind === "decoration") {
        // Where the avatar sits, so the frame reads as a frame.
        const s = cw / 100;
        ctx.fillStyle = bg === "#111216" ? "#3a3f4b" : "#c9ccd3";
        ctx.beginPath();
        ctx.roundRect(x + 12 * s, y + 12 * s, 76 * s, 76 * s, 15.2 * s);
        ctx.fill();
      }
      ctx.globalAlpha = a;
      ctx.drawImage(f, x, y, cw, ch);
      ctx.globalAlpha = 1;
    });
  });
  return sheet;
}

async function renderOne(job: Job, d: Design): Promise<RenderedItem> {
  const { w, h } = STAGES[d.kind];
  const duration = d.intro + d.idle;
  const loopFrom = d.intro;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  // Each frame is drawn whole, offscreen, and the intro's fade is applied to the finished picture. Fading its layers one
  // by one instead would not be a fade: over a light card the overlapping layers darken and brighten in turn.
  const scratch = document.createElement("canvas");
  scratch.width = w;
  scratch.height = h;
  const sctx = scratch.getContext("2d")!;
  const fadeIn = Math.min(d.fadeIn ?? Math.min(d.intro * 0.9, 1.45), d.intro);
  const draw = (t: number) => {
    sctx.save();
    sctx.clearRect(0, 0, w, h);
    if (d.kind === "decoration") sctx.scale(w / 100, h / 100);
    d.draw(sctx, timeAt(t, d.intro, d.idle));
    sctx.restore();
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = t >= d.intro ? 1 : smooth(t / fadeIn);
    ctx.drawImage(scratch, 0, 0);
    ctx.globalAlpha = 1;
    return ctx.getImageData(0, 0, w, h).data;
  };
  const frames = Math.round(duration * job.fps);
  const base = path.join(job.out, d.slug);
  // A card-sized effect is mostly soft light: a few steps more compression costs nothing you can see, and halves the file.
  const encoders = [vp9(job, `${base}.webm`, w, h, loopFrom, d.kind === "nameplate" ? job.crf : job.crf + 5), ...(job.hevc ? [hevc(job, `${base}.mp4`, w, h, loopFrom, d.kind === "nameplate" ? 62 : 55)] : [])];
  // A nameplate is opaque: Android plays its WebM as it is.
  const stacked = d.kind === "nameplate" ? undefined : stackedH264(job, `${base}.stacked.mp4`, w, h, loopFrom);
  const stackedFrame = new Uint8ClampedArray(w * h * 8);
  // How the app draws it: a nameplate at 20%, the rest at full strength. A nameplate is also judged at full strength
  // against WCAG's limits, since a creator may preview it at 100%.
  const opacity = d.kind === "nameplate" ? 0.2 : 1;
  const seen = new FlashMonitor({ fps: job.fps, opacity });
  const full = d.kind === "nameplate" ? new FlashMonitor({ fps: job.fps, opacity: 1 }) : undefined;
  const picks = [0.2, 0.5, 0.8].map((x) => Math.round(x * loopFrom * job.fps)).concat([0, 0.2, 0.4, 0.6, 0.8].map((x) => Math.round((loopFrom + x * d.idle) * job.fps)));
  const sheetFrames: HTMLCanvasElement[] = [];
  let last: Uint8ClampedArray | undefined;
  for (let f = 0; f < frames; f++) {
    const data = draw(f / job.fps);
    seen.add(data, w, h);
    full?.add(data, w, h);
    await Promise.all([...encoders.map((e) => e.write(data)), ...(stacked ? [stacked.write(stack(data, stackedFrame))] : [])]);
    if (picks.includes(f)) {
      const copy = document.createElement("canvas");
      copy.width = w;
      copy.height = h;
      copy.getContext("2d")!.drawImage(canvas, 0, 0);
      sheetFrames.push(copy);
    }
    if (f === frames - 1) last = new Uint8ClampedArray(data);
    if (f % 30 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  await Promise.all([...encoders.map((e) => e.end()), ...(stacked ? [stacked.end()] : [])]);
  // The seam: after the last frame the player shows the frame at `loopFrom`, so the last frame must be the one just
  // before it, i.e. the idle's own last frame.
  const before = draw(loopFrom + d.idle - 1 / job.fps);
  const seamDifference = last ? frameDifference(last, before) : undefined;
  const wrap = frameDifference(draw(loopFrom), draw(loopFrom + d.idle));
  const introFrames = Math.round(loopFrom * job.fps);
  const flash = seen.report({ seamDifference: Math.max(seamDifference ?? 0, wrap), skipFrames: introFrames, loopFrom: introFrames });
  if (full) {
    const strong = full.report({ skipFrames: introFrames, loopFrom: introFrames });
    if (strong.wcagFlashesPerSecond > 0 || strong.redFlashes > 0) flash.problems.push(`at full opacity: ${strong.problems.join("; ") || "flashes"}`);
    if (flash.problems.length) flash.pass = false;
  }
  // The poster: a moment in the idle, fully formed. It is what shows in lists, with reduced motion and before playback.
  draw(loopFrom + d.idle * 0.1);
  fs.writeFileSync(`${base}.png`, await pngOf(canvas));
  fs.writeFileSync(`${base}.sheet.png`, await pngOf(contactSheet(d, sheetFrames, opacity)));
  return {
    slug: d.slug,
    name: d.name,
    kind: d.kind,
    description: d.description,
    ...(d.refract ? { refract: d.refract } : {}),
    width: w,
    height: h,
    fps: job.fps,
    duration,
    loopFrom,
    video: `${d.slug}.webm`,
    ...(job.hevc ? { hevc: `${d.slug}.mp4`, hevcBytes: fs.statSync(`${base}.mp4`).size } : {}),
    ...(stacked ? { stacked: `${d.slug}.stacked.mp4`, stackedBytes: fs.statSync(`${base}.stacked.mp4`).size } : {}),
    poster: `${d.slug}.png`,
    sheet: `${d.slug}.sheet.png`,
    bytes: fs.statSync(`${base}.webm`).size,
    flash,
  };
}

async function main() {
  const job = JSON.parse(decodeURIComponent(location.hash.slice(1))) as Job;
  fs.mkdirSync(job.out, { recursive: true });
  const slugs = new Set<string>();
  for (const d of ALL) {
    if (slugs.has(d.slug)) throw new Error(`two designs are called ${d.slug}`);
    slugs.add(d.slug);
  }
  const unknown = job.only?.filter((s) => !slugs.has(s)) ?? [];
  if (unknown.length) throw new Error(`unknown design: ${unknown.join(", ")}`);
  const chosen = ALL.filter((d) => !job.only?.length || job.only.includes(d.slug));
  const items: RenderedItem[] = [];
  for (const d of chosen) {
    const started = performance.now();
    const item = await renderOne(job, d);
    items.push(item);
    ipcRenderer.send("log", `${d.slug}: ${(item.bytes / 1024).toFixed(0)} KB${item.hevcBytes ? ` (+${(item.hevcBytes / 1024).toFixed(0)} KB HEVC)` : ""}, ${((performance.now() - started) / 1000).toFixed(1)}s, ${item.flash.pass ? "calm" : `PROBLEMS: ${item.flash.problems.join("; ")}`} [step ${(item.flash.maxTileStep * 100).toFixed(2)}%, swing ${(item.flash.maxGlobalSwingPerSecond * 100).toFixed(2)}%/s, seam ${item.flash.seamDifference}]`);
  }
  ipcRenderer.send("done", JSON.stringify(items));
}

main().catch((e) => ipcRenderer.send("fail", String(e?.stack ?? e)));

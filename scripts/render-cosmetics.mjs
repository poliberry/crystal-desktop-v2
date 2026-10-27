#!/usr/bin/env bun
/**
 * Renders Crystal's remade animated cosmetics (scripts/cosmetics/designs-*.ts): nameplates, profile effects and avatar
 * decorations, each to
 *
 *   <slug>.webm        VP9 with alpha (Chromium, Firefox)
 *   <slug>.mp4         HEVC with alpha (Safari, iOS), unless --no-hevc
 *   <slug>.stacked.mp4 H.264, colour over alpha (Android), for effects and decorations (a nameplate is opaque)
 *   <slug>.png         a transparent poster: a still from the idle, for lists, reduced motion and before playback
 *   <slug>.sheet.png   a contact sheet over a dark and a light card, for review
 *
 * with `manifest.json` (timings, sizes and the photosensitivity report of every design) and `index.html`, a page that
 * plays each one intro-then-idle over a dark and a light card, as the app does.
 *
 *   bun scripts/render-cosmetics.mjs                      every design
 *   bun scripts/render-cosmetics.mjs --only a,b           just these slugs
 *   bun scripts/render-cosmetics.mjs --fps 30 --crf 22    encoder settings (defaults shown)
 *
 * Output goes to public/cosmetic-remakes/<version>/ (gitignored). A design that fails the calm-motion check is still
 * written, so it can be looked at, but is marked `pass: false`, and scripts/publish-cosmetic-remakes.mjs refuses it.
 * The renderer is Chromium's canvas (Electron, from node_modules); the encoders are the system ffmpeg, which needs
 * libvpx-vp9 and, for the HEVC files, hevc_videotoolbox (macOS).
 */
import { spawnSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { checkStacked } from "./cosmetics/stacked.mjs";

export const REMAKE_VERSION = "v2";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const fps = Number(arg("fps", "30"));
const crf = Number(arg("crf", "22"));
const only = arg("only", "")?.split(",").filter(Boolean);
const out = resolve(root, arg("out", `public/cosmetic-remakes/${REMAKE_VERSION}`));
const ffmpeg = arg("ffmpeg", "ffmpeg");
const encoders = spawnSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout ?? "";
const hevc = !args.includes("--no-hevc");

if (!encoders.includes("libvpx-vp9")) {
  console.error("ffmpeg with libvpx-vp9 is needed (brew install ffmpeg).");
  process.exit(1);
}
if (!encoders.includes("libx264")) {
  console.error("ffmpeg with libx264 is needed for the Android (stacked alpha) files.");
  process.exit(1);
}
if (hevc && !encoders.includes("hevc_videotoolbox")) {
  console.error("HEVC with alpha needs ffmpeg's hevc_videotoolbox (macOS). Pass --no-hevc to skip the Safari files.");
  process.exit(1);
}

const work = join(root, "node_modules/.cache/render-cosmetics");
mkdirSync(work, { recursive: true });
mkdirSync(out, { recursive: true });
await build({
  entryPoints: [join(root, "scripts/cosmetics/render-entry.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  outfile: join(work, "render.js"),
  alias: { "@": join(root, "src") },
  logLevel: "warning",
});
writeFileSync(join(work, "render.html"), `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><script src="render.js"></script></body>`);

const require = createRequire(import.meta.url);
const electron = require("electron");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const job = encodeURIComponent(JSON.stringify({ out, fps, crf, only, ffmpeg, hevc }));
const child = spawn(electron, [join(root, "scripts/cosmetics/electron-main.cjs"), join(work, "render.html"), job], { env, stdio: ["ignore", "pipe", "inherit"] });
let stdout = "";
child.stdout.on("data", (d) => {
  const text = String(d);
  stdout += text;
  for (const line of text.split("\n")) if (line && !line.startsWith("@@RESULT@@")) console.log(line);
});
const code = await new Promise((r) => child.on("close", r));
const marker = stdout.lastIndexOf("@@RESULT@@");
if (code !== 0 || marker < 0) {
  console.error(`The renderer failed (exit ${code}).`);
  process.exit(1);
}
const rendered = JSON.parse(stdout.slice(marker + 10).split("\n")[0]);

const probe = (file) => {
  const res = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,codec_tag_string,width,height,pix_fmt:stream_tags=alpha_mode:format=duration", "-of", "json", file], { encoding: "utf8" });
  const info = JSON.parse(res.stdout || "{}");
  return { stream: info.streams?.[0] ?? {}, duration: Number(info.format?.duration) };
};
/** The share of nearly clear pixels in one decoded idle frame. */
const clearShare = (file, decoder, at) => {
  const frame = spawnSync(ffmpeg, ["-v", "error", ...(decoder ? ["-c:v", decoder] : []), "-ss", String(at), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 64 * 1024 * 1024 });
  let clear = 0;
  for (let i = 3; i < frame.stdout.length; i += 4) if (frame.stdout[i] < 8) clear++;
  return Math.round((clear / Math.max(1, frame.stdout.length / 4)) * 1000) / 1000;
};

// Check what ffmpeg wrote: the right codec, with an alpha channel, the expected size and length, and real transparency.
for (const item of rendered) {
  const problems = item.flash.problems;
  const webm = probe(join(out, item.video));
  const alpha = webm.stream.tags?.alpha_mode ?? webm.stream.tags?.ALPHA_MODE;
  if (!(webm.stream.codec_name === "vp9" && alpha === "1" && webm.stream.width === item.width && webm.stream.height === item.height && Math.abs(webm.duration - item.duration) < 0.2)) problems.push("the WebM is not VP9 with alpha at the expected size and length");
  item.transparentShare = clearShare(join(out, item.video), "libvpx-vp9", item.loopFrom + 0.5);
  if (item.kind !== "nameplate" && item.transparentShare < 0.2) problems.push(`the decoded WebM is only ${(item.transparentShare * 100).toFixed(0)}% transparent`);
  if (item.kind === "nameplate" && item.transparentShare > 0.01) problems.push("a nameplate should be opaque once it has faded in");
  if (item.hevc) {
    const mp4 = probe(join(out, item.hevc));
    if (!(mp4.stream.codec_name === "hevc" && mp4.stream.codec_tag_string === "hvc1" && mp4.stream.width === item.width && mp4.stream.height === item.height && Math.abs(mp4.duration - item.duration) < 0.2)) problems.push("the MP4 is not hvc1 HEVC at the expected size and length");
    const hevcClear = clearShare(join(out, item.hevc), undefined, item.loopFrom + 0.5);
    if (item.kind !== "nameplate" && Math.abs(hevcClear - item.transparentShare) > 0.1) problems.push(`the HEVC file's transparency (${(hevcClear * 100).toFixed(0)}%) does not match the WebM's`);
    item.hevcTransparentShare = hevcClear;
  }
  if (item.kind !== "nameplate") {
    if (!item.stacked) problems.push("there is no stacked-alpha MP4 for Android");
    else problems.push(...checkStacked(ffmpeg, join(out, item.video), join(out, item.stacked), item));
  }
  item.flash.pass = problems.length === 0;
}

const previous = existsSync(join(out, "manifest.json")) ? JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) : { items: [] };
const bySlug = new Map(previous.items.map((i) => [i.slug, i]));
// A re-render replaces the old entry, review included: what was looked at is no longer what is there.
for (const item of rendered) bySlug.set(item.slug, item);
const items = [...bySlug.values()];
const manifest = { version: REMAKE_VERSION, renderedAt: new Date().toISOString(), fps, crf, items };
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));

// A review page: every cosmetic over a dark and a light card, playing intro-then-idle as the app does.
const card = (item, bg) => {
  const w = item.kind === "nameplate" ? 360 : item.kind === "effect" ? 180 : 150;
  const h = Math.round((w * item.height) / item.width);
  const avatar = item.kind === "decoration" ? `<div style="position:absolute;left:12%;top:12%;width:76%;height:76%;border-radius:20%;background:${bg === "#111216" ? "#3a3f4b" : "#c9ccd3"}"></div>` : "";
  return `<div style="background:${bg};width:${w}px;height:${h}px;border-radius:12px;overflow:hidden;position:relative">${avatar}<video src="${item.video}" poster="${item.poster}" data-loop="${item.loopFrom}" muted autoplay playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:${item.kind === "nameplate" ? 0.2 : 1}"></video></div>`;
};
const html = `<!doctype html><meta charset="utf-8"><title>Cosmetic remakes ${REMAKE_VERSION}</title>
<style>body{font:13px system-ui;background:#1b1c20;color:#ddd;margin:24px}section{display:flex;gap:16px;align-items:center;margin:0 0 18px;flex-wrap:wrap}h2{font-size:14px;margin:0;width:220px}.bad{color:#f87171}.ok{color:#86efac}</style>
<h1>Cosmetic remakes ${REMAKE_VERSION}</h1>
${items.map((i) => `<section><h2>${i.name}<br><small>${i.slug} · ${(i.bytes / 1024).toFixed(0)} KB · <span class="${i.flash.pass ? "ok" : "bad"}">${i.flash.pass ? "calm" : i.flash.problems.join("; ")}</span></small></h2>${card(i, "#111216")}${card(i, "#f7f7f8")}</section>`).join("\n")}
<script>for (const v of document.querySelectorAll("video")) v.addEventListener("ended", () => { v.currentTime = Number(v.dataset.loop); v.play(); });</script>`;
writeFileSync(join(out, "index.html"), html);

const failed = rendered.filter((i) => !i.flash.pass);
console.log(`\n${rendered.length} rendered to ${out}; ${failed.length ? `${failed.length} with problems: ${failed.map((i) => i.slug).join(", ")}` : "all calm"}.`);
process.exit(failed.length ? 2 : 0);

import type { ConvexReactClient } from "convex/react";

import { api } from "../../convex/_generated/api";
import { CREATION_MAX_BYTES, uploadCreation } from "@/lib/creation-upload";
import { compileLayers, compileScene, checkArtwork, checkCosmetic, checkScene, sceneArtwork, type Problem } from "@/studio/model/compile";
import { nodesInOrder } from "@/studio/model/doc";
import { bakeEffects, posterFromVideo, rasterizeArtwork, rasterizeCosmetic, rasterizeThemePack } from "@/studio/model/rasterize";
import { checkMotionProject, compilePublished, layersUsed, motionIsStatic } from "@/studio/model/motion-doc";
import { MotionRenderer, loadMotionImages } from "@/lib/motion-render";
import { canvasToPng, renderFx, bakeScale } from "@/studio/model/fx-render";
import { fxBox } from "@/studio/model/fx";
import { motionImageUrls, type MotionSpec } from "../../convex/lib/motion";
import { withCosmeticPoster } from "@/lib/cosmetic-video";

import { checkThemePack, shippedFontFaces, themePackSpecInput } from "@/studio/model/theme-pack";
import type { AssetMeta, ImageNode, Project } from "@/studio/model/types";
import { getAssetBlob, getProject, listAssets } from "@/studio/storage/db";

/**
 * Sending a project to the Marketplace.
 *
 * Everything that has to exist before the server will accept it is made here:
 * every file the project uses is put on the CDN (once each, by content), a store
 * picture is drawn where the design has none of its own, and the design is
 * compiled to the same plain data the server rebuilds and re-checks. What leaves
 * the device is that data and those addresses — never the project document.
 */

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", webm: "video/webm", mp4: "video/mp4",
  woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf",
  wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", m4a: "audio/mp4", svg: "image/svg+xml",
};
const extOf = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();

/** A file with the type the CDN expects for its extension — browsers leave fonts' blank. */
function asUpload(blob: Blob, name: string): File {
  const type = MIME[extOf(name)] ?? blob.type;
  return new File([blob], name, { type });
}

export type Progress = (message: string) => void;

interface Ctx {
  convex: ConvexReactClient;
  progress: Progress;
  /** assetId → address, so a file used twice is sent once. */
  uploaded: Map<string, string>;
}

async function uploadAsset(c: Ctx, meta: AssetMeta): Promise<string> {
  const known = c.uploaded.get(meta.id);
  if (known) return known;
  const blob = await getAssetBlob(meta.id);
  if (!blob) throw new Error(`“${meta.name}” is missing from this project.`);
  c.progress(`Uploading ${meta.name}…`);
  const url = await uploadCreation(c.convex, asUpload(blob, meta.name));
  c.uploaded.set(meta.id, url);
  return url;
}

async function uploadBlob(c: Ctx, blob: Blob, name: string): Promise<string> {
  return uploadCreation(c.convex, asUpload(blob, name));
}

type Item = Record<string, unknown>;

/**
 * A nameplate or profile effect made in the canvas and timeline editors.
 *
 * One that never changes is sent as a plain picture, exactly as before: nothing for anyone to play. One that moves is
 * published as a motion design — every layer rendered to a picture, uploaded, and the timeline checked, written and
 * named by its hash by the server (see convex/motion.ts) — and the grant carries the address that comes back.
 */
async function motionItems(c: Ctx, project: Project, assets: Map<string, AssetMeta>): Promise<{ items: Item[]; preview?: string }> {
  const doc = project.doc!;
  const spec = project.motion!;
  const kind = project.kind === "nameplate" ? "nameplate" : "profileEffect";
  const blobOf = (id: string) => getAssetBlob(id);

  if (motionIsStatic(spec)) {
    c.progress("Rendering the picture…");
    const url = await uploadBlob(c, await rasterizeArtwork(doc, blobOf), `${project.name}.png`);
    return { items: [{ kind, artworkUrl: url }], preview: url };
  }

  // Every layer on the timeline, drawn by the canvas editor's own renderer, as a picture.
  for (const n of nodesInOrder(doc)) if (n.type === "image" && !n.hidden) await uploadAsset(c, assets.get((n as ImageNode).assetId)!);
  const images = new Map<string, HTMLImageElement>();
  for (const n of nodesInOrder(doc)) {
    if (n.type !== "image" || images.has(n.assetId)) continue;
    const blob = await blobOf(n.assetId);
    if (blob) images.set(n.assetId, await loadMotionImage(URL.createObjectURL(blob)));
  }
  const pictures = new Map<string, string>();
  let drawn = 0;
  for (const id of layersUsed(spec)) {
    const node = doc.nodes[id];
    if (!node || node.hidden) continue;
    c.progress(`Rendering layer ${++drawn}…`);
    const { canvas } = renderFx(node, images, bakeScale(fxBox(node)));
    pictures.set(id, await uploadBlob(c, await canvasToPng(canvas), `${project.name}-layer-${id}.png`));
  }
  // Pictures imported straight onto the timeline are project files, uploaded once each.
  const studioToUrl = new Map<string, string>();
  for (const url of motionImageUrls(spec)) {
    const m = /^studio:asset\/([\w-]+)$/.exec(url);
    const meta = m && assets.get(m[1]);
    if (!meta) throw new Error("A picture on the timeline is missing from this project.");
    studioToUrl.set(url, await uploadAsset(c, meta));
  }
  const mapped = mapImageUrls(spec, (u) => studioToUrl.get(u) ?? u);
  const final = compilePublished(mapped, project.name, (id) => pictures.get(id), (u) => u);

  c.progress("Publishing the animation…");
  const published = (await c.convex.action(api.motion.publish, { spec: final })) as { url: string; spec: MotionSpec };

  // The store picture: a frame from the middle of it, as it looks worn.
  c.progress("Making the store picture…");
  const preview = await uploadBlob(c, await frameOf(published.spec, project), `${project.name}.png`);
  const poster = await uploadBlob(c, await transparentFrameOf(published.spec), `${project.name}-poster.png`);
  c.progress("Encoding the transparent video…");
  const publishedImages = await loadMotionImages(motionImageUrls(published.spec));
  const webm = await recordTransparentWebm(published.spec, publishedImages);
  const videoUrl = await uploadBlob(c, webm, `${project.name}.webm`);
  const loopFrom = introIdleSpec(published.spec).loop.from;
  // Android's decoders drop VP9 alpha, so a transparent cosmetic also needs the stacked-alpha H.264 copy the mobile
  // app plays there (see src/lib/cosmetic-video.ts). A nameplate is opaque: its WebM plays as it is.
  let stackedUrl: string | undefined;
  if (kind !== "nameplate") {
    try {
      c.progress("Encoding the Android video…");
      const stacked = await recordStackedMp4(published.spec, publishedImages);
      stackedUrl = await uploadBlob(c, stacked, `${project.name}.stacked.mp4`);
    } catch (error) {
      // The WebM above is the cosmetic; without this copy Android shows its poster. Don't block the submission.
      console.warn("Stacked-alpha encode failed:", error);
    }
  }
  return { items: [{ kind, artworkUrl: withCosmeticPoster(videoUrl, poster, loopFrom, undefined, stackedUrl) }], preview };
}

/** Promote an existing timeline's opening into a one-time intro, then loop its remainder as the idle. */
export function introIdleSpec(spec: MotionSpec): MotionSpec {
  const loopFrom = Math.round(Math.min(1.2, Math.max(0.05, spec.duration - 0.25)) * 1000) / 1000;
  return { ...spec, loop: { mode: "loop", rest: 0, from: loopFrom } };
}

export async function transparentFrameOf(spec: MotionSpec): Promise<Blob> {
  const images = await loadMotionImages(motionImageUrls(spec));
  const frame = new MotionRenderer(spec, images, 1).render(spec.duration * 0.45);
  return new Promise((resolve, reject) => frame.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Couldn't make the transparent video poster.")), "image/png"));
}

/** Record the same renderer Studio previews as a looping VP9 WebM with alpha. */
export async function recordTransparentWebm(spec: MotionSpec, images: Awaited<ReturnType<typeof loadMotionImages>>): Promise<Blob> {
  const fps = 24;
  const animated = introIdleSpec(spec);
  const duration = Math.min(12, Math.max(0.5, animated.duration));
  const loopFrom = animated.loop.from ?? 0;
  const stage = animated.stage;
  const renderer = new MotionRenderer(animated, images, 1);
  const canvas = document.createElement("canvas");
  canvas.width = stage.w;
  canvas.height = stage.h;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("Couldn't start the video renderer.");
  const browserRecording = await recordWithBrowserVp9({ canvas, ctx, renderer, duration, loopFrom, fps, frames: Math.ceil(duration * fps) });
  if (browserRecording) return browserRecording;
  const ffmpeg = await transparentVideoEncoder();
  const frames = Math.ceil(duration * fps);
  try {
    for (let frame = 0; frame < frames; frame++) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const time = Math.min(duration, frame / fps);
      const fade = 0.2;
      let opacity = Math.min(1, time / fade, (duration - time) / fade);
      if (time >= loopFrom - fade && time < loopFrom) opacity = Math.min(opacity, (loopFrom - time) / fade);
      if (time >= loopFrom && time < loopFrom + fade) opacity = Math.min(opacity, (time - loopFrom) / fade);
      ctx.globalAlpha = Math.max(0, opacity);
      ctx.drawImage(renderer.render(time), 0, 0);
      ctx.globalAlpha = 1;
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Couldn't render a video frame.")), "image/png"));
      await ffmpeg.writeFile(`frame-${String(frame).padStart(5, "0")}.png`, new Uint8Array(await png.arrayBuffer()));
    }
    const encode = async (crf: number) => ffmpeg.exec([
      "-framerate", String(fps), "-i", "frame-%05d.png", "-an", "-c:v", "libvpx-vp9",
      "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", String(crf), "-deadline", "good", "-cpu-used", "2",
      "-auto-alt-ref", "0", "-metadata:s:v:0", "alpha_mode=1", "-y", "out.webm",
    ]);
    if (await encode(18) !== 0) throw new Error("The transparent video encoder failed. Try exporting again.");
    let output = await ffmpeg.readFile("out.webm");
    if (typeof output === "string" || !output.length) throw new Error("The transparent video encoder returned an empty file.");
    if (output.length > CREATION_MAX_BYTES) {
      if (await encode(23) !== 0) throw new Error("The video is too large to upload. Shorten the animation and export again.");
      output = await ffmpeg.readFile("out.webm");
      if (typeof output === "string" || output.length > CREATION_MAX_BYTES) throw new Error("The video is still over 10 MB. Shorten the animation and export again.");
    }
    const blob = new Blob([new Uint8Array(output).buffer as ArrayBuffer], { type: "video/webm" });
    if (hasTransparentPixels(renderer.render(duration * 0.2)) && !(await videoKeepsAlpha(blob, duration * 0.2))) {
      throw new Error("The WebM encoder did not preserve transparency. Try exporting again.");
    }
    return blob;
  } finally {
    for (let frame = 0; frame < frames; frame++) await ffmpeg.deleteFile(`frame-${String(frame).padStart(5, "0")}.png`).catch(() => {});
    await ffmpeg.deleteFile("out.webm").catch(() => {});
  }
}

/**
 * The same frames as stacked-alpha H.264 for Android (see src/lib/cosmetic-video.ts): twice the height, the colour
 * premultiplied by alpha on top and the alpha as grey below. Rendered from the same timeline with the same fades, so
 * it matches the WebM frame for frame; encoded with the same in-browser FFmpeg (libx264), which every Android
 * decoder plays.
 */
export async function recordStackedMp4(spec: MotionSpec, images: Awaited<ReturnType<typeof loadMotionImages>>): Promise<Blob> {
  const fps = 24;
  const animated = introIdleSpec(spec);
  const duration = Math.min(12, Math.max(0.5, animated.duration));
  const loopFrom = animated.loop.from ?? 0;
  const stage = animated.stage;
  const renderer = new MotionRenderer(animated, images, 1);
  const canvas = document.createElement("canvas");
  canvas.width = stage.w;
  canvas.height = stage.h;
  const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!ctx) throw new Error("Couldn't start the video renderer.");
  const stacked = document.createElement("canvas");
  stacked.width = stage.w;
  stacked.height = stage.h * 2;
  const sctx = stacked.getContext("2d");
  if (!sctx) throw new Error("Couldn't start the video renderer.");
  const ffmpeg = await transparentVideoEncoder();
  const frames = Math.ceil(duration * fps);
  try {
    for (let frame = 0; frame < frames; frame++) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const time = Math.min(duration, frame / fps);
      const fade = 0.2;
      let opacity = Math.min(1, time / fade, (duration - time) / fade);
      if (time >= loopFrom - fade && time < loopFrom) opacity = Math.min(opacity, (loopFrom - time) / fade);
      if (time >= loopFrom && time < loopFrom + fade) opacity = Math.min(opacity, (time - loopFrom) / fade);
      ctx.globalAlpha = Math.max(0, opacity);
      ctx.drawImage(renderer.render(time), 0, 0);
      ctx.globalAlpha = 1;
      const data = ctx.getImageData(0, 0, stage.w, stage.h);
      const out = sctx.createImageData(stage.w, stage.h * 2);
      const src = data.data;
      const dst = out.data;
      for (let i = 0; i < src.length; i += 4) {
        const a = src[i + 3];
        dst[i] = Math.round((src[i] * a + 127) / 255);
        dst[i + 1] = Math.round((src[i + 1] * a + 127) / 255);
        dst[i + 2] = Math.round((src[i + 2] * a + 127) / 255);
        dst[i + 3] = 255;
        const j = src.length + i;
        dst[j] = dst[j + 1] = dst[j + 2] = a;
        dst[j + 3] = 255;
      }
      sctx.putImageData(out, 0, 0);
      const png = await new Promise<Blob>((resolve, reject) => stacked.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Couldn't render a video frame.")), "image/png"));
      await ffmpeg.writeFile(`stacked-${String(frame).padStart(5, "0")}.png`, new Uint8Array(await png.arrayBuffer()));
    }
    const encode = async (crf: number) => ffmpeg.exec([
      "-framerate", String(fps), "-i", "stacked-%05d.png", "-an", "-c:v", "libx264",
      "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1", "-preset", "veryfast", "-crf", String(crf),
      "-g", String(fps * 2), "-force_key_frames", `0,${loopFrom}`,
      "-tag:v", "avc1", "-movflags", "+faststart", "-y", "out-stacked.mp4",
    ]);
    if (await encode(20) !== 0) throw new Error("The Android video encoder failed. Try exporting again.");
    let output = await ffmpeg.readFile("out-stacked.mp4");
    if (typeof output === "string" || !output.length) throw new Error("The Android video encoder returned an empty file.");
    if (output.length > CREATION_MAX_BYTES) {
      if (await encode(24) !== 0) throw new Error("The video is too large to upload. Shorten the animation and export again.");
      output = await ffmpeg.readFile("out-stacked.mp4");
      if (typeof output === "string" || output.length > CREATION_MAX_BYTES) throw new Error("The video is still over 10 MB. Shorten the animation and export again.");
    }
    return new Blob([new Uint8Array(output).buffer as ArrayBuffer], { type: "video/mp4" });
  } finally {
    for (let frame = 0; frame < frames; frame++) await ffmpeg.deleteFile(`stacked-${String(frame).padStart(5, "0")}.png`).catch(() => {});
    await ffmpeg.deleteFile("out-stacked.mp4").catch(() => {});
  }
}

/**
 * Chrome and Edge can encode alpha VP9 directly from a canvas. This avoids
 * spinning up a 32 MB WASM worker for every export. Keep the slower FFmpeg path
 * below for browsers without transparent VP9 MediaRecorder support.
 */
async function recordWithBrowserVp9(options: {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  renderer: MotionRenderer;
  duration: number;
  loopFrom: number;
  fps: number;
  frames: number;
}): Promise<Blob | null> {
  if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream || !MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) return null;
  const { canvas, ctx, renderer, duration, loopFrom, fps, frames } = options;
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  if (typeof track.requestFrame !== "function") {
    stream.getTracks().forEach((item) => item.stop());
    return null;
  }
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => reject(new Error("The browser's transparent video encoder failed."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
  });
  try {
    recorder.start();
    for (let frame = 0; frame < frames; frame++) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const time = Math.min(duration, frame / fps);
      const fade = 0.2;
      let opacity = Math.min(1, time / fade, (duration - time) / fade);
      if (time >= loopFrom - fade && time < loopFrom) opacity = Math.min(opacity, (loopFrom - time) / fade);
      if (time >= loopFrom && time < loopFrom + fade) opacity = Math.min(opacity, (time - loopFrom) / fade);
      ctx.globalAlpha = Math.max(0, opacity);
      ctx.drawImage(renderer.render(time), 0, 0);
      ctx.globalAlpha = 1;
      track.requestFrame();
      await new Promise((resolve) => window.setTimeout(resolve, 1000 / fps));
    }
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    recorder.stop();
    const blob = await finished;
    if (!blob.size || blob.size > CREATION_MAX_BYTES) return null;
    if (hasTransparentPixels(renderer.render(duration * 0.2)) && !(await videoKeepsAlpha(blob, duration * 0.2))) return null;
    return blob;
  } catch {
    if (recorder.state !== "inactive") recorder.stop();
    return null;
  } finally {
    stream.getTracks().forEach((item) => item.stop());
  }
}

let ffmpegPromise: Promise<import("@ffmpeg/ffmpeg").FFmpeg> | undefined;
async function transparentVideoEncoder(): Promise<import("@ffmpeg/ffmpeg").FFmpeg> {
  if (!ffmpegPromise) ffmpegPromise = (async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const ffmpeg = new FFmpeg();
    const root = `${window.location.origin}/studio-ffmpeg`;
    try {
      await ffmpeg.load({
        classWorkerURL: `${root}/wrapper/worker.js`,
        // Keep these same-origin URLs. Blob URLs created on the page aren't
        // consistently importable from the module worker under browser CSPs.
        coreURL: `${root}/ffmpeg-core.js`,
        wasmURL: `${root}/ffmpeg-core.wasm`,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Couldn't load Studio's video encoder (${detail}). Restart Crystal and export again.`);
    }
    return ffmpeg;
  })().catch((error) => { ffmpegPromise = undefined; throw error; });
  return ffmpegPromise;
}

function hasTransparentPixels(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  return false;
}

async function videoKeepsAlpha(blob: Blob, time: number): Promise<boolean> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Couldn't verify WebM transparency."));
    });
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error("Couldn't verify WebM transparency."));
      video.currentTime = Math.min(Math.max(time, 0.01), Math.max(0.01, video.duration - 0.01));
    });
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(video, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
    return false;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** The design with every picture's address passed through `fn`: the project's own `studio:asset/…` names to where they were uploaded. */
function mapImageUrls(spec: MotionSpec, fn: (url: string) => string): MotionSpec {
  const walk = (clips: MotionSpec["clips"]): MotionSpec["clips"] =>
    clips.map((cl) => (cl.source.type === "image" ? { ...cl, source: { ...cl.source, url: fn(cl.source.url) } } : cl.source.type === "compound" ? { ...cl, source: { ...cl.source, clips: walk(cl.source.clips) } } : cl));
  return { ...spec, clips: walk(spec.clips) };
}

function loadMotionImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("A picture in this design couldn't be read."));
    img.src = url;
  });
}

/** One still frame of a published design, as the PNG the store shows: over a card (an effect) or a name strip (a nameplate). */
async function frameOf(spec: MotionSpec, project: Project): Promise<Blob> {
  const images = await loadMotionImages(motionImageUrls(spec));
  const scale = 1;
  const r = new MotionRenderer(spec, images, scale);
  const frame = r.render(spec.duration * 0.45);
  const stage = spec.stage;
  const canvas = document.createElement("canvas");
  canvas.width = stage.w;
  canvas.height = stage.h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#23232a";
  ctx.fillRect(0, 0, stage.w, stage.h);
  if (project.kind === "effect") {
    ctx.fillStyle = "#4b4585";
    ctx.fillRect(0, 0, stage.w, stage.h * 0.28);
    ctx.fillStyle = "#4b4b55";
    ctx.beginPath();
    ctx.arc(80, stage.h * 0.3, 54, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = "#4b4b55";
    ctx.beginPath();
    ctx.arc(70, stage.h / 2, stage.h * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = project.kind === "nameplate" ? 0.85 : 1;
  ctx.drawImage(frame, 0, 0, stage.w, stage.h);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the picture."))), "image/png"));
}

/** One project as the items `submitCreation` takes, with the store picture it implies. */
async function itemsFor(c: Ctx, project: Project, assets: Map<string, AssetMeta>): Promise<{ items: Item[]; preview?: string }> {
  const blobOf = (id: string) => getAssetBlob(id);
  switch (project.kind) {
    case "decoration":
    case "sticker": {
      const doc = project.doc!;
      for (const n of nodesInOrder(doc)) if (n.type === "image" && !n.hidden) await uploadAsset(c, assets.get((n as ImageNode).assetId)!);
      // Gradients, shadows, glows and shaders can't be described to the app's layer renderer, so a node that
      // uses them goes up as the picture it renders to, and is compiled as an ordinary image layer.
      const bakedUrls = new Map<string, string>();
      const baked = await bakeEffects(doc, blobOf);
      for (const [nodeId, blob] of baked) {
        c.progress("Rendering effects…");
        bakedUrls.set(nodeId, await uploadBlob(c, blob, `${project.name}-fx-${nodeId}.png`));
      }
      const layers = compileLayers(doc, (id) => c.uploaded.get(id), (nodeId) => bakedUrls.get(nodeId)).map((l) => JSON.parse(JSON.stringify(l)) as Record<string, unknown>);
      for (const layer of layers) {
        const node = doc.nodes[String(layer.id)];
        if (node?.type !== "image") continue;
        const meta = assets.get((node as ImageNode).assetId);
        if (!meta?.type.startsWith("video/") || bakedUrls.has(node.id)) continue;
        const blob = await blobOf(meta.id);
        if (!blob) throw new Error(`“${meta.name}” is missing from this project.`);
        layer.posterUrl = await uploadBlob(c, await posterFromVideo(blob), `${project.name}-${node.id}-poster.png`);
      }
      c.progress("Making the store picture…");
      const preview = await uploadBlob(c, await rasterizeCosmetic(doc, blobOf), `${project.name}.png`);
      return { items: [{ kind: project.kind === "decoration" ? "avatarDecoration" : "profileSticker", layers }], preview };
    }
    case "nameplate":
    case "effect": {
      if (project.doc && project.motion) return motionItems(c, project, assets);
      const meta = project.picture && assets.get(project.picture.assetId);
      if (!meta) throw new Error("Add the artwork first.");
      const url = await uploadAsset(c, meta);
      return { items: [{ kind: project.kind === "nameplate" ? "nameplate" : "profileEffect", artworkUrl: url }], preview: url };
    }
    case "scene": {
      const doc = project.doc!;
      const bg = nodesInOrder(doc).find((n): n is ImageNode => n.type === "image" && n.role === "background");
      const meta = bg && assets.get(bg.assetId);
      if (!meta) throw new Error("Set the room's background picture first.");
      const url = await uploadAsset(c, meta);
      // Everything drawn on the room goes up as pictures laid over it: pictures placed in the room are uploaded
      // first (a baked picture may contain them), then each piece of artwork is rendered and uploaded.
      for (const n of sceneArtwork(doc)) if (n.type === "image") await uploadAsset(c, assets.get((n as ImageNode).assetId)!);
      const artwork = new Map<string, string>();
      const baked = await bakeEffects(doc, blobOf);
      let drawn = 0;
      for (const [nodeId, blob] of baked) {
        if (!sceneArtwork(doc).some((n) => n.id === nodeId)) continue;
        c.progress(`Rendering artwork ${++drawn}…`);
        artwork.set(nodeId, await uploadBlob(c, blob, `${project.name}-art-${nodeId}.png`));
      }
      const spec = compileScene(doc, project.name, url, (nodeId) => artwork.get(nodeId));
      // A shop card shows a picture; a room that is a clip needs one drawn from it.
      let preview = url;
      if (meta.type.startsWith("video/")) {
        c.progress("Making the store picture…");
        const blob = await getAssetBlob(meta.id);
        if (blob) preview = await uploadBlob(c, await posterFromVideo(blob), `${project.name}.png`);
      }
      return { items: [{ kind: "loungeScene", spec }], preview };
    }
    case "themePack": {
      const data = project.themePack!;
      const ids = new Set<string>([
        // Files left over from before the font was switched to an installed one are not uploaded.
        ...shippedFontFaces(data.font).map((f) => f.assetId),
        ...Object.values(data.sounds),
        ...Object.values(data.icons),
        ...(data.background ? [data.background.assetId] : []),
      ]);
      for (const id of ids) {
        const meta = assets.get(id);
        if (meta) await uploadAsset(c, meta);
      }
      const spec = themePackSpecInput(data, project.name, assets, (id) => c.uploaded.get(id) ?? "");
      delete spec.name;
      c.progress("Making the store picture…");
      const preview = await uploadBlob(c, await rasterizeThemePack(data, project.name, data.font?.family), `${project.name}.png`);
      return { items: [{ kind: "themePack", spec }], preview };
    }
    default:
      throw new Error("That isn't something that can be submitted on its own.");
  }
}

const GRANT_KIND: Partial<Record<Project["kind"], string>> = {
  decoration: "avatarDecoration",
  sticker: "profileSticker",
  nameplate: "nameplate",
  effect: "profileEffect",
  scene: "loungeScene",
  themePack: "themePack",
};

/** What kinds of item a project is sold as, one per item: how Studio finds the listing it could update. */
export async function grantKindsOf(project: Project, lookup: (id: string) => Promise<Project | null> = getProject): Promise<string[]> {
  if (project.kind !== "pack") return GRANT_KIND[project.kind] ? [GRANT_KIND[project.kind]!] : [];
  const kinds: string[] = [];
  for (const id of project.pack?.projectIds ?? []) {
    const p = await lookup(id);
    if (p && GRANT_KIND[p.kind]) kinds.push(GRANT_KIND[p.kind]!);
  }
  return kinds;
}

/** Everything wrong with a project, by the same rules the server will apply. */
export async function checkProject(project: Project, assets: Map<string, AssetMeta>, lookup: (id: string) => Promise<Project | null> = getProject): Promise<Problem[]> {
  const has = (id: string) => assets.has(id);
  const problems: Problem[] = [];
  if (project.listing.name.trim().length < 2) problems.push({ severity: "error", message: "Give it a name for the store (at least 2 characters)." });
  if (!project.listing.free) {
    const cents = Math.round(Number(project.listing.priceUsd) * 100);
    if (!Number.isFinite(cents) || cents < 50 || cents > 50_000) problems.push({ severity: "error", message: "A price is between $0.50 and $500 — or make it free." });
  }
  switch (project.kind) {
    case "decoration":
    case "sticker":
      problems.push(...checkCosmetic(project.doc!, has));
      break;
    case "scene":
      problems.push(...checkScene(project.doc!, has));
      break;
    case "nameplate":
    case "effect":
      if (project.doc && project.motion) {
        problems.push(...checkArtwork(project.doc, has), ...checkMotionProject(project.doc, project.motion, has));
        // A picture imported onto the timeline must still be a file of the project.
        for (const u of motionImageUrls(project.motion)) {
          const m = /^studio:asset\/([\w-]+)$/.exec(u);
          if (!m || !has(m[1])) problems.push({ severity: "error", message: "A picture on the timeline has been removed from this project." });
        }
      } else if (!project.picture || !has(project.picture.assetId)) problems.push({ severity: "error", message: "Add the artwork." });
      break;
    case "themePack":
      problems.push(...checkThemePack(project.themePack!, project.listing.name || project.name, assets));
      break;
    case "pack": {
      const ids = project.pack?.projectIds ?? [];
      if (ids.length < 2) problems.push({ severity: "error", message: "A pack holds at least two things." });
      const kinds = new Set<string>();
      for (const id of ids) {
        const p = await lookup(id);
        if (!p) {
          problems.push({ severity: "error", message: "A project in this pack has been deleted." });
          continue;
        }
        if (kinds.has(p.kind)) problems.push({ severity: "error", message: `A pack can hold one ${p.kind}; “${p.name}” is a second.` });
        kinds.add(p.kind);
        if (p.kind === "scene" || p.kind === "pack") problems.push({ severity: "error", message: `“${p.name}” can't go in a pack — scenes are sold on their own.` });
        const own = new Map((await listAssets(p.id)).map((a) => [a.id, a]));
        const sub = await checkProject({ ...p, listing: { ...p.listing, name: p.listing.name || p.name } }, own, lookup);
        for (const s of sub.filter((x) => x.severity === "error" && !x.message.startsWith("Give it a name") && !x.message.startsWith("A price"))) {
          problems.push({ severity: "error", message: `${p.name}: ${s.message}` });
        }
      }
      break;
    }
  }
  return problems;
}

/** Upload, build and submit. Returns the new submission's id. */
export interface StoreLink {
  /** The live listing this changes, rather than making a new one. */
  updatesSkuId?: string;
  /** A submission of this project still waiting for review, which this one takes the place of. */
  supersedes?: string;
}

/** Check, upload and build everything a submission sends: the same for a creator's and for staff publishing as Crystal. */
async function prepareSubmission(convex: ConvexReactClient, project: Project, progress: Progress): Promise<{ items: Item[]; previewUrl?: string; cents: number }> {
  const c: Ctx = { convex, progress, uploaded: new Map() };
  const own = new Map((await listAssets(project.id)).map((a) => [a.id, a]));
  const found = await checkProject(project, own);
  const errors = found.filter((p) => p.severity === "error");
  if (errors.length) throw new Error(errors[0].message);

  let items: Item[] = [];
  let previewUrl: string | undefined;
  if (project.kind === "pack") {
    for (const id of project.pack!.projectIds) {
      const p = (await getProject(id))!;
      const assets = new Map((await listAssets(p.id)).map((a) => [a.id, a]));
      const r = await itemsFor({ ...c, uploaded: new Map() }, p, assets);
      items = items.concat(r.items);
      previewUrl ??= r.preview;
    }
    // A pack's own picture: the first item's, unless it is replaced by the creator later.
  } else {
    const r = await itemsFor(c, project, own);
    items = r.items;
    previewUrl = r.preview;
  }

  const cents = project.listing.free ? 0 : Math.round(Number(project.listing.priceUsd) * 100);
  return { items, previewUrl, cents };
}

export async function submitProject(convex: ConvexReactClient, project: Project, progress: Progress, link: StoreLink = {}): Promise<string> {
  const { items, previewUrl, cents } = await prepareSubmission(convex, project, progress);
  progress("Submitting…");
  const id = await convex.mutation(api.marketplace.submitCreation, {
    name: project.listing.name.trim(),
    description: project.listing.description.trim() || undefined,
    items: items as never,
    previewUrl,
    priceCents: cents,
    currency: "usd",
    ...(link.updatesSkuId ? { updatesSkuId: link.updatesSkuId as never } : {}),
    ...(link.supersedes ? { supersedes: link.supersedes as never } : {}),
  });
  return id as string;
}

/**
 * Staff only: publish straight to the Marketplace as Crystal, with no review (see `staffPublishCreation`). The same checks
 * and uploads as a creator's submission run first, and the server checks the caller is staff again: this is the same request
 * with a different destination, not a way around either.
 */
export async function publishAsCrystal(
  convex: ConvexReactClient,
  project: Project,
  progress: Progress,
  options: { categoryId: string; featured: boolean; updatesSkuId?: string },
): Promise<{ skuId: string; slug: string }> {
  const { items, previewUrl, cents } = await prepareSubmission(convex, project, progress);
  progress("Publishing as Crystal…");
  const r = await convex.mutation(api.marketplace.staffPublishCreation, {
    name: project.listing.name.trim(),
    description: project.listing.description.trim() || undefined,
    items: items as never,
    previewUrl,
    priceCents: cents,
    currency: "usd",
    categoryId: options.categoryId as never,
    featured: options.featured,
    ...(options.updatesSkuId ? { updatesSkuId: options.updatesSkuId as never } : {}),
  });
  return { skuId: r.skuId as string, slug: r.slug };
}

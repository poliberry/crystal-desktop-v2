import type { ConvexReactClient } from "convex/react";

import { api } from "../../convex/_generated/api";
import { uploadCreation } from "@/lib/creation-upload";
import { compileLayers, compileScene, checkArtwork, checkCosmetic, checkScene, sceneArtwork, type Problem } from "@/studio/model/compile";
import { nodesInOrder } from "@/studio/model/doc";
import { bakeEffects, posterFromVideo, rasterizeArtwork, rasterizeCosmetic, rasterizeThemePack } from "@/studio/model/rasterize";
import { checkMotionProject, compilePublished, layersUsed, motionIsStatic } from "@/studio/model/motion-doc";
import { MotionRenderer, loadMotionImages } from "@/lib/motion-render";
import { canvasToPng, renderFx, bakeScale } from "@/studio/model/fx-render";
import { fxBox } from "@/studio/model/fx";
import { motionImageUrls, type MotionSpec } from "../../convex/lib/motion";

import { checkThemePack, fontOf, themePackSpecInput } from "@/studio/model/theme-pack";
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
  return { items: [{ kind, artworkUrl: published.url }], preview };
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
      const layers = compileLayers(doc, (id) => c.uploaded.get(id), (nodeId) => bakedUrls.get(nodeId)).map((l) => JSON.parse(JSON.stringify(l)));
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
      const ids = new Set<string>([...(fontOf(data.font)?.faces.map((f) => f.assetId) ?? []), ...Object.values(data.sounds), ...Object.values(data.icons)]);
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

export async function submitProject(convex: ConvexReactClient, project: Project, progress: Progress, link: StoreLink = {}): Promise<string> {
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

  progress("Submitting…");
  const cents = project.listing.free ? 0 : Math.round(Number(project.listing.priceUsd) * 100);
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

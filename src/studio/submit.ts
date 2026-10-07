import type { ConvexReactClient } from "convex/react";

import { api } from "../../convex/_generated/api";
import { uploadCreation } from "@/lib/creation-upload";
import { compileLayers, compileScene, checkCosmetic, checkScene, type Problem } from "@/studio/model/compile";
import { nodesInOrder } from "@/studio/model/doc";
import { posterFromVideo, rasterizeCosmetic, rasterizeThemePack } from "@/studio/model/rasterize";
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

/** One project as the items `submitCreation` takes, with the store picture it implies. */
async function itemsFor(c: Ctx, project: Project, assets: Map<string, AssetMeta>): Promise<{ items: Item[]; preview?: string }> {
  const blobOf = (id: string) => getAssetBlob(id);
  switch (project.kind) {
    case "decoration":
    case "sticker": {
      const doc = project.doc!;
      for (const n of nodesInOrder(doc)) if (n.type === "image" && !n.hidden) await uploadAsset(c, assets.get((n as ImageNode).assetId)!);
      const layers = compileLayers(doc, (id) => c.uploaded.get(id)).map((l) => JSON.parse(JSON.stringify(l)));
      c.progress("Making the store picture…");
      const preview = await uploadBlob(c, await rasterizeCosmetic(doc, blobOf), `${project.name}.png`);
      return { items: [{ kind: project.kind === "decoration" ? "avatarDecoration" : "profileSticker", layers }], preview };
    }
    case "nameplate":
    case "effect": {
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
      const spec = compileScene(doc, project.name, url);
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
      if (!project.picture || !has(project.picture.assetId)) problems.push({ severity: "error", message: "Add the artwork." });
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
export async function submitProject(convex: ConvexReactClient, project: Project, progress: Progress): Promise<string> {
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
  });
  return id as string;
}

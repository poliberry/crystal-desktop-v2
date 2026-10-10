import { MOTION_LIMITS, allClips, normalizeMotionSpec, newClip, type Clip, type MotionSpec, type Source } from "../../../convex/lib/motion";
import { nodesInOrder } from "@/studio/model/doc";
import { fxBox } from "@/studio/model/fx";
import type { Doc, Node } from "@/studio/model/types";
import type { Problem } from "@/studio/model/compile";

/**
 * Where the canvas editor's artwork meets the timeline.
 *
 * A nameplate or profile effect is two things made in two editors: the artwork, a canvas document, and the timeline that
 * moves it. Every layer of the artwork appears on the timeline as a *layer clip*, a clip whose source is that layer
 * drawn live (see `Source` "layer"), at the place and size it has on the canvas. This module keeps the two in step —
 * adding a clip when a layer is drawn, dropping it when the layer is deleted, following it when it is moved or
 * resized — and, at the end, turns the timeline into a publishable design by replacing each layer with the picture it
 * rendered to.
 */

export type LayerSource = Extract<Source, { type: "layer" }>;
export const isLayerClip = (c: Clip): c is Clip & { source: LayerSource } => c.source.type === "layer";

/** The nodes of a document that can be on the timeline: anything drawn. */
export const artworkNodes = (doc: Doc): Node[] => nodesInOrder(doc).filter((n) => n.type === "image" || n.type === "shape" || n.type === "text" || n.type === "path");

/** Where a node's picture goes on the stage: the box its effects reach, as a size and the offset of its centre from the stage's. */
export function layerBox(node: Node, doc: Doc): { w: number; h: number; ox: number; oy: number } {
  const b = fxBox(node);
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return { w: r(Math.max(1, b.w)), h: r(Math.max(1, b.h)), ox: r(b.x + b.w / 2 - doc.artboard.w / 2), oy: r(b.y + b.h / 2 - doc.artboard.h / 2) };
}

/**
 * The id of the clip made for a layer. Derived from the layer's id rather than random, so syncing the same artwork twice gives
 * the same clips: an id the editor shows (and has selected, or is dragging) is the id that is saved, not one that is replaced
 * by a fresh one on the next edit.
 */
export const layerClipId = (nodeId: string): string => `lyr-${nodeId.replace(/[^\w-]/g, "_")}`.slice(0, 40);

const mapLayers = (clips: Clip[], fn: (c: Clip & { source: LayerSource }) => Clip | null): Clip[] => {
  const out: Clip[] = [];
  for (const c of clips) {
    if (isLayerClip(c)) {
      const r = fn(c);
      if (r) out.push(r);
    } else if (c.source.type === "compound") out.push({ ...c, source: { ...c.source, clips: mapLayers(c.source.clips, fn) } });
    else out.push(c);
  }
  return out;
};

const sameBox = (a: LayerSource, b: { w: number; h: number; ox: number; oy: number }) => a.w === b.w && a.h === b.h && a.ox === b.ox && a.oy === b.oy;

/**
 * The timeline brought in step with the artwork. A visible layer with no clip gets one that plays the whole design, in
 * the lane matching its place in the stack; a clip whose layer has been deleted is dropped; the rest follow their
 * layer's place and size. A *hidden* layer with no clip is left without one: that is how a layer is taken off the
 * timeline (deleting its clip, then hiding the layer on the canvas), and showing it again brings a fresh clip. A hidden
 * layer that still has a clip keeps it, so toggling the eye never throws away an animation. Returns the same object if
 * nothing changed, so it is safe to call on every edit.
 */
export function syncLayers(spec: MotionSpec, doc: Doc): MotionSpec {
  const nodes = artworkNodes(doc);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const present = new Set<string>();
  let changed = false;

  const walked = mapLayers(spec.clips, (c) => {
    const node = byId.get(c.source.nodeId);
    if (!node) {
      changed = true;
      return null;
    }
    present.add(node.id);
    const box = layerBox(node, doc);
    if (sameBox(c.source, box)) return c;
    changed = true;
    return { ...c, name: c.name, source: { ...c.source, ...box } };
  });

  const added: Clip[] = [];
  nodes.forEach((n, i) => {
    if (present.has(n.id) || n.hidden) return;
    const box = layerBox(n, doc);
    added.push(newClip({ type: "layer", nodeId: n.id, ...box }, { id: layerClipId(n.id), name: n.name, track: Math.min(31, i), start: 0, duration: spec.duration, loop: false }));
    changed = true;
  });
  return changed ? { ...spec, clips: [...walked, ...added] } : spec;
}

/** Layer clips whose layers are named here, so a clip can be shown by its layer's current name. */
export function layerNames(doc: Doc): Map<string, string> {
  return new Map(artworkNodes(doc).map((n) => [n.id, n.name]));
}

// --- Static or animated ---------------------------------------------------------------------------------------------

const constant = (p: unknown) => typeof p === "number";

/**
 * Whether the design never changes: nothing but layers, each on screen for the whole design with every setting constant.
 * Such a design is sent as an ordinary picture, as it always was, instead of an animation every viewer has to play.
 */
export function motionIsStatic(spec: MotionSpec): boolean {
  return spec.clips.every((c) => {
    if (!c.on) return true;
    if (c.source.type !== "layer" && c.source.type !== "image") return false;
    const t = c.transform;
    return (
      c.start <= 1e-6 &&
      c.start + c.duration >= spec.duration - 1e-6 &&
      constant(t.x) && constant(t.y) && constant(t.scaleX) && constant(t.scaleY) && constant(t.rotation) && constant(t.opacity) &&
      !c.transitionIn && !c.transitionOut && !c.mask && c.fx.length === 0
    );
  });
}

// --- Publishing -----------------------------------------------------------------------------------------------------------

/**
 * The timeline as a design the app can play: every layer replaced by the picture it rendered to (`pictureOf` gives the
 * address it was uploaded to). Throws a sentence if a layer has no picture. The result is run through the same
 * normaliser the server uses, so what is sent is already what will be stored.
 */
export function compilePublished(spec: MotionSpec, name: string, pictureOf: (nodeId: string) => string | undefined, assertUrl: (u: string) => string): MotionSpec {
  const replace = (clips: Clip[]): Clip[] =>
    clips.map((c) => {
      if (isLayerClip(c)) {
        const url = pictureOf(c.source.nodeId);
        if (!url) throw new Error(`“${c.name}” has no picture to play.`);
        return { ...c, source: { type: "image", url, w: c.source.w, h: c.source.h, ox: c.source.ox, oy: c.source.oy } };
      }
      if (c.source.type === "compound") return { ...c, source: { ...c.source, clips: replace(c.source.clips) } };
      return c;
    });
  return normalizeMotionSpec({ ...spec, name, clips: replace(spec.clips) }, assertUrl);
}

/** The layers the published design will need a picture of: every layer clip that is on, once each. */
export function layersUsed(spec: MotionSpec): string[] {
  const ids = new Set<string>();
  for (const c of allClips(spec.clips)) if (isLayerClip(c) && c.on) ids.add(c.source.nodeId);
  return [...ids];
}

// --- Checks --------------------------------------------------------------------------------------------------------------------

/** What is wrong with a nameplate or profile effect, by the rules of what can be sent. */
export function checkMotionProject(doc: Doc, spec: MotionSpec, assetExists: (id: string) => boolean): Problem[] {
  const problems: Problem[] = [];
  const nodes = new Map(artworkNodes(doc).map((n) => [n.id, n]));
  const clips = allClips(spec.clips);
  if (clips.filter((c) => c.on).length === 0) problems.push({ severity: "error", message: "There's nothing to show yet — draw something, or add a generator on the timeline." });
  if (clips.length > MOTION_LIMITS.clips) problems.push({ severity: "error", message: `A design has at most ${MOTION_LIMITS.clips} clips; this has ${clips.length}.` });
  for (const c of clips) {
    if (isLayerClip(c)) {
      const n = nodes.get(c.source.nodeId);
      if (!n) problems.push({ severity: "error", message: `“${c.name}” has lost its layer.` });
      else if (n.type === "image" && !assetExists(n.assetId)) problems.push({ severity: "error", message: `“${n.name}” has lost its picture.`, nodeId: n.id });
      else if (n.type === "text" && !n.text.trim()) problems.push({ severity: "error", message: `“${n.name}” has no text.`, nodeId: n.id });
    }
    if (c.source.type === "text" && !c.source.text.trim()) problems.push({ severity: "error", message: `The title “${c.name}” has no text.` });
    if (c.on && c.source.type === "adjust" && c.fx.length === 0) problems.push({ severity: "warning", message: `The adjustment layer “${c.name}” has no effects, so it does nothing.` });
    if (c.on && c.duration < 0.1 && c.source.type !== "adjust") problems.push({ severity: "warning", message: `“${c.name}” is very short and may be missed.` });
  }
  if (spec.duration > 8) problems.push({ severity: "warning", message: `It runs for ${spec.duration.toFixed(1)} s. Short designs (2–6 s) feel better on a profile.` });
  const onTimeline = new Set(clips.filter(isLayerClip).map((c) => c.source.nodeId));
  const hidden = [...nodes.values()].filter((n) => n.hidden && !onTimeline.has(n.id)).length;
  if (hidden) problems.push({ severity: "warning", message: `${hidden} hidden layer${hidden > 1 ? "s" : ""} won't be in the design.` });
  return problems;
}

/** Whether publishing this timeline will be accepted, checked now with stand-in addresses: the first thing wrong, or null. */
export function motionRejection(spec: MotionSpec): string | null {
  try {
    compilePublished(spec, "check", () => "https://cdn.example/x.png", (u) => u);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "That design isn't valid.";
  }
}

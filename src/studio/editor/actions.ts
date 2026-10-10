import type { DocEditor } from "@/studio/editor/use-doc-editor";
import { addNode, duplicateNodes, expandGroups, groupAt, groupNodes, newId, nodesInOrder, patchNodes, removeNodes, reorder, retagGroups, ungroupNodes, unionBounds } from "@/studio/model/doc";
import { addEffect, type EffectKind } from "@/studio/model/fx";
import type { PathfinderOp } from "@/studio/model/boolean";
import type { Node } from "@/studio/model/types";
import { replaceNodes } from "@/studio/model/doc";

/**
 * What the menus, the control bar and the keyboard all do to the selection. One definition
 * each, so a menu item and its shortcut can't drift apart.
 *
 * The clipboard lives here, at module level, rather than in the canvas: Edit ▸ Copy has to
 * reach what ⌘C copied, and the canvas isn't what the menu bar is part of.
 */

let clipboard: Node[] = [];

/** There is exactly one screen and one floor line in a room, so neither can be copied. */
const copyable = (n: Node) => n.type !== "screen" && n.type !== "floor";

const selected = (e: DocEditor) => e.selection.map((id) => e.doc.nodes[id]).filter(Boolean) as Node[];
const unlocked = (e: DocEditor) => selected(e).filter((n) => !n.locked);

export const hasClipboard = () => clipboard.length > 0;

export function copy(e: DocEditor) {
  const picked = selected(e);
  if (picked.length) clipboard = picked;
}

export function cut(e: DocEditor) {
  copy(e);
  remove(e);
}

/**
 * Paste. `offset` drops it a little down and right, as a plain paste does; `place` puts it exactly
 * where it was copied from (⇧⌘V); `front`/`back` put it on top of or beneath everything (⌘F, ⌘B).
 */
export function paste(e: DocEditor, how: "offset" | "place" | "front" | "back" = "offset") {
  const items = clipboard.filter(copyable);
  if (items.length === 0) return;
  const shift = how === "offset" ? 20 : 0;
  let next = e.doc;
  const made: string[] = [];
  for (const n of retagGroups(items)) {
    const copy = { ...n, id: newId(), x: n.x + shift, y: n.y + shift, locked: false } as Node;
    next = addNode(next, copy);
    made.push(copy.id);
  }
  if (how === "back") next = reorder(next, made, "back");
  e.commit(next);
  e.setSelection(made);
}

export function duplicate(e: DocEditor) {
  const picked = e.selection.filter((id) => e.doc.nodes[id] && copyable(e.doc.nodes[id]));
  if (!picked.length) return;
  const dup = duplicateNodes(e.doc, picked);
  e.commit(dup.doc);
  e.setSelection(dup.ids);
}

export function remove(e: DocEditor) {
  const ids = unlocked(e).map((n) => n.id);
  if (!ids.length) return;
  e.commit(removeNodes(e.doc, ids));
  e.setSelection([]);
}

export const selectAll = (e: DocEditor) => e.setSelection(e.doc.order.filter((id) => !e.doc.nodes[id].locked && !e.doc.nodes[id].hidden));
export const deselect = (e: DocEditor) => e.setSelection([]);

export function invertSelection(e: DocEditor) {
  const current = new Set(e.selection);
  e.setSelection(e.doc.order.filter((id) => !current.has(id) && !e.doc.nodes[id].locked && !e.doc.nodes[id].hidden));
}

/** Select everything of the same kind as what is selected — Illustrator's Select ▸ Same ▸ … */
export function selectSameType(e: DocEditor) {
  const types = new Set(selected(e).map((n) => n.type));
  if (types.size === 0) return;
  e.setSelection(nodesInOrder(e.doc).filter((n) => types.has(n.type) && !n.locked && !n.hidden).map((n) => n.id));
}

/** Object ▸ Group (⌘G). */
export function group(e: DocEditor) {
  const g = groupNodes(e.doc, e.selection, e.scope);
  if (!g) return;
  e.commit(g.doc);
  e.setSelection(expandGroups(g.doc, e.selection, e.scope));
}

/** Object ▸ Ungroup (⇧⌘G). */
export function ungroup(e: DocEditor) {
  const next = ungroupNodes(e.doc, e.selection, e.scope);
  if (next !== e.doc) e.commit(next);
}

/** Whether the selection is, or contains, a group — for enabling Ungroup. */
export const hasGroup = (e: DocEditor) => e.selection.some((id) => !!groupAt(e.doc, id, e.scope));

/** Object ▸ Arrange. */
export function arrange(e: DocEditor, to: "front" | "back" | "up" | "down") {
  if (e.selection.length) e.commit(reorder(e.doc, e.selection, to));
}

/** Object ▸ Lock ▸ Selection (⌘2): locked things can't be picked, moved or deleted until unlocked. */
export function lockSelection(e: DocEditor) {
  if (!e.selection.length) return;
  e.commit(patchNodes(e.doc, e.selection, { locked: true }));
  e.setSelection([]);
}
export const unlockAll = (e: DocEditor) => e.commit(patchNodes(e.doc, e.doc.order, { locked: false }));

/** Object ▸ Hide ▸ Selection (⌘3). */
export function hideSelection(e: DocEditor) {
  if (!e.selection.length) return;
  e.commit(patchNodes(e.doc, e.selection, { hidden: true }));
  e.setSelection([]);
}
export const showAll = (e: DocEditor) => e.commit(patchNodes(e.doc, e.doc.order, { hidden: false }));

/** Effect menu: add one to every visual node selected. */
export function applyEffect(e: DocEditor, kind: EffectKind) {
  const ids = unlocked(e)
    .filter((n) => n.type === "image" || n.type === "shape" || n.type === "text" || n.type === "path")
    .map((n) => n.id);
  if (ids.length) e.commit(patchNodes(e.doc, ids, (n) => ({ fx: addEffect(n.fx, kind) })), `fx-${kind}`);
}

export function clearEffects(e: DocEditor) {
  const ids = selected(e).filter((n) => n.fx).map((n) => n.id);
  if (ids.length) e.commit(patchNodes(e.doc, ids, { fx: undefined }));
}

/** Where the selection is, for the control bar's X/Y/W/H of several things at once. */
export const selectionBounds = (e: DocEditor) => unionBounds(selected(e));

export const canArrange = (e: DocEditor) => e.selection.length > 0;

// --- Pathfinder and compound paths -----------------------------------------------------------------
//
// These return what to tell the person when they can't be done (null when they were). The geometry is in
// model/boolean.ts, loaded on first use: it brings Paper.js with it, which nothing else needs.

/** The selected objects, bottom first, the way the stack has them. */
const inStackOrder = (e: DocEditor) => e.doc.order.filter((id) => e.selection.includes(id)).map((id) => e.doc.nodes[id]);

/** Why the selection can't be combined, or null if it can. */
export async function combineReason(e: DocEditor): Promise<string | null> {
  const nodes = inStackOrder(e);
  if (nodes.some((n) => n.locked)) return "Unlock the objects first";
  const { pathfinderReason } = await import("@/studio/model/boolean");
  return pathfinderReason(nodes);
}

export async function pathfinderOp(e: DocEditor, op: PathfinderOp): Promise<string | null> {
  const reason = await combineReason(e);
  if (reason) return reason;
  const { pathfinder } = await import("@/studio/model/boolean");
  const nodes = inStackOrder(e);
  const made = pathfinder(nodes, op);
  if (!made) return "Nothing is left: the shapes don't overlap that way";
  e.commit(replaceNodes(e.doc, nodes.map((n) => n.id), made));
  e.setSelection([made.id]);
  return null;
}

/** Object ▸ Compound Path ▸ Make (⌘8). */
export async function makeCompound(e: DocEditor): Promise<string | null> {
  const reason = await combineReason(e);
  if (reason) return reason;
  const { makeCompound: make } = await import("@/studio/model/boolean");
  const nodes = inStackOrder(e);
  const made = make(nodes);
  if (!made) return "Couldn't make a compound path from that";
  e.commit(replaceNodes(e.doc, nodes.map((n) => n.id), made));
  e.setSelection([made.id]);
  return null;
}

/** Object ▸ Compound Path ▸ Release (⌥⌘8). */
export async function releaseCompound(e: DocEditor): Promise<string | null> {
  const { releaseCompound: release, isCompoundNode } = await import("@/studio/model/boolean");
  const compound = inStackOrder(e).filter(isCompoundNode);
  if (compound.length === 0) return "Select a compound path";
  const parts = compound.flatMap(release);
  e.commit(replaceNodes(e.doc, compound.map((n) => n.id), parts));
  e.setSelection(parts.map((p) => p.id));
  return null;
}

/** Object ▸ Expand Shape: a rectangle or ellipse becomes a path of the same shape, so its anchors can be edited. */
export async function expandShape(e: DocEditor): Promise<string | null> {
  const shapes = inStackOrder(e).filter((n) => n.type === "shape" && !n.locked);
  if (shapes.length === 0) return "Select a rectangle or an ellipse";
  const { shapeToPath } = await import("@/studio/model/boolean");
  let doc = e.doc;
  const ids: string[] = [];
  for (const n of shapes) {
    if (n.type !== "shape") continue;
    const path = shapeToPath(n);
    if (!path) continue;
    doc = replaceNodes(doc, [n.id], path);
    ids.push(path.id);
  }
  e.commit(doc);
  e.setSelection(ids);
  return null;
}

/** Whether Release applies: the selection has a compound path in it. */
export const hasCompound = (e: DocEditor) => e.selection.some((id) => e.doc.nodes[id]?.type === "path" && e.doc.nodes[id].type === "path" && (e.doc.nodes[id] as { points: { m?: true }[] }).points.some((p) => p.m));
export const hasShape = (e: DocEditor) => e.selection.some((id) => e.doc.nodes[id]?.type === "shape");

import { normalizePoints, polygonPoints, starPoints } from "./path";
import type { Doc, DocGuides, DocKind, Node, NodeType, PathLive, PathNode, PathPoint, ShapeNode, TextNode } from "./types";

/** The size each kind of design is drawn at. The numbers are only a unit: what
 * matters is the proportions, and that everything compiles to percentages. */
export const ARTBOARDS: Record<DocKind, { w: number; h: number }> = {
  // The avatar is the whole artboard; art may reach past it, within the margin.
  decoration: { w: 400, h: 400 },
  // A profile card, drawn at a typical height. Stickers are placed from its top edge.
  sticker: { w: 300, h: 400 },
  scene: { w: 1600, h: 900 },
  // The stage of an animated design, which is what the app plays it on (see MOTION_STAGES).
  nameplate: { w: 960, h: 176 },
  effect: { w: 600, h: 700 },
};

export function newId(prefix = "n"): string {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

export function emptyDoc(kind: DocKind): Doc {
  return { v: 1, kind, artboard: { ...ARTBOARDS[kind] }, nodes: {}, order: [] };
}

const base = (type: NodeType, name: string, x: number, y: number, w: number, h: number) => ({
  id: newId(),
  name,
  type,
  x,
  y,
  w,
  h,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
});

export function makeShape(shape: "rect" | "ellipse", x: number, y: number, w: number, h: number): ShapeNode {
  return {
    ...base("shape", shape === "rect" ? "Rectangle" : "Ellipse", x, y, w, h),
    type: "shape",
    shape,
    fill: "#8b5cf6",
    stroke: "#ffffff",
    strokeWidth: 0,
    radius: 0,
  };
}

/**
 * A path from anchors given anywhere on the artboard: the box becomes the outline's tight bounds
 * and the anchors are stored as fractions of it. Returns null if there is nothing to draw.
 */
export function makePathFromWorld(points: PathPoint[], closed: boolean, look: Partial<PathNode> = {}, name = "Path"): PathNode | null {
  if (points.length < 2) return null;
  const n = normalizePoints(points, closed);
  return {
    ...base("path", name, n.x0, n.y0, n.w, n.h),
    type: "path",
    points: n.points,
    closed,
    fill: "none",
    stroke: "#ffffff",
    strokeWidth: 3,
    cap: "round",
    join: "round",
    ...look,
  } as PathNode;
}

export const makeLine = (a: { x: number; y: number }, b: { x: number; y: number }) => makePathFromWorld([a, b], false, {}, "Line");

/** A polygon or star filling `area`, stroke-less and filled like a new shape, remembering how it was made so its sides can be changed. */
export function makeShapePath(live: PathLive, area: { x: number; y: number; w: number; h: number }): PathNode {
  const points = live.kind === "polygon" ? polygonPoints(live.sides) : starPoints(live.points, live.inner);
  return {
    ...base("path", live.kind === "polygon" ? "Polygon" : "Star", area.x, area.y, Math.max(1, area.w), Math.max(1, area.h)),
    type: "path",
    points,
    closed: true,
    fill: "#8b5cf6",
    stroke: "#ffffff",
    strokeWidth: 0,
    cap: "round",
    join: "miter",
    live,
  } as PathNode;
}

export function makeText(x: number, y: number, text = "Text"): TextNode {
  return {
    ...base("text", "Text", x, y, 160, 48),
    type: "text",
    text,
    fontSize: 32,
    fontWeight: 700,
    italic: false,
    align: "center",
    color: "#ffffff",
    stroke: "#000000",
    strokeWidth: 0,
  };
}

export function makeImage(assetId: string, name: string, x: number, y: number, w: number, h: number): Node {
  return { ...base("image", name, x, y, w, h), type: "image", assetId };
}

export function makeSceneObject(type: "screen" | "seat" | "floor", artboard: { w: number; h: number }, at?: { x: number; y: number }): Node {
  const a = artboard;
  switch (type) {
    case "screen":
      return { ...base("screen", "Screen", a.w * 0.31, a.h * 0.11, a.w * 0.38, a.h * 0.31), type: "screen" };
    case "seat": {
      const s = a.w * 0.026;
      return { ...base("seat", "Seat", (at?.x ?? a.w * 0.5) - s / 2, (at?.y ?? a.h * 0.75) - s / 2, s, s), type: "seat" };
    }
    case "floor":
      return { ...base("floor", "Floor line", 0, a.h * 0.58, a.w, 4), type: "floor" };
  }
}

/** Nodes with a fill and an outline of their own to colour: shapes, text and paths. */
export const hasPaint = (n: Node | null | undefined): n is ShapeNode | TextNode | PathNode => n?.type === "shape" || n?.type === "text" || n?.type === "path";

// --- Reading -------------------------------------------------------------------------------

export const nodesInOrder = (doc: Doc): Node[] => doc.order.map((id) => doc.nodes[id]).filter(Boolean);

export function centre(n: Node): { x: number; y: number } {
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
}

/** The box a node covers once rotated: what has to be on screen, or inside a limit. */
export function boundsOf(n: Node): { x: number; y: number; w: number; h: number } {
  if (!n.rotation) return { x: n.x, y: n.y, w: n.w, h: n.h };
  const r = (n.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  const w = n.w * cos + n.h * sin;
  const h = n.w * sin + n.h * cos;
  const c = centre(n);
  return { x: c.x - w / 2, y: c.y - h / 2, w, h };
}

export function unionBounds(nodes: Node[]): { x: number; y: number; w: number; h: number } | null {
  if (nodes.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const n of nodes) {
    const b = boundsOf(n);
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w);
    y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// --- Changing (all pure: they return a new doc) ---------------------------------------------

export function addNode(doc: Doc, node: Node): Doc {
  return { ...doc, nodes: { ...doc.nodes, [node.id]: node }, order: [...doc.order, node.id] };
}

export function removeNodes(doc: Doc, ids: string[]): Doc {
  const gone = new Set(ids);
  const nodes = { ...doc.nodes };
  for (const id of gone) delete nodes[id];
  const next = { ...doc, nodes, order: doc.order.filter((id) => !gone.has(id)) };
  // Taking things out of a group can leave it with one member, which isn't a group.
  return ids.some((id) => doc.nodes[id]?.group) ? tidyGroups(next) : next;
}

/** Leave no group with fewer than two members: a group of one is dissolved. */
export function tidyGroups(doc: Doc): Doc {
  const count = new Map<string, number>();
  for (const id of doc.order) {
    const chain = doc.nodes[id]?.group?.split("/") ?? [];
    for (let i = 1; i <= chain.length; i++) {
      const key = chain.slice(0, i).join("/");
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  let nodes: Record<string, Node> | null = null;
  for (const id of doc.order) {
    const n = doc.nodes[id];
    if (!n?.group) continue;
    const chain = n.group.split("/");
    // A child group can't have more members than its parent, so only the innermost levels are ever dropped.
    let keep = chain.length;
    while (keep > 0 && (count.get(chain.slice(0, keep).join("/")) ?? 0) < 2) keep--;
    if (keep === chain.length) continue;
    nodes ??= { ...doc.nodes };
    const { group: _g, ...plain } = n;
    void _g;
    nodes[id] = (keep > 0 ? { ...plain, group: chain.slice(0, keep).join("/") } : plain) as Node;
  }
  return nodes ? { ...doc, nodes } : doc;
}

export function patchNodes(doc: Doc, ids: string[], patch: Partial<Node> | ((n: Node) => Partial<Node>)): Doc {
  const nodes = { ...doc.nodes };
  for (const id of ids) {
    const n = nodes[id];
    if (!n) continue;
    nodes[id] = { ...n, ...(typeof patch === "function" ? patch(n) : patch) } as Node;
  }
  return { ...doc, nodes };
}

/** Move nodes within the stack: `to` is "front", "back", or a step up or down. */
export function reorder(doc: Doc, ids: string[], to: "front" | "back" | "up" | "down"): Doc {
  const set = new Set(ids);
  const picked = doc.order.filter((id) => set.has(id));
  const rest = doc.order.filter((id) => !set.has(id));
  if (picked.length === 0) return doc;
  if (to === "front") return { ...doc, order: [...rest, ...picked] };
  if (to === "back") return { ...doc, order: [...picked, ...rest] };
  const order = [...doc.order];
  const dir = to === "up" ? 1 : -1;
  const indices = picked.map((id) => order.indexOf(id)).sort((a, b) => (dir > 0 ? b - a : a - b));
  for (const i of indices) {
    const j = i + dir;
    if (j < 0 || j >= order.length || set.has(order[j])) continue;
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...doc, order };
}

/** Put one node at a given place in the stack (for dragging in the layers list). */
export function moveToIndex(doc: Doc, id: string, index: number): Doc {
  const order = doc.order.filter((x) => x !== id);
  order.splice(Math.max(0, Math.min(order.length, index)), 0, id);
  return { ...doc, order };
}

/** A function that gives each group tag a new one, the same new one every time it is asked for the same tag. */
function groupRetagger() {
  const tags = new Map<string, string>();
  return (group?: string): string | undefined => {
    if (!group) return undefined;
    return group
      .split("/")
      .map((t) => {
        if (!tags.has(t)) tags.set(t, newId("g"));
        return tags.get(t)!;
      })
      .join("/");
  };
}

/** Copies of nodes, with their groups made into new groups of the copies: a copy of a group is a group, not a member of the original. */
export function retagGroups<T extends { group?: string }>(copies: T[]): T[] {
  const retag = groupRetagger();
  return copies.map((c) => {
    const group = retag(c.group);
    return group ? { ...c, group } : c;
  });
}

export function duplicateNodes(doc: Doc, ids: string[], offset = 16): { doc: Doc; ids: string[] } {
  let next = doc;
  const made: string[] = [];
  const retag = groupRetagger();
  for (const id of doc.order.filter((x) => ids.includes(x))) {
    const n = doc.nodes[id];
    const group = retag(n.group);
    const copy = { ...n, id: newId(), name: `${n.name} copy`, x: n.x + offset, y: n.y + offset, ...(group ? { group } : {}) } as Node;
    next = addNode(next, copy);
    made.push(copy.id);
  }
  return { doc: next, ids: made };
}

// --- Groups ------------------------------------------------------------------------------------
//
// A node's `group` is the chain of groups it is in, outermost first: "g1/g2". Working inside a group
// ("entering" it, as Illustrator's isolation mode does) is a scope: the chain of the group entered,
// "" at the top level. Selecting, grouping and ungrouping all act on one level — the one below the scope.

const chainOf = (n: Node | undefined): string[] => (n?.group ? n.group.split("/") : []);
const startsWith = (chain: string[], prefix: string[]) => prefix.every((t, i) => chain[i] === t);

/**
 * The group (as a chain) that clicking `id` selects when working in `scope`: the one level below the
 * scope, or null if the object is not in any group at that level (it is itself the thing to select).
 */
export function groupAt(doc: Doc, id: string, scope = ""): string[] | null {
  const chain = chainOf(doc.nodes[id]);
  const sc = scope ? scope.split("/") : [];
  if (!startsWith(chain, sc) || chain.length <= sc.length) return null;
  return chain.slice(0, sc.length + 1);
}

/** Everything in the groups that any of `ids` belong to, at the level of `scope`, plus `ids` themselves, in stack order. */
export function expandGroups(doc: Doc, ids: string[], scope = ""): string[] {
  const groups = ids.map((id) => groupAt(doc, id, scope)).filter((g): g is string[] => !!g);
  if (groups.length === 0) return ids;
  const out = new Set(ids);
  for (const id of doc.order) {
    const chain = chainOf(doc.nodes[id]);
    if (groups.some((g) => startsWith(chain, g))) out.add(id);
  }
  return doc.order.filter((id) => out.has(id));
}

/** Whether a group (by its chain, e.g. "g1/g2") still has any members. */
export const groupExists = (doc: Doc, scope: string) => !scope || doc.order.some((id) => doc.nodes[id]?.group && (doc.nodes[id].group === scope || doc.nodes[id].group!.startsWith(scope + "/")));

/**
 * Group the objects: they are brought together in the stack at the place of the topmost of them,
 * keeping their order, and share a new group. Objects that are already in groups keep them, so
 * grouping a group with something else nests it. Inside an entered group the new group is made inside it.
 */
export function groupNodes(doc: Doc, ids: string[], scope = ""): { doc: Doc; tag: string } | null {
  const picked = expandGroups(doc, ids, scope).filter((id) => doc.nodes[id] && !doc.nodes[id].locked);
  // Two members of one group are one thing at this level, not two.
  const units = new Set(picked.map((id) => groupAt(doc, id, scope)?.join("/") ?? `#${id}`));
  if (units.size < 2) return null;
  const tag = newId("g");
  const sc = scope ? scope.split("/") : [];
  const set = new Set(picked);
  const topIndex = Math.max(...picked.map((id) => doc.order.indexOf(id)));
  // Everything below the topmost member stays below the group.
  const below = doc.order.slice(0, topIndex + 1).filter((id) => !set.has(id));
  const above = doc.order.slice(topIndex + 1).filter((id) => !set.has(id));
  const members = doc.order.filter((id) => set.has(id));
  const nodes = { ...doc.nodes };
  for (const id of members) {
    const chain = chainOf(nodes[id]);
    nodes[id] = { ...nodes[id], group: [...chain.slice(0, sc.length), tag, ...chain.slice(sc.length)].join("/") } as Node;
  }
  return { doc: { ...doc, nodes, order: [...below, ...members, ...above] }, tag };
}

/** Dissolve, one level down, the groups any of `ids` belong to at the level of `scope`. What was nested in them stays grouped. */
export function ungroupNodes(doc: Doc, ids: string[], scope = ""): Doc {
  const groups = ids.map((id) => groupAt(doc, id, scope)).filter((g): g is string[] => !!g);
  if (groups.length === 0) return doc;
  const depth = scope ? scope.split("/").length : 0;
  const nodes = { ...doc.nodes };
  for (const id of doc.order) {
    const chain = chainOf(nodes[id]);
    if (!groups.some((g) => startsWith(chain, g))) continue;
    const rest = [...chain.slice(0, depth), ...chain.slice(depth + 1)];
    const { group: _g, ...plain } = nodes[id];
    void _g;
    nodes[id] = (rest.length ? { ...plain, group: rest.join("/") } : plain) as Node;
  }
  return { ...doc, nodes };
}

/** Replace nodes with one: it takes the place of the topmost, and the group they all shared, if any. */
export function replaceNodes(doc: Doc, ids: string[], replacement: Node | Node[]): Doc {
  const list = Array.isArray(replacement) ? replacement : [replacement];
  const gone = new Set(ids);
  const topIndex = Math.max(...ids.map((id) => doc.order.indexOf(id)));
  const before = doc.order.slice(0, topIndex + 1).filter((id) => !gone.has(id));
  const after = doc.order.slice(topIndex + 1).filter((id) => !gone.has(id));
  const nodes = { ...doc.nodes };
  for (const id of gone) delete nodes[id];
  for (const n of list) nodes[n.id] = n;
  return tidyGroups({ ...doc, nodes, order: [...before, ...list.map((n) => n.id), ...after] });
}

// --- Ruler guides ------------------------------------------------------------------------------

export type GuideAxis = "x" | "y";

const NO_GUIDES: DocGuides = { x: [], y: [] };
export const guidesOf = (doc: Doc): DocGuides => doc.guides ?? NO_GUIDES;
export const guideCount = (doc: Doc) => guidesOf(doc).x.length + guidesOf(doc).y.length;

/** The document with these guides; none at all drops the field rather than keeping an empty one. */
function withGuides(doc: Doc, guides: DocGuides): Doc {
  if (guides.x.length === 0 && guides.y.length === 0) {
    if (!doc.guides) return doc;
    const { guides: _gone, ...rest } = doc;
    void _gone;
    return rest;
  }
  return { ...doc, guides };
}

/** Put a guide on an axis. `index` of null adds a new one; otherwise that guide is moved. Near-duplicates collapse. */
export function setGuide(doc: Doc, axis: GuideAxis, index: number | null, position: number): Doc {
  const g = guidesOf(doc);
  const list = [...g[axis]];
  const at = round(position);
  if (index === null) list.push(at);
  else if (index >= 0 && index < list.length) list[index] = at;
  else return doc;
  return withGuides(doc, { ...g, [axis]: [...new Set(list)] });
}

export function removeGuide(doc: Doc, axis: GuideAxis, index: number): Doc {
  const g = guidesOf(doc);
  if (index < 0 || index >= g[axis].length) return doc;
  return withGuides(doc, { ...g, [axis]: g[axis].filter((_, i) => i !== index) });
}

export const clearGuides = (doc: Doc): Doc => withGuides(doc, NO_GUIDES);

export const round = (n: number, places = 2) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

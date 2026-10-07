import type { Doc, DocKind, Node, NodeType, ShapeNode, TextNode } from "./types";

/** The size each kind of design is drawn at. The numbers are only a unit: what
 * matters is the proportions, and that everything compiles to percentages. */
export const ARTBOARDS: Record<DocKind, { w: number; h: number }> = {
  // The avatar is the whole artboard; art may reach past it, within the margin.
  decoration: { w: 400, h: 400 },
  // A profile card, drawn at a typical height. Stickers are placed from its top edge.
  sticker: { w: 300, h: 400 },
  scene: { w: 1600, h: 900 },
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
  return { ...doc, nodes, order: doc.order.filter((id) => !gone.has(id)) };
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

export function duplicateNodes(doc: Doc, ids: string[], offset = 16): { doc: Doc; ids: string[] } {
  let next = doc;
  const made: string[] = [];
  for (const id of doc.order.filter((x) => ids.includes(x))) {
    const n = doc.nodes[id];
    const copy = { ...n, id: newId(), name: `${n.name} copy`, x: n.x + offset, y: n.y + offset } as Node;
    next = addNode(next, copy);
    made.push(copy.id);
  }
  return { doc: next, ids: made };
}

export const round = (n: number, places = 2) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

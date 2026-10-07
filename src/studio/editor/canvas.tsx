"use client";

import { Armchair, Tv } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { PROP_ASPECT, ScenePropView } from "@/components/lounge/lounge-props";
import { addNode, boundsOf, centre, duplicateNodes, makeSceneObject, makeShape, makeText, newId, nodesInOrder, patchNodes, removeNodes, reorder, round, unionBounds } from "@/studio/model/doc";
import type { Doc, Node, PropNode, TextNode } from "@/studio/model/types";
import type { DocEditor, Tool } from "@/studio/editor/use-doc-editor";
import {
  HANDLES,
  angleTo,
  intersects,
  normaliseAngle,
  normalisedRect,
  resizeNode,
  snapMove,
  type Guides,
  type Handle,
  type Rect,
} from "@/studio/editor/geometry";
import type { LoadedAsset } from "@/studio/storage/assets";
import { cn } from "@/lib/utils";

const SNAP_PX = 6;
const HANDLE_PX = 9;
const ROTATE_OFFSET_PX = 26;

type Drag =
  | { kind: "pan"; startX: number; startY: number; panX: number; panY: number }
  | { kind: "move"; start: { x: number; y: number }; orig: Map<string, { x: number; y: number }>; moved: boolean; clickedId: string; shift: boolean }
  | { kind: "resize"; handle: Handle; orig: Node; lock: boolean }
  | { kind: "rotate"; orig: Node }
  | { kind: "marquee"; start: { x: number; y: number }; base: string[] }
  | { kind: "create"; tool: Tool; start: { x: number; y: number } };

// --- A node, drawn --------------------------------------------------------------------------------

function NodeView({ node, assets, doc }: { node: Node; assets: Map<string, LoadedAsset>; doc: Doc }) {
  const box: React.CSSProperties = {
    position: "absolute",
    left: node.x,
    top: node.y,
    width: node.w,
    height: node.h,
    transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
    opacity: node.opacity,
  };
  const common = { "data-node-id": node.id } as const;

  switch (node.type) {
    case "image": {
      const a = assets.get(node.assetId);
      return (
        <div {...common} style={box}>
          {a && a.type.startsWith("video/") ? (
            <video src={a.url} autoPlay loop muted playsInline className="pointer-events-none size-full select-none" style={{ objectFit: node.role === "background" ? "cover" : "fill" }} />
          ) : a ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.url} alt="" draggable={false} className="pointer-events-none size-full select-none" style={{ objectFit: "fill" }} />
          ) : (
            <div className="flex size-full items-center justify-center border border-dashed border-red-400 bg-red-500/10 text-[10px] text-red-300">missing</div>
          )}
        </div>
      );
    }
    case "shape":
      return (
        <div
          {...common}
          style={{
            ...box,
            background: node.fill,
            borderRadius: node.shape === "ellipse" ? "50%" : node.radius,
            boxSizing: "border-box",
            border: node.strokeWidth > 0 ? `${node.strokeWidth}px solid ${node.stroke}` : undefined,
          }}
        />
      );
    case "text":
      return (
        <div
          {...common}
          style={{
            ...box,
            color: node.color,
            fontSize: node.fontSize,
            fontWeight: node.fontWeight,
            fontStyle: node.italic ? "italic" : "normal",
            textAlign: node.align,
            lineHeight: 1.15,
            whiteSpace: "pre-wrap",
            overflow: "visible",
            WebkitTextStroke: node.strokeWidth > 0 ? `${node.strokeWidth}px ${node.stroke}` : undefined,
            paintOrder: "stroke fill",
          }}
        >
          {node.text}
        </div>
      );
    case "screen":
      return (
        <div {...common} style={box} className="flex flex-col items-center justify-center gap-1 rounded-sm border-2 border-sky-400/80 bg-black/70 text-sky-200">
          <Tv style={{ width: Math.min(node.w, node.h) * 0.3, height: Math.min(node.w, node.h) * 0.3 }} />
          <span style={{ fontSize: Math.min(node.w, node.h) * 0.08 }} className="font-mono tracking-wide">
            STREAM SCREEN
          </span>
        </div>
      );
    case "seat":
      return (
        <div {...common} style={box} className="flex items-center justify-center rounded-full border-2 border-dashed border-emerald-300 bg-emerald-400/15 text-emerald-200">
          <Armchair style={{ width: node.w * 0.55, height: node.w * 0.55 }} />
        </div>
      );
    case "prop":
      return (
        <div {...common} style={box} className={cn("outline outline-1 outline-dashed outline-white/20", node.hidden && "hidden")}>
          <div className="pointer-events-none absolute inset-0">
            <ScenePropView
              prop={{ id: node.id, kind: node.prop, x: 50, y: 100, size: 100, interactive: false, on: node.on }}
              on={node.on}
              onToggle={() => {}}
              disabled
            />
          </div>
        </div>
      );
    case "floor":
      return (
        <div {...common} style={{ ...box, height: Math.max(node.h, 4) }} className="bg-amber-400/80">
          <span className="absolute -top-6 left-2 rounded bg-amber-400 px-1.5 text-[13px] font-semibold text-black">
            floor
          </span>
          <div className="absolute inset-x-0 top-full h-[600px] bg-gradient-to-b from-amber-400/10 to-transparent" />
        </div>
      );
  }
  void doc;
}

// --- The artboard behind the nodes ---------------------------------------------------------------

function Backdrop({ doc, avatarUrl }: { doc: Doc; avatarUrl?: string }) {
  const { w, h } = doc.artboard;
  if (doc.kind === "decoration") {
    const m = w * 0.3;
    return (
      <>
        <div className="absolute rounded-[28px] bg-[conic-gradient(#2a2a30_25%,#222228_0_50%,#2a2a30_0_75%,#222228_0)] [background-size:40px_40px]" style={{ left: -m, top: -m, width: w + m * 2, height: h + m * 2 }} />
        <div className="absolute rounded-full bg-neutral-700 shadow-2xl" style={{ left: 0, top: 0, width: w, height: h, overflow: "hidden" }}>
          {avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" draggable={false} className="size-full object-cover" />
          )}
        </div>
        <div className="pointer-events-none absolute rounded-[28px] border border-dashed border-white/35" style={{ left: -m, top: -m, width: w + m * 2, height: h + m * 2 }} />
      </>
    );
  }
  if (doc.kind === "sticker") {
    return (
      <div className="absolute overflow-hidden rounded-2xl bg-neutral-800 shadow-2xl" style={{ width: w, height: h }}>
        <div className="h-[28%] bg-gradient-to-br from-violet-500/50 to-sky-500/40" />
        <div className="absolute rounded-full border-4 border-neutral-800 bg-neutral-600" style={{ left: 20, top: h * 0.28 - 36, width: 72, height: 72, overflow: "hidden" }}>
          {avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" draggable={false} className="size-full object-cover" />
          )}
        </div>
        <div className="absolute space-y-2" style={{ left: 20, top: h * 0.28 + 48, right: 20 }}>
          <div className="h-3.5 w-28 rounded bg-white/70" />
          <div className="h-2.5 w-20 rounded bg-white/25" />
          <div className="mt-4 h-2.5 w-full rounded bg-white/15" />
          <div className="h-2.5 w-4/5 rounded bg-white/15" />
        </div>
      </div>
    );
  }
  // A scene: the room is whatever the creator puts in it.
  return <div className="absolute bg-neutral-900 shadow-2xl" style={{ width: w, height: h }} />;
}

// --- The canvas -----------------------------------------------------------------------------------

export function Canvas({
  editor,
  assets,
  avatarUrl,
  onDropFiles,
}: {
  editor: DocEditor;
  assets: Map<string, LoadedAsset>;
  avatarUrl?: string;
  onDropFiles?: (files: File[], at: { x: number; y: number }) => void;
}) {
  const { doc, commit, selection, setSelection, tool, setTool } = editor;
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [fitted, setFitted] = useState(false);
  const [guides, setGuides] = useState<Guides>({ x: [], y: [] });
  const [ghost, setGhost] = useState<Rect | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const drag = useRef<Drag | null>(null);
  const clipboard = useRef<Node[]>([]);
  const viewRef = useRef(view);
  viewRef.current = view;
  const docRef = useRef(doc);
  docRef.current = doc;

  // --- fit -----------------------------------------------------------------------------------
  const m = doc.kind === "decoration" ? doc.artboard.w * 0.3 : 0;
  const fit = useCallback(() => {
    if (size.w === 0) return;
    const pad = 56;
    const cw = doc.artboard.w + m * 2;
    const ch = doc.artboard.h + m * 2;
    const zoom = Math.max(0.05, Math.min((size.w - pad * 2) / cw, (size.h - pad * 2) / ch, 4));
    setView({ zoom, x: (size.w - doc.artboard.w * zoom) / 2, y: (size.h - doc.artboard.h * zoom) / 2 });
  }, [size, doc.artboard.w, doc.artboard.h, m]);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!fitted && size.w > 0) {
      fit();
      setFitted(true);
    }
  }, [fitted, size, fit]);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = viewport.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - rect.left - v.x) / v.zoom, y: (clientY - rect.top - v.y) / v.zoom };
  }, []);

  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    setView((v) => {
      const zoom = Math.max(0.05, Math.min(8, v.zoom * factor));
      const k = zoom / v.zoom;
      return { zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }, []);

  // Wheel: pinch / ctrl to zoom, otherwise pan. Native so it can be non-passive.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // --- selection helpers ------------------------------------------------------------------------
  const selected = useMemo(() => selection.map((id) => doc.nodes[id]).filter(Boolean) as Node[], [selection, doc]);
  const single = selected.length === 1 ? selected[0] : null;
  const selBounds = useMemo(() => unionBounds(selected), [selected]);

  // --- creating ---------------------------------------------------------------------------------
  const place = useCallback(
    (t: Tool, area: Rect | null, at: { x: number; y: number }) => {
      const d = docRef.current;
      const dragged = area && area.w > 6 && area.h > 6;
      let node: Node | null = null;
      if (t === "rect" || t === "ellipse") {
        const a = dragged ? area! : { x: at.x - 60, y: at.y - 60, w: 120, h: 120 };
        node = makeShape(t, a.x, a.y, a.w, a.h);
      } else if (t === "text") {
        const text = makeText(at.x - 80, at.y - 24);
        node = dragged ? { ...text, x: area!.x, y: area!.y, w: area!.w, h: Math.max(area!.h, 24) } : text;
      } else if (t === "screen") {
        const existing = nodesInOrder(d).find((n) => n.type === "screen");
        if (existing) return setSelection([existing.id]);
        node = makeSceneObject("screen", d.artboard);
        if (dragged) node = { ...node, x: area!.x, y: area!.y, w: area!.w, h: area!.h };
      } else if (t === "floor") {
        const existing = nodesInOrder(d).find((n) => n.type === "floor");
        if (existing) return setSelection([existing.id]);
        node = { ...makeSceneObject("floor", d.artboard), y: at.y - 2 };
      } else if (t === "seat") {
        node = makeSceneObject("seat", d.artboard, at);
      } else if (typeof t === "string" && t.startsWith("prop:")) {
        const kind = t.slice(5) as PropNode["prop"];
        const w = d.artboard.w * 0.08;
        node = {
          id: newId(),
          name: kind[0].toUpperCase() + kind.slice(1),
          type: "prop",
          prop: kind,
          interactive: kind === "fire" || kind === "lamp" || kind === "neon" || kind === "discoball",
          on: true,
          x: at.x - w / 2,
          y: at.y - w / PROP_ASPECT[kind],
          w,
          h: w / PROP_ASPECT[kind],
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
        };
      }
      if (!node) return;
      commit((cur) => addNode(cur, node!), `create-${node.id}`);
      setSelection([node.id]);
      setTool("select");
    },
    [commit, setSelection, setTool],
  );

  // --- pointer ----------------------------------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    const el = viewport.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const world = toWorld(e.clientX, e.clientY);

    if (e.button === 1 || tool === "hand" || spaceDown) {
      drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, panX: view.x, panY: view.y };
      return;
    }
    if (e.button !== 0) return;

    if (tool !== "select") {
      drag.current = { kind: "create", tool, start: world };
      return;
    }

    const handleId = (e.target as HTMLElement).closest("[data-handle]")?.getAttribute("data-handle");
    if (handleId && single) {
      if (handleId === "rotate") drag.current = { kind: "rotate", orig: single };
      else {
        const lock = single.type === "image" || single.type === "prop" || single.type === "seat" ? !e.shiftKey : e.shiftKey;
        drag.current = { kind: "resize", handle: handleId as Handle, orig: single, lock };
      }
      return;
    }

    const hitId = (e.target as HTMLElement).closest("[data-node-id]")?.getAttribute("data-node-id");
    const hit = hitId ? doc.nodes[hitId] : null;
    if (hit && !hit.locked) {
      let ids = selection.includes(hit.id) ? selection : e.shiftKey ? [...selection, hit.id] : [hit.id];
      let working = doc;
      // Alt-drag takes a copy along and leaves the original where it was.
      if (e.altKey) {
        const dup = duplicateNodes(doc, ids, 0);
        working = dup.doc;
        commit(dup.doc, "duplicate");
        ids = dup.ids;
      }
      setSelection(ids);
      drag.current = {
        kind: "move",
        start: world,
        orig: new Map(ids.map((id) => [id, { x: working.nodes[id].x, y: working.nodes[id].y }])),
        moved: false,
        clickedId: hit.id,
        shift: e.shiftKey,
      };
      return;
    }
    // Empty space: a marquee, which keeps the selection only with shift.
    drag.current = { kind: "marquee", start: world, base: e.shiftKey ? selection : [] };
    if (!e.shiftKey) setSelection([]);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const world = toWorld(e.clientX, e.clientY);
    const zoom = viewRef.current.zoom;

    if (d.kind === "pan") {
      setView((v) => ({ ...v, x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) }));
    } else if (d.kind === "create") {
      setGhost(normalisedRect(d.start, world));
    } else if (d.kind === "marquee") {
      const r = normalisedRect(d.start, world);
      setMarquee(r);
      const hits = nodesInOrder(docRef.current)
        .filter((n) => !n.locked && !n.hidden && intersects(boundsOf(n), r))
        .map((n) => n.id);
      setSelection([...new Set([...d.base, ...hits])]);
    } else if (d.kind === "move") {
      let dx = world.x - d.start.x;
      let dy = world.y - d.start.y;
      if (!d.moved && Math.hypot(dx, dy) * zoom < 3) return;
      d.moved = true;
      if (e.shiftKey) {
        // Along one axis only.
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const current = docRef.current;
      const ids = [...d.orig.keys()];
      const origNodes = ids.map((id) => ({ ...current.nodes[id], ...d.orig.get(id)! }) as Node);
      const box = unionBounds(origNodes);
      let guidesNow: Guides = { x: [], y: [] };
      if (box && !e.ctrlKey && !e.metaKey) {
        const snap = snapMove({ ...box, x: box.x + dx, y: box.y + dy }, current, new Set(ids), SNAP_PX / zoom);
        dx += snap.dx;
        dy += snap.dy;
        guidesNow = snap.guides;
      }
      setGuides(guidesNow);
      commit(
        (cur) =>
          patchNodes(cur, ids, (n) => {
            const o = d.orig.get(n.id)!;
            // The floor is a line across the room: it only goes up and down.
            return n.type === "floor" ? { y: round(o.y + dy) } : { x: round(o.x + dx), y: round(o.y + dy) };
          }),
        "move",
      );
    } else if (d.kind === "resize") {
      const o = d.orig;
      let r = resizeNode(o, d.handle, world, d.lock);
      // Snap the dragged edge to artboard edges close by, for a clean fit.
      const t = SNAP_PX / zoom;
      if (!o.rotation) {
        const a = docRef.current.artboard;
        const snapTo = (v: number, lines: number[]) => lines.find((l) => Math.abs(l - v) < t) ?? v;
        if (d.handle.includes("e")) r = { ...r, w: snapTo(r.x + r.w, [0, a.w / 2, a.w]) - r.x };
        if (d.handle.includes("w")) {
          const nx = snapTo(r.x, [0, a.w / 2, a.w]);
          r = { ...r, w: r.w + (r.x - nx), x: nx };
        }
        if (d.handle.includes("s")) r = { ...r, h: snapTo(r.y + r.h, [0, a.h / 2, a.h]) - r.y };
        if (d.handle.includes("n")) {
          const ny = snapTo(r.y, [0, a.h / 2, a.h]);
          r = { ...r, h: r.h + (r.y - ny), y: ny };
        }
      }
      commit(
        (cur) =>
          patchNodes(cur, [o.id], () => {
            const patch: Partial<Node> = { x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) };
            if (o.type === "text" && d.handle.length === 2) (patch as Partial<TextNode>).fontSize = round((o as TextNode).fontSize * (r.h / o.h));
            return patch;
          }),
        "resize",
      );
    } else if (d.kind === "rotate") {
      const c = centre(d.orig);
      let a = angleTo(c, world);
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      else {
        // A little pull towards the right angles.
        const near = Math.round(a / 45) * 45;
        if (Math.abs(near - a) < 3) a = near;
      }
      commit((cur) => patchNodes(cur, [d.orig.id], { rotation: normaliseAngle(a) }), "rotate");
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    viewport.current?.releasePointerCapture(e.pointerId);
    setGuides({ x: [], y: [] });
    setMarquee(null);
    if (!d) return;
    if (d.kind === "create") {
      const world = toWorld(e.clientX, e.clientY);
      place(d.tool, ghost, world);
      setGhost(null);
    } else if (d.kind === "move" && !d.moved && !d.shift) {
      // A click on something already selected narrows to it.
      setSelection([d.clickedId]);
    } else if (d.kind === "move" && !d.moved && d.shift && selection.includes(d.clickedId) && selection.length > 1) {
      setSelection(selection.filter((id) => id !== d.clickedId));
    }
  };

  // --- keyboard ---------------------------------------------------------------------------------
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const mod = e.metaKey || e.ctrlKey;
      const ids = selection;
      if (e.code === "Space") {
        setSpaceDown(true);
        e.preventDefault();
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        editor.redo();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(docRef.current.order.filter((id) => !docRef.current.nodes[id].locked));
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (ids.length) {
          const dup = duplicateNodes(docRef.current, ids);
          commit(dup.doc);
          setSelection(dup.ids);
        }
      } else if (mod && e.key.toLowerCase() === "c") {
        clipboard.current = ids.map((id) => docRef.current.nodes[id]).filter(Boolean);
      } else if (mod && e.key.toLowerCase() === "v") {
        if (clipboard.current.length) {
          e.preventDefault();
          let next = docRef.current;
          const made: string[] = [];
          for (const n of clipboard.current) {
            if (n.type === "screen" || n.type === "floor") continue;
            const copy = { ...n, id: newId(), x: n.x + 20, y: n.y + 20 } as Node;
            next = addNode(next, copy);
            made.push(copy.id);
          }
          commit(next);
          setSelection(made);
        }
      } else if (mod && e.key === "0") {
        e.preventDefault();
        fit();
      } else if (mod && e.key === "1") {
        e.preventDefault();
        zoomAt(1 / viewRef.current.zoom, size.w / 2, size.h / 2);
      } else if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        zoomAt(1.25, size.w / 2, size.h / 2);
      } else if (mod && e.key === "-") {
        e.preventDefault();
        zoomAt(0.8, size.w / 2, size.h / 2);
      } else if ((e.key === "Delete" || e.key === "Backspace") && ids.length) {
        e.preventDefault();
        commit(removeNodes(docRef.current, ids.filter((id) => !docRef.current.nodes[id]?.locked)));
        setSelection([]);
      } else if (e.key.startsWith("Arrow") && ids.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        commit((cur) => patchNodes(cur, ids, (n) => (n.type === "floor" ? { y: n.y + dy } : { x: n.x + dx, y: n.y + dy })), "nudge");
      } else if (!mod && e.key === "]") commit(reorder(docRef.current, ids, e.shiftKey ? "front" : "up"));
      else if (!mod && e.key === "[") commit(reorder(docRef.current, ids, e.shiftKey ? "back" : "down"));
      else if (!mod && !e.altKey) {
        const map: Record<string, Tool> = { v: "select", h: "hand", r: "rect", o: "ellipse", t: "text" };
        const next = map[e.key.toLowerCase()];
        if (next) setTool(next);
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceDown(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [selection, editor, commit, setSelection, setTool, fit, zoomAt, size]);

  // --- dropping files -----------------------------------------------------------------------------
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length && onDropFiles) onDropFiles(files, toWorld(e.clientX, e.clientY));
  };

  const hs = HANDLE_PX / view.zoom;
  const lineW = 1 / view.zoom;
  const cursor = spaceDown || tool === "hand" ? (drag.current?.kind === "pan" ? "grabbing" : "grab") : tool !== "select" ? "crosshair" : "default";
  const showResize = single && !single.locked && single.type !== "floor";
  const cornersOnly = single?.type === "prop" || single?.type === "seat";

  return (
    <div
      ref={viewport}
      className="relative size-full touch-none overflow-hidden bg-[#141418] select-none"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="absolute top-0 left-0" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: "0 0", width: doc.artboard.w, height: doc.artboard.h }}>
        <Backdrop doc={doc} avatarUrl={avatarUrl} />
        {doc.order.map((id) => {
          const n = doc.nodes[id];
          return n && !n.hidden ? <NodeView key={id} node={n} assets={assets} doc={doc} /> : null;
        })}

        {/* The artboard's own edge. */}
        <div className="pointer-events-none absolute border border-sky-400/50" style={{ left: 0, top: 0, width: doc.artboard.w, height: doc.artboard.h, borderWidth: lineW }} />

        {/* Hover/selection outlines. */}
        {selected.map((n) => (
          <div key={n.id} className="pointer-events-none absolute border-sky-400" style={{ left: n.x, top: n.y, width: n.w, height: n.h, transform: n.rotation ? `rotate(${n.rotation}deg)` : undefined, borderWidth: lineW * 1.5, borderStyle: "solid" }} />
        ))}
        {selected.length > 1 && selBounds && (
          <div className="pointer-events-none absolute border-sky-400/60" style={{ left: selBounds.x, top: selBounds.y, width: selBounds.w, height: selBounds.h, borderWidth: lineW, borderStyle: "dashed" }} />
        )}

        {/* Handles for a single node. */}
        {showResize && single && (
          <div className="pointer-events-none absolute" style={{ left: single.x, top: single.y, width: single.w, height: single.h, transform: single.rotation ? `rotate(${single.rotation}deg)` : undefined }}>
            {HANDLES.filter((h) => !cornersOnly || (h.hx !== 0 && h.hy !== 0)).map((h) => (
              <div
                key={h.id}
                data-handle={h.id}
                className="pointer-events-auto absolute border-sky-500 bg-white"
                style={{
                  left: `${(h.hx + 1) * 50}%`,
                  top: `${(h.hy + 1) * 50}%`,
                  width: hs,
                  height: hs,
                  marginLeft: -hs / 2,
                  marginTop: -hs / 2,
                  borderWidth: lineW * 1.5,
                  borderStyle: "solid",
                  cursor: h.cursor,
                  borderRadius: 1 / view.zoom,
                }}
              />
            ))}
            <div className="absolute bg-sky-400/70" style={{ left: "50%", top: -(ROTATE_OFFSET_PX / view.zoom), width: lineW, height: ROTATE_OFFSET_PX / view.zoom, marginLeft: -lineW / 2 }} />
            <div
              data-handle="rotate"
              className="pointer-events-auto absolute rounded-full border-sky-500 bg-white"
              style={{ left: "50%", top: -(ROTATE_OFFSET_PX / view.zoom), width: hs, height: hs, marginLeft: -hs / 2, marginTop: -hs / 2, borderWidth: lineW * 1.5, borderStyle: "solid", cursor: "grab" }}
            />
          </div>
        )}

        {/* Snap guides. */}
        {guides.x.map((x) => (
          <div key={`gx${x}`} className="pointer-events-none absolute bg-pink-500" style={{ left: x, top: -2000, width: lineW, height: doc.artboard.h + 4000 }} />
        ))}
        {guides.y.map((y) => (
          <div key={`gy${y}`} className="pointer-events-none absolute bg-pink-500" style={{ top: y, left: -2000, height: lineW, width: doc.artboard.w + 4000 }} />
        ))}

        {ghost && <div className="pointer-events-none absolute border-sky-400 bg-sky-400/10" style={{ left: ghost.x, top: ghost.y, width: ghost.w, height: ghost.h, borderWidth: lineW, borderStyle: "solid" }} />}
        {marquee && <div className="pointer-events-none absolute border-sky-400 bg-sky-400/10" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, borderWidth: lineW, borderStyle: "solid" }} />}
      </div>

      <div className="pointer-events-none absolute right-3 bottom-3 rounded-md bg-black/60 px-2 py-1 font-mono text-[11px] text-white/70">{Math.round(view.zoom * 100)}%</div>
    </div>
  );
}

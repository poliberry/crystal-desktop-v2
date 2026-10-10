"use client";

import { Armchair, Tv } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { PROP_ASPECT, ScenePropView } from "@/components/lounge/lounge-props";
import { defaultBrush, fitFreehand } from "@/studio/model/brush";
import { addNode, boundsOf, centre, duplicateNodes, expandGroups, groupAt, guidesOf, makeLine, makePathFromWorld, makeSceneObject, makeShape, makeShapePath, makeText, newId, nodesInOrder, patchNodes, removeGuide, round, setGuide, unionBounds, type GuideAxis } from "@/studio/model/doc";
import { insertAnchor, isSmooth, localToWorld, moveAnchors, moveHandle, nearestOnPath, pathD, refit, removeAnchors, toLocal, toggleSmooth, worldToLocal } from "@/studio/model/path";
import { dragScale, oppositeAnchor, rotateNodes, scaleNodes } from "@/studio/model/transform";
import type { Doc, Node, PathNode, PathPoint, PropNode, TextNode } from "@/studio/model/types";
import type { DocEditor, Tool } from "@/studio/editor/use-doc-editor";
import {
  HANDLES,
  angleTo,
  intersects,
  normaliseAngle,
  normalisedRect,
  resizeNode,
  snapLines,
  snapMove,
  snapScalar,
  viewForRect,
  type Guides,
  type Handle,
  type Rect,
  type SnapOptions,
} from "@/studio/editor/geometry";
import { FxView } from "@/studio/editor/fx-view";
import { hasFx } from "@/studio/model/fx";
import * as A from "@/studio/editor/actions";
import { toolForKey } from "@/studio/editor/tools";
import { RULER_SIZE, Ruler, RulerCorner } from "@/studio/editor/rulers";
import { defaultGridSize, type SetViewPrefs, type ViewPrefs } from "@/studio/editor/view-prefs";
import type { ViewCommands } from "@/studio/editor/view-menu";
import type { LoadedAsset } from "@/studio/storage/assets";
import { cn } from "@/lib/utils";

const SNAP_PX = 6;
const HANDLE_PX = 7;
const ROTATE_OFFSET_PX = 26;
/** How far a guide line reaches either side of the artboard, in document units. */
const GUIDE_REACH = 50_000;
/** A click on a guide lands within this many screen pixels of it. */
const GUIDE_GRAB_PX = 5;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;

/** The guide being dragged: a new one from a ruler, or an existing one picked up. */
interface GuideDrag {
  axis: GuideAxis;
  /** Which of the document's guides this is, or null for a new one. */
  index: number | null;
  position: number;
  /** Over the ruler it came from, so letting go would delete it. */
  discard: boolean;
}

type Drag =
  | { kind: "pan"; startX: number; startY: number; panX: number; panY: number }
  | { kind: "move"; start: { x: number; y: number }; orig: Map<string, { x: number; y: number }>; moved: boolean; clickedId: string; shift: boolean }
  | { kind: "resize"; handle: Handle; orig: Node; lock: boolean }
  | { kind: "rotate"; orig: Node }
  | { kind: "marquee"; start: { x: number; y: number }; base: string[] }
  | { kind: "create"; tool: Tool; start: { x: number; y: number } }
  | { kind: "guide"; axis: GuideAxis; index: number | null }
  | { kind: "scale"; hx: -1 | 0 | 1; hy: -1 | 0 | 1; box: { x: number; y: number; w: number; h: number }; anchor: { x: number; y: number }; orig: Node[] }
  | { kind: "spin"; pivot: { x: number; y: number }; start: number; orig: Node[] }
  | { kind: "anchor"; orig: PathNode; local: PathPoint[]; from: { x: number; y: number }; indices: Set<number>; moved: boolean }
  | { kind: "handle"; orig: PathNode; local: PathPoint[]; index: number; which: "in" | "out" }
  | { kind: "pen" }
  | { kind: "brush" }
  | { kind: "zoom"; start: { x: number; y: number }; alt: boolean; client: { x: number; y: number } };

/** `b` moved onto the nearest multiple of 45° from `a`, at the same distance. */
function constrain45(a: { x: number; y: number }, b: { x: number; y: number }) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d };
}

// --- A node, drawn --------------------------------------------------------------------------------

function NodeView({ node, assets, doc, outline, lineW, zoom }: { node: Node; assets: Map<string, LoadedAsset>; doc: Doc; outline: boolean; lineW: number; zoom: number }) {
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

  // Gradients and effects are drawn by the same code that renders them for the store.
  if (!outline && hasFx(node)) return <FxView node={node} assets={assets} zoom={zoom} />;

  // Outline view: the shape of every picture, shape and line of text, none of its paint.
  if (outline && (node.type === "image" || node.type === "shape" || node.type === "text")) {
    return (
      <div
        {...common}
        style={{
          ...box,
          opacity: 1,
          boxSizing: "border-box",
          border: `${lineW}px solid rgba(255,255,255,0.8)`,
          borderRadius: node.type === "shape" ? (node.shape === "ellipse" ? "50%" : node.radius) : 0,
        }}
      />
    );
  }

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
    case "path":
      // Only reached in Outline view; otherwise a path is drawn by FxView.
      return (
        <svg {...common} className="absolute overflow-visible" style={{ left: node.x, top: node.y, width: node.w, height: node.h, transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined }}>
          <path d={pathD(node.points, node.closed, node.w, node.h)} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={lineW} style={{ pointerEvents: "stroke" }} />
        </svg>
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
  prefs,
  setPrefs,
  commands,
  readout,
  onZoom,
  onNotice,
}: {
  editor: DocEditor;
  assets: Map<string, LoadedAsset>;
  avatarUrl?: string;
  onDropFiles?: (files: File[], at: { x: number; y: number }) => void;
  prefs: ViewPrefs;
  setPrefs: SetViewPrefs;
  /** Filled in with this canvas's view commands, for a menu outside it to call. */
  commands: React.RefObject<ViewCommands | null>;
  /** Where the pointer's position is written, as it moves (an element elsewhere in the editor). */
  readout: React.RefObject<HTMLSpanElement | null>;
  /** Told the zoom whenever it changes (1 = 100%). */
  onZoom?: (zoom: number) => void;
  /** Somewhere to say why something couldn't be done. */
  onNotice?: (message: string) => void;
}) {
  const { doc, commit, selection, setSelection, tool, setTool, scope, setScope } = editor;
  const viewport = useRef<HTMLDivElement>(null);
  const topMarker = useRef<HTMLDivElement>(null);
  const leftMarker = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [fitted, setFitted] = useState(false);
  const [guides, setGuides] = useState<Guides>({ x: [], y: [] });
  const [ghost, setGhost] = useState<Rect | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [guideDrag, setGuideDrag] = useState<GuideDrag | null>(null);
  /** The guide last made or picked up, by where it is: what Delete removes when nothing else is selected. */
  const [guideSel, setGuideSel] = useState<{ axis: GuideAxis; position: number } | null>(null);

  /** The Pen's path in progress, in artboard units (handles as absolute positions), and where the pointer is. */
  const [pen, setPen] = useState<PathPoint[]>([]);
  const [penHover, setPenHover] = useState<{ x: number; y: number } | null>(null);
  // The Paintbrush: the pointer's track while the button is down, and the same track as state to draw it.
  const brushRef = useRef<{ x: number; y: number }[]>([]);
  const [brushLive, setBrushLive] = useState<{ x: number; y: number }[] | null>(null);
  const [lineGhost, setLineGhost] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  /** The anchors picked with the Direct Selection tool, by index into the selected path. */
  const [anchors, setAnchors] = useState<number[]>([]);
  const penRef = useRef(pen);
  penRef.current = pen;
  const drag = useRef<Drag | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const docRef = useRef(doc);
  docRef.current = doc;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const inset = prefs.rulers ? RULER_SIZE : 0;
  const gridSize = prefs.gridSize ?? defaultGridSize(doc.kind);
  /** What a dragged edge or object may snap to. */
  const snapOpts = useCallback(
    (): SnapOptions => ({ smart: prefsRef.current.smartGuides, guides: prefsRef.current.showGuides, grid: prefsRef.current.snapGrid ? (prefsRef.current.gridSize ?? defaultGridSize(docRef.current.kind)) : null }),
    [],
  );

  // --- fit -----------------------------------------------------------------------------------
  const m = doc.kind === "decoration" ? doc.artboard.w * 0.3 : 0;
  const fit = useCallback(() => {
    if (size.w === 0) return;
    const pad = 56;
    const availW = size.w - inset;
    const availH = size.h - inset;
    const cw = doc.artboard.w + m * 2;
    const ch = doc.artboard.h + m * 2;
    const zoom = Math.max(MIN_ZOOM, Math.min((availW - pad * 2) / cw, (availH - pad * 2) / ch, 4));
    setView({ zoom, x: inset + (availW - doc.artboard.w * zoom) / 2, y: inset + (availH - doc.artboard.h * zoom) / 2 });
  }, [size, inset, doc.artboard.w, doc.artboard.h, m]);

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
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * factor));
      const k = zoom / v.zoom;
      return { zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }, []);

  // Hand the View menu what it needs to move the view.
  useEffect(() => {
    commands.current = {
      fit,
      actualSize: () => zoomAt(1 / viewRef.current.zoom, inset + (size.w - inset) / 2, inset + (size.h - inset) / 2),
      zoomIn: () => zoomAt(1.25, inset + (size.w - inset) / 2, inset + (size.h - inset) / 2),
      zoomOut: () => zoomAt(0.8, inset + (size.w - inset) / 2, inset + (size.h - inset) / 2),
      setZoom: (z) => zoomAt(z / viewRef.current.zoom, inset + (size.w - inset) / 2, inset + (size.h - inset) / 2),
    };
    return () => {
      commands.current = null;
    };
  }, [commands, fit, zoomAt, inset, size]);

  useEffect(() => {
    onZoom?.(view.zoom);
  }, [view.zoom, onZoom]);

  /** Frame a rectangle (document units) in the window. */
  const zoomToRect = useCallback(
    (r: Rect) => {
      // Centred within the space right of and below the rulers, so the inset is added back.
      const v = viewForRect(r, { w: size.w - inset, h: size.h - inset }, 24, MIN_ZOOM, MAX_ZOOM);
      setView({ zoom: v.zoom, x: v.x + inset, y: v.y + inset });
    },
    [size, inset],
  );

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

  /** What the keyboard and double-click handlers need that changes every render, read when they run. */
  const latest = useRef({ tool, anchors, single, selection, scope });
  latest.current = { tool, anchors, single, selection, scope };

  // Different selection, different anchors.
  const singleId = single?.id ?? null;
  useEffect(() => setAnchors([]), [singleId]);

  /** Write back a path whose anchors were edited (in its original local pixels), refitting its box. */
  const commitPath = useCallback(
    (orig: PathNode, local: PathPoint[], key: string) => {
      const f = refit(orig, local);
      // Editing anchors ends "polygon with N sides": the outline is now its own.
      commit((cur) => patchNodes(cur, [orig.id], { ...f, live: undefined } as Partial<Node>), key);
    },
    [commit],
  );

  // --- the Pen ---------------------------------------------------------------------------------
  const finishPen = useCallback(
    (closed: boolean, pts?: PathPoint[]) => {
      const list = pts ?? penRef.current;
      setPen([]);
      setPenHover(null);
      const node = makePathFromWorld(list, closed && list.length >= 3, closed && list.length >= 3 ? { fill: "#8b5cf6", strokeWidth: 0, join: "miter" } : { fill: "none", strokeWidth: 3 });
      if (!node) return;
      commit((cur) => addNode(cur, node), `create-${node.id}`);
      setSelection([node.id]);
    },
    [commit, setSelection],
  );
  // Leaving the Pen (Escape, or choosing another tool) finishes the path as an open one.
  useEffect(() => {
    if (tool !== "pen" && penRef.current.length) finishPen(false);
  }, [tool, finishPen]);

  // --- creating ---------------------------------------------------------------------------------
  const place = useCallback(
    (t: Tool, area: Rect | null, at: { x: number; y: number }) => {
      const d = docRef.current;
      const dragged = area && area.w > 6 && area.h > 6;
      let node: Node | null = null;
      if (t === "rect" || t === "ellipse") {
        const a = dragged ? area! : { x: at.x - 60, y: at.y - 60, w: 120, h: 120 };
        node = makeShape(t, a.x, a.y, a.w, a.h);
      } else if (t === "polygon" || t === "star") {
        const a = dragged ? area! : { x: at.x - 60, y: at.y - 60, w: 120, h: 120 };
        const o = prefsRef.current;
        node = makeShapePath(t === "polygon" ? { kind: "polygon", sides: o.polygonSides } : { kind: "star", points: o.starPoints, inner: o.starInner }, a);
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

  // --- guides -----------------------------------------------------------------------------------
  const guideDragRef = useRef<GuideDrag | null>(null);
  const setGuideDragBoth = useCallback((g: GuideDrag | null) => {
    guideDragRef.current = g;
    setGuideDrag(g);
  }, []);

  /** A point pulled onto the guides and grid it is near, unless snapping is off (⌘/Ctrl). */
  const snapPoint = (p: { x: number; y: number }, e: { ctrlKey: boolean; metaKey: boolean }) => {
    if (e.ctrlKey || e.metaKey) return p;
    const o = snapOpts();
    const t = SNAP_PX / viewRef.current.zoom;
    const d = docRef.current;
    return { x: snapScalar(p.x, snapLines(d, "x", o), t, o.grid), y: snapScalar(p.y, snapLines(d, "y", o), t, o.grid) };
  };

  // --- pointer ----------------------------------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    const el = viewport.current;
    if (!el) return;
    // Capture keeps the drag going outside the canvas; if the pointer can't be captured (it has already
    // gone, as when a touch is cancelled) the gesture simply carries on without.
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
    const world = toWorld(e.clientX, e.clientY);
    const target = e.target as HTMLElement;

    if (e.button === 1 || tool === "hand" || spaceDown) {
      drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, panX: view.x, panY: view.y };
      return;
    }
    if (e.button !== 0) return;

    // A ruler: pull a new guide out of it. The top ruler makes horizontal guides (a y position).
    const ruler = target.closest("[data-ruler]")?.getAttribute("data-ruler");
    if (ruler) {
      if (prefsRef.current.lockGuides) return;
      const axis: GuideAxis = ruler === "top" ? "y" : "x";
      drag.current = { kind: "guide", axis, index: null };
      setGuideSel(null);
      setGuideDragBoth({ axis, index: null, position: round(axis === "x" ? world.x : world.y), discard: true });
      return;
    }

    if (tool === "zoom") {
      drag.current = { kind: "zoom", start: world, alt: e.altKey, client: { x: e.clientX, y: e.clientY } };
      return;
    }

    if (tool === "brush") {
      brushRef.current = [world];
      setBrushLive([world]);
      drag.current = { kind: "brush" };
      return;
    }

    if (tool === "pen") {
      const p = snapPoint(world, e);
      const pts = penRef.current;
      // Back on the first point: close the path.
      if (pts.length >= 3 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) * viewRef.current.zoom < 8) {
        finishPen(true);
        return;
      }
      setPen([...pts, { x: p.x, y: p.y }]);
      drag.current = { kind: "pen" };
      return;
    }

    if (tool !== "select" && tool !== "direct") {
      drag.current = { kind: "create", tool, start: snapPoint(world, e) };
      return;
    }

    // An existing guide: pick it up (unless guides are locked).
    const guideAttr = target.closest("[data-guide]")?.getAttribute("data-guide");
    if (guideAttr && !prefsRef.current.lockGuides) {
      const [axis, i] = guideAttr.split(":") as [GuideAxis, string];
      const index = Number(i);
      const position = guidesOf(docRef.current)[axis][index];
      if (position !== undefined) {
        drag.current = { kind: "guide", axis, index };
        setSelection([]);
        setGuideSel({ axis, position });
        setGuideDragBoth({ axis, index, position, discard: false });
        return;
      }
    }
    setGuideSel(null);

    // The box round several selected objects (or a group): scale or turn them together.
    const mh = target.closest("[data-mhandle]")?.getAttribute("data-mhandle");
    const movable = selected.filter((n) => !n.locked);
    if (mh && movable.length > 1 && selBounds) {
      if (mh === "rotate") {
        const pivot = { x: selBounds.x + selBounds.w / 2, y: selBounds.y + selBounds.h / 2 };
        drag.current = { kind: "spin", pivot, start: angleTo(pivot, world), orig: movable };
      } else {
        const def = HANDLES.find((h) => h.id === mh)!;
        drag.current = { kind: "scale", hx: def.hx, hy: def.hy, box: selBounds, anchor: oppositeAnchor(selBounds, def.hx, def.hy), orig: movable };
      }
      return;
    }

    // Direct Selection on a path: an anchor point, or one of its curve handles.
    if (tool === "direct" && single?.type === "path" && !single.locked) {
      const a = target.closest("[data-anchor]")?.getAttribute("data-anchor");
      const hin = target.closest("[data-hin]")?.getAttribute("data-hin");
      const hout = target.closest("[data-hout]")?.getAttribute("data-hout");
      if (hin != null || hout != null) {
        drag.current = { kind: "handle", orig: single, local: toLocal(single), index: Number(hin ?? hout), which: hin != null ? "in" : "out" };
        return;
      }
      if (a != null) {
        const i = Number(a);
        const picked = anchors.includes(i) ? anchors : e.shiftKey ? [...anchors, i] : [i];
        const next = e.shiftKey && anchors.includes(i) ? anchors.filter((x) => x !== i) : picked;
        setAnchors(next);
        drag.current = { kind: "anchor", orig: single, local: toLocal(single), from: worldToLocal(single, world), indices: new Set(next), moved: false };
        return;
      }
    }

    const handleId = (e.target as HTMLElement).closest("[data-handle]")?.getAttribute("data-handle");
    if (handleId && single && tool === "select") {
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
      // Selecting part of a group selects all of it; the Direct Selection tool picks one.
      // Clicking something outside the group being worked in leaves it.
      const inScope = !scope || groupAt(doc, hit.id, scope) !== null || (doc.nodes[hit.id].group ?? "").startsWith(scope);
      const sc = inScope ? scope : "";
      if (!inScope) setScope("");
      const wholeGroups = (ids: string[]) => (tool === "select" ? expandGroups(doc, ids, sc) : ids);
      let ids = selection.includes(hit.id) ? selection : wholeGroups(e.shiftKey ? [...selection, hit.id] : [hit.id]);
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
    if (!e.shiftKey) {
      setSelection([]);
      setAnchors([]);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = viewport.current?.getBoundingClientRect();
    if (rect) {
      // Tell the rulers and the readout where the pointer is, without re-rendering for it.
      const lx = e.clientX - rect.left;
      const ly = e.clientY - rect.top;
      if (topMarker.current) {
        topMarker.current.style.display = "block";
        topMarker.current.style.transform = `translateX(${Math.max(0, lx - RULER_SIZE)}px)`;
      }
      if (leftMarker.current) {
        leftMarker.current.style.display = "block";
        leftMarker.current.style.transform = `translateY(${Math.max(0, ly - RULER_SIZE)}px)`;
      }
      if (readout.current) {
        const p = toWorld(e.clientX, e.clientY);
        readout.current.textContent = `X ${round(p.x, 1)}   Y ${round(p.y, 1)}`;
      }
    }

    if (latest.current.tool === "pen" && penRef.current.length) setPenHover(snapPoint(toWorld(e.clientX, e.clientY), e));

    const d = drag.current;
    if (!d) return;
    const world = toWorld(e.clientX, e.clientY);
    const zoom = viewRef.current.zoom;

    if (d.kind === "pan") {
      setView((v) => ({ ...v, x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) }));
    } else if (d.kind === "guide") {
      const r = viewport.current!.getBoundingClientRect();
      const local = d.axis === "x" ? e.clientX - r.left : e.clientY - r.top;
      // Back over the ruler it came from (or off the canvas) throws the guide away.
      const discard = local < (prefsRef.current.rulers ? RULER_SIZE : 0);
      const raw = d.axis === "x" ? world.x : world.y;
      // Onto the grid when snapping to it is on, unless ⌘/Ctrl or Shift is held.
      const grid = snapOpts().grid;
      const snapped = grid && !e.shiftKey && !e.ctrlKey && !e.metaKey ? Math.round(raw / grid) * grid : raw;
      setGuideDragBoth({ axis: d.axis, index: d.index, position: round(snapped), discard });
    } else if (d.kind === "brush") {
      const last = brushRef.current[brushRef.current.length - 1];
      // Points closer than a couple of screen pixels add only noise.
      if (last && Math.hypot(world.x - last.x, world.y - last.y) * zoom < 2) return;
      brushRef.current.push(world);
      setBrushLive([...brushRef.current]);
    } else if (d.kind === "pen") {
      // Dragging out of a point makes it smooth: the handle follows the pointer and the other mirrors it.
      const p = snapPoint(world, e);
      setPen((cur) => {
        const last = cur[cur.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) * zoom < 3) return cur;
        const next = [...cur];
        next[next.length - 1] = { x: last.x, y: last.y, outX: p.x, outY: p.y, inX: 2 * last.x - p.x, inY: 2 * last.y - p.y };
        return next;
      });
    } else if (d.kind === "anchor") {
      const to = worldToLocal(d.orig, world);
      let dx = to.x - d.from.x;
      let dy = to.y - d.from.y;
      if (!d.moved && Math.hypot(dx, dy) * zoom < 3) return;
      d.moved = true;
      // Shift keeps it to one axis, as it does for moving objects.
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      commitPath(d.orig, moveAnchors(d.local, d.indices, { x: dx, y: dy }), "anchor");
    } else if (d.kind === "handle") {
      commitPath(d.orig, moveHandle(d.local, d.index, d.which, worldToLocal(d.orig, world), e.altKey), "handle");
    } else if (d.kind === "scale") {
      const { sx, sy } = dragScale(d.box, d.hx, d.hy, d.anchor, world, e.shiftKey);
      const patches = new Map(scaleNodes(d.orig, d.anchor, sx, sy).map((p) => [p.id, p.patch]));
      commit((cur) => patchNodes(cur, [...patches.keys()], (n) => patches.get(n.id) ?? {}), "scale");
    } else if (d.kind === "spin") {
      let delta = angleTo(d.pivot, world) - d.start;
      if (e.shiftKey) delta = Math.round(delta / 15) * 15;
      const patches = new Map(rotateNodes(d.orig, d.pivot, delta).map((p) => [p.id, p.patch]));
      commit((cur) => patchNodes(cur, [...patches.keys()], (n) => patches.get(n.id) ?? {}), "spin");
    } else if (d.kind === "zoom") {
      const r = normalisedRect(d.start, world);
      // Only a drag of some size is a box; anything less is a click.
      if (r.w * zoom > 4 || r.h * zoom > 4) setGhost(r);
    } else if (d.kind === "create" && d.tool === "line") {
      let b = snapPoint(world, e);
      if (e.shiftKey) b = constrain45(d.start, b);
      setLineGhost({ a: d.start, b });
    } else if (d.kind === "create") {
      setGhost(normalisedRect(d.start, snapPoint(world, e)));
    } else if (d.kind === "marquee") {
      const r = normalisedRect(d.start, world);
      setMarquee(r);
      const hits = nodesInOrder(docRef.current)
        .filter((n) => !n.locked && !n.hidden && intersects(boundsOf(n), r))
        .map((n) => n.id);
      const all = [...new Set([...d.base, ...hits])];
      setSelection(latest.current.tool === "select" ? expandGroups(docRef.current, all, latest.current.scope) : all);
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
        const snap = snapMove({ ...box, x: box.x + dx, y: box.y + dy }, current, new Set(ids), SNAP_PX / zoom, snapOpts());
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
      // Snap the dragged edge to the artboard's edges, ruler guides and grid close by, for a clean fit.
      // Not while ⌘/Ctrl is held, and not for a turned object, whose edges aren't on the axes.
      const t = SNAP_PX / zoom;
      if (!o.rotation && !e.ctrlKey && !e.metaKey) {
        const so = snapOpts();
        const xs = snapLines(docRef.current, "x", so);
        const ys = snapLines(docRef.current, "y", so);
        const snapTo = (v: number, lines: number[]) => snapScalar(v, lines, t, so.grid);
        if (d.handle.includes("e")) r = { ...r, w: snapTo(r.x + r.w, xs) - r.x };
        if (d.handle.includes("w")) {
          const nx = snapTo(r.x, xs);
          r = { ...r, w: r.w + (r.x - nx), x: nx };
        }
        if (d.handle.includes("s")) r = { ...r, h: snapTo(r.y + r.h, ys) - r.y };
        if (d.handle.includes("n")) {
          const ny = snapTo(r.y, ys);
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
    try {
      viewport.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* wasn't captured */
    }
    setGuides({ x: [], y: [] });
    setMarquee(null);
    if (!d) return;
    if (d.kind === "brush") {
      const raw = brushRef.current;
      brushRef.current = [];
      setBrushLive(null);
      const o = prefsRef.current;
      const fitted = fitFreehand(raw, Math.max(0.5, 2 / viewRef.current.zoom));
      const node = makePathFromWorld(fitted, false, {
        fill: "none",
        stroke: o.brushColor,
        strokeWidth: o.brushSize,
        cap: "round",
        join: "round",
        ...(o.brushType !== "round" ? { brush: defaultBrush(o.brushType) } : {}),
      }, "Brush stroke");
      if (node) {
        commit((cur) => addNode(cur, node), `create-${node.id}`);
        setSelection([node.id]);
      }
      return;
    }
    if (d.kind === "create" && d.tool === "line") {
      let b = snapPoint(toWorld(e.clientX, e.clientY), e);
      if (e.shiftKey) b = constrain45(d.start, b);
      setLineGhost(null);
      if (Math.hypot(b.x - d.start.x, b.y - d.start.y) * viewRef.current.zoom > 3) {
        const node = makeLine(d.start, b);
        if (node) {
          commit((cur) => addNode(cur, node), `create-${node.id}`);
          setSelection([node.id]);
        }
      }
      setTool("select");
    } else if (d.kind === "create") {
      const world = snapPoint(toWorld(e.clientX, e.clientY), e);
      place(d.tool, ghost, world);
      setGhost(null);
    } else if (d.kind === "guide") {
      const g = guideDragRef.current;
      setGuideDragBoth(null);
      if (g) {
        if (g.discard) {
          // Dropped back on the ruler: an existing guide is deleted; a new one was never made.
          if (g.index !== null) commit((cur) => removeGuide(cur, g.axis, g.index!));
          setGuideSel(null);
        } else {
          commit((cur) => setGuide(cur, g.axis, g.index, g.position));
          // Making a guide shows guides, as pulling one from a ruler does anywhere else.
          if (!prefsRef.current.showGuides) setPrefs({ showGuides: true });
          // Selected, so Delete can take it away.
          setGuideSel({ axis: g.axis, position: g.position });
        }
      }
    } else if (d.kind === "zoom") {
      const area = ghost;
      setGhost(null);
      const zoom = viewRef.current.zoom;
      if (area && area.w * zoom > 4 && area.h * zoom > 4) zoomToRect(area);
      else {
        const r = viewport.current!.getBoundingClientRect();
        zoomAt(d.alt ? 0.5 : 2, d.client.x - r.left, d.client.y - r.top);
      }
    } else if (d.kind === "move" && !d.moved && !d.shift) {
      // A click on something already selected narrows to it (all of it, if it is in a group).
      setSelection(latest.current.tool === "select" ? expandGroups(docRef.current, [d.clickedId], latest.current.scope) : [d.clickedId]);
    } else if (d.kind === "move" && !d.moved && d.shift && selection.includes(d.clickedId) && selection.length > 1) {
      const drop = new Set(latest.current.tool === "select" ? expandGroups(docRef.current, [d.clickedId], latest.current.scope) : [d.clickedId]);
      setSelection(selection.filter((id) => !drop.has(id)));
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
      if (e.key === "Escape" && latest.current.scope) setScope("");
      // View commands, bound as Illustrator binds them. Matched on `code` where an Option
      // press would change `key` (⌥; is "…" on a Mac).
      const p = prefsRef.current;
      const plain = mod && !e.shiftKey && !e.altKey;
      if (plain && e.key.toLowerCase() === "r") {
        e.preventDefault();
        setPrefs({ rulers: !p.rulers });
      } else if (plain && e.code === "Semicolon") {
        e.preventDefault();
        setPrefs({ showGuides: !p.showGuides });
      } else if (mod && e.altKey && !e.shiftKey && e.code === "Semicolon") {
        e.preventDefault();
        setPrefs({ lockGuides: !p.lockGuides });
      } else if (plain && e.code === "Quote") {
        e.preventDefault();
        setPrefs({ grid: !p.grid });
      } else if (mod && e.shiftKey && !e.altKey && e.code === "Quote") {
        e.preventDefault();
        setPrefs({ snapGrid: !p.snapGrid });
      } else if (plain && e.key.toLowerCase() === "u") {
        e.preventDefault();
        setPrefs({ smartGuides: !p.smartGuides });
      } else if (plain && e.key.toLowerCase() === "y") {
        e.preventDefault();
        setPrefs({ outline: !p.outline });
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        A.deselect(editor);
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        A.selectAll(editor);
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        A.duplicate(editor);
      } else if (mod && e.key.toLowerCase() === "x") {
        e.preventDefault();
        A.cut(editor);
      } else if (mod && e.key.toLowerCase() === "c") {
        A.copy(editor);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        A.paste(editor, "place");
      } else if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        A.paste(editor);
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        A.paste(editor, "back");
      } else if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        A.paste(editor, "front");
      } else if (mod && e.code === "Digit8") {
        e.preventDefault();
        void (e.altKey ? A.releaseCompound(editor) : A.makeCompound(editor)).then((m) => m && onNotice?.(m));
      } else if (mod && e.code === "Digit2" && !e.shiftKey) {
        e.preventDefault();
        if (e.altKey) A.unlockAll(editor);
        else A.lockSelection(editor);
      } else if (mod && e.code === "Digit3" && !e.shiftKey) {
        e.preventDefault();
        if (e.altKey) A.showAll(editor);
        else A.hideSelection(editor);
      } else if (e.code === "BracketRight" && !e.altKey) {
        // Illustrator arranges with ⌘]; the bare key stays as it was in this editor.
        e.preventDefault();
        A.arrange(editor, e.shiftKey ? "front" : "up");
      } else if (e.code === "BracketLeft" && !e.altKey) {
        e.preventDefault();
        A.arrange(editor, e.shiftKey ? "back" : "down");
      } else if (mod && e.code === "Digit0") {
        // ⌘0 fits the artboard, ⌥⌘0 fits everything: here the same, as there is one artboard.
        e.preventDefault();
        fit();
      } else if (mod && e.code === "Digit1") {
        e.preventDefault();
        commands.current?.actualSize();
      } else if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        commands.current?.zoomIn();
      } else if (mod && e.key === "-") {
        e.preventDefault();
        commands.current?.zoomOut();
      } else if (latest.current.tool === "pen" && penRef.current.length && (e.key === "Backspace" || e.key === "Enter")) {
        e.preventDefault();
        if (e.key === "Enter") finishPen(false);
        else setPen((cur) => cur.slice(0, -1));
      } else if ((e.key === "Delete" || e.key === "Backspace") && latest.current.tool === "direct" && latest.current.single?.type === "path" && latest.current.anchors.length) {
        e.preventDefault();
        const node = latest.current.single;
        const left = removeAnchors(toLocal(node), new Set(latest.current.anchors));
        if (left.length < 2) A.remove(editor);
        else commitPath(node, left, "del-anchor");
        setAnchors([]);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        A.ungroup(editor);
      } else if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        A.group(editor);
      } else if ((e.key === "Delete" || e.key === "Backspace") && guideSel && ids.length === 0) {
        e.preventDefault();
        const at = guidesOf(docRef.current)[guideSel.axis].indexOf(guideSel.position);
        if (at >= 0) commit((cur) => removeGuide(cur, guideSel.axis, at));
        setGuideSel(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && ids.length) {
        e.preventDefault();
        A.remove(editor);
      } else if (e.key.startsWith("Arrow") && ids.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        commit((cur) => patchNodes(cur, ids, (n) => (n.type === "floor" ? { y: n.y + dy } : { x: n.x + dx, y: n.y + dy })), "nudge");
      } else if (!mod && !e.altKey && !e.shiftKey) {
        const next = toolForKey(e.key, docRef.current.kind);
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
  }, [selection, guideSel, editor, commit, commands, setPrefs, setSelection, setTool, setScope, fit, finishPen, commitPath, onNotice]);

  // --- dropping files -----------------------------------------------------------------------------
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length && onDropFiles) onDropFiles(files, toWorld(e.clientX, e.clientY));
  };

  const hs = HANDLE_PX / view.zoom;
  const lineW = 1 / view.zoom;
  const dragging = drag.current?.kind;
  const cursor =
    dragging === "guide"
      ? guideDrag?.axis === "x"
        ? "col-resize"
        : "row-resize"
      : spaceDown || tool === "hand"
        ? dragging === "pan"
          ? "grabbing"
          : "grab"
        : tool === "zoom"
          ? "zoom-in"
          : tool !== "select" && tool !== "direct"
            ? "crosshair"
            : "default";
  const showResize = single && !single.locked && single.type !== "floor" && tool !== "direct";
  const showGroupBox = selected.length > 1 && tool !== "direct" && !selected.every((n) => n.locked) && selBounds;
  const direct = tool === "direct" && single?.type === "path" && !single.locked ? single : null;
  const directLocal = direct ? toLocal(direct) : [];
  const toW = (p: { x: number; y: number }) => (direct ? localToWorld(direct, p) : p);
  const cornersOnly = single?.type === "prop" || single?.type === "seat";

  // The part of the document in view, so grid and guides only reach as far as the screen does.
  const seen = {
    x0: -view.x / view.zoom,
    y0: -view.y / view.zoom,
    w: size.w / view.zoom,
    h: size.h / view.zoom,
  };
  const userGuides = guidesOf(doc);
  const guidesVisible = prefs.showGuides;
  /** Guides can be picked up with the pointer in the Selection tool, when they're not locked. */
  const guidesGrabbable = guidesVisible && !prefs.lockGuides && tool === "select";
  // Fine grid lines vanish when they'd be a smear; the stronger every-fifth lines stay.
  const gridPx = gridSize * view.zoom;
  const gridOn = prefs.grid && gridPx * 5 >= 6;
  const gridMinor = gridPx >= 6;
  const gridColour = (a: number) => `rgba(120,160,255,${a})`;

  return (
    <>
    <div
      ref={viewport}
      className="ai-pasteboard absolute inset-0 touch-none overflow-hidden select-none"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => {
        if (topMarker.current) topMarker.current.style.display = "none";
        if (leftMarker.current) leftMarker.current.style.display = "none";
        if (readout.current) readout.current.textContent = "";
      }}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        const t = e.target as HTMLElement | SVGElement;
        if (t.closest("[data-ruler]")) return;
        // Double-click with the Hand fits the artboard.
        if (tool === "hand") return fit();
        // The Pen: finish the path (the two clicks each placed a point; drop the repeat).
        if (tool === "pen") {
          const pts = penRef.current;
          const near = (a: PathPoint, b: PathPoint) => Math.hypot(a.x - b.x, a.y - b.y) * viewRef.current.zoom < 3;
          return finishPen(false, pts.length > 1 && near(pts[pts.length - 1], pts[pts.length - 2]) ? pts.slice(0, -1) : pts);
        }
        // Direct Selection on a path: an anchor flips between corner and smooth; the outline gets a new anchor.
        if (tool === "direct" && single?.type === "path") {
          const a = t.closest("[data-anchor]")?.getAttribute("data-anchor");
          const local = toLocal(single);
          if (a != null) return commitPath(single, toggleSmooth(local, Number(a), single.closed), "smooth");
          const hit = nearestOnPath(local, single.closed, worldToLocal(single, toWorld(e.clientX, e.clientY)));
          if (hit && hit.dist * viewRef.current.zoom < 8) {
            const ins = insertAnchor(local, single.closed, hit.segment, hit.t);
            commitPath(single, ins.points, "add-anchor");
            setAnchors([ins.index]);
          }
          return;
        }
        // Select tool on a grouped object: go inside its group — now a click picks what is in it, a
        // subgroup as one thing and anything else on its own. Escape (or a click outside) comes back out.
        if (tool === "select") {
          const id = t.closest("[data-node-id]")?.getAttribute("data-node-id");
          const d = docRef.current;
          if (!id || !d.nodes[id] || d.nodes[id].locked) return;
          const sc = latest.current.scope;
          const g = groupAt(d, id, sc);
          if (!g) return;
          const entered = g.join("/");
          setScope(entered);
          setSelection(expandGroups(d, [id], entered));
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="absolute top-0 left-0" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: "0 0", width: doc.artboard.w, height: doc.artboard.h }}>
        <Backdrop doc={doc} avatarUrl={avatarUrl} />

        {/* The grid, behind the artwork. Anchored to the document's origin so it lines up with the rulers. */}
        {gridOn && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: Math.floor(seen.x0 / (gridSize * 5)) * gridSize * 5,
              top: Math.floor(seen.y0 / (gridSize * 5)) * gridSize * 5,
              width: seen.w + gridSize * 10,
              height: seen.h + gridSize * 10,
              backgroundImage: [
                `linear-gradient(to right, ${gridColour(0.28)} ${lineW}px, transparent ${lineW}px)`,
                `linear-gradient(to bottom, ${gridColour(0.28)} ${lineW}px, transparent ${lineW}px)`,
                ...(gridMinor
                  ? [`linear-gradient(to right, ${gridColour(0.1)} ${lineW}px, transparent ${lineW}px)`, `linear-gradient(to bottom, ${gridColour(0.1)} ${lineW}px, transparent ${lineW}px)`]
                  : []),
              ].join(", "),
              backgroundSize: [
                `${gridSize * 5}px ${gridSize * 5}px`,
                `${gridSize * 5}px ${gridSize * 5}px`,
                ...(gridMinor ? [`${gridSize}px ${gridSize}px`, `${gridSize}px ${gridSize}px`] : []),
              ].join(", "),
            }}
          />
        )}

        {doc.order.map((id) => {
          const n = doc.nodes[id];
          if (!n || n.hidden) return null;
          const view1 = <NodeView key={id} node={n} assets={assets} doc={doc} outline={prefs.outline} lineW={lineW} zoom={view.zoom} />;
          // Inside a group, everything else is dimmed and out of reach, as in Illustrator's isolation mode.
          const outside = !!scope && !(n.group === scope || n.group?.startsWith(scope + "/"));
          return outside ? (
            <div key={id} className="pointer-events-none" style={{ opacity: 0.3 }}>
              {view1}
            </div>
          ) : (
            view1
          );
        })}

        {/* The artboard's own edge. */}
        <div className="pointer-events-none absolute border border-black" style={{ left: 0, top: 0, width: doc.artboard.w, height: doc.artboard.h, borderWidth: lineW }} />

        {/* Ruler guides. The one being dragged is drawn from the drag, not from the document. */}
        {guidesVisible &&
          (["x", "y"] as const).flatMap((axis) =>
            userGuides[axis].map((pos, i) => {
              if (guideDrag && guideDrag.index === i && guideDrag.axis === axis) return null;
              const selectedGuide = guideSel?.axis === axis && guideSel.position === pos;
              return (
                <GuideLine
                  key={`${axis}${i}`}
                  axis={axis}
                  position={pos}
                  data={`${axis}:${i}`}
                  seen={seen}
                  lineW={lineW}
                  grab={guidesGrabbable ? GUIDE_GRAB_PX / view.zoom : 0}
                  selected={selectedGuide}
                />
              );
            }),
          )}
        {guideDrag && !guideDrag.discard && <GuideLine axis={guideDrag.axis} position={guideDrag.position} seen={seen} lineW={lineW} grab={0} selected />}

        {/* Hover/selection outlines. */}
        {selected.map((n) => (
          <div key={n.id} className="pointer-events-none absolute border-[var(--ai-select)]" style={{ left: n.x, top: n.y, width: n.w, height: n.h, transform: n.rotation ? `rotate(${n.rotation}deg)` : undefined, borderWidth: lineW * 1.5, borderStyle: "solid" }} />
        ))}
        {selected.length > 1 && selBounds && (
          <div className="pointer-events-none absolute border-[var(--ai-select)]" style={{ left: selBounds.x, top: selBounds.y, width: selBounds.w, height: selBounds.h, borderWidth: lineW, borderStyle: "dashed" }} />
        )}

        {/* Handles for a single node. */}
        {showResize && single && (
          <div className="pointer-events-none absolute" style={{ left: single.x, top: single.y, width: single.w, height: single.h, transform: single.rotation ? `rotate(${single.rotation}deg)` : undefined }}>
            {HANDLES.filter((h) => !cornersOnly || (h.hx !== 0 && h.hy !== 0)).map((h) => (
              <div
                key={h.id}
                data-handle={h.id}
                className="pointer-events-auto absolute border-[var(--ai-select)] bg-white"
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
            <div className="absolute bg-[var(--ai-select)]" style={{ left: "50%", top: -(ROTATE_OFFSET_PX / view.zoom), width: lineW, height: ROTATE_OFFSET_PX / view.zoom, marginLeft: -lineW / 2 }} />
            <div
              data-handle="rotate"
              className="pointer-events-auto absolute rounded-full border-[var(--ai-select)] bg-white"
              style={{ left: "50%", top: -(ROTATE_OFFSET_PX / view.zoom), width: hs, height: hs, marginLeft: -hs / 2, marginTop: -hs / 2, borderWidth: lineW * 1.5, borderStyle: "solid", cursor: "grab" }}
            />
          </div>
        )}

        {/* The box round several objects (a group, or any multiple selection): handles to scale and turn them together. */}
        {showGroupBox && selBounds && (
          <div className="pointer-events-none absolute" style={{ left: selBounds.x, top: selBounds.y, width: selBounds.w, height: selBounds.h }}>
            {HANDLES.map((h) => (
              <div
                key={h.id}
                data-mhandle={h.id}
                className="pointer-events-auto absolute border-[var(--ai-select)] bg-white"
                style={{ left: `${(h.hx + 1) * 50}%`, top: `${(h.hy + 1) * 50}%`, width: hs, height: hs, marginLeft: -hs / 2, marginTop: -hs / 2, borderWidth: lineW * 1.5, borderStyle: "solid", cursor: h.cursor, borderRadius: 1 / view.zoom }}
              />
            ))}
            <div className="absolute bg-[var(--ai-select)]" style={{ left: "50%", top: -(ROTATE_OFFSET_PX / view.zoom), width: lineW, height: ROTATE_OFFSET_PX / view.zoom, marginLeft: -lineW / 2 }} />
            <div data-mhandle="rotate" className="pointer-events-auto absolute rounded-full border-[var(--ai-select)] bg-white" style={{ left: "50%", top: -(ROTATE_OFFSET_PX / view.zoom), width: hs, height: hs, marginLeft: -hs / 2, marginTop: -hs / 2, borderWidth: lineW * 1.5, borderStyle: "solid", cursor: "grab" }} />
          </div>
        )}

        {/* Direct Selection: a path's anchors, and the curve handles of the picked ones. */}
        {direct && (
          <svg className="pointer-events-none absolute overflow-visible" style={{ left: 0, top: 0, width: 1, height: 1 }}>
            <path d={pathD(directLocal.map((p) => ({ ...p, x: toW(p).x, y: toW(p).y, ...(p.inX !== undefined ? { inX: toW({ x: p.inX, y: p.inY! }).x, inY: toW({ x: p.inX, y: p.inY! }).y } : {}), ...(p.outX !== undefined ? { outX: toW({ x: p.outX, y: p.outY! }).x, outY: toW({ x: p.outX, y: p.outY! }).y } : {}) })), direct.closed, 1, 1)} fill="none" stroke="var(--ai-select)" strokeWidth={lineW * 1.5} />
            {directLocal.map((p, i) => {
              if (!anchors.includes(i) || !isSmooth(p)) return null;
              const a = toW(p);
              return (
                <g key={`h${i}`}>
                  {p.inX !== undefined && (
                    <>
                      <line x1={a.x} y1={a.y} x2={toW({ x: p.inX, y: p.inY! }).x} y2={toW({ x: p.inX, y: p.inY! }).y} stroke="var(--ai-select)" strokeWidth={lineW} />
                      <circle data-hin={i} className="pointer-events-auto" cx={toW({ x: p.inX, y: p.inY! }).x} cy={toW({ x: p.inX, y: p.inY! }).y} r={hs * 0.5} fill="white" stroke="var(--ai-select)" strokeWidth={lineW * 1.5} style={{ cursor: "pointer" }} />
                    </>
                  )}
                  {p.outX !== undefined && (
                    <>
                      <line x1={a.x} y1={a.y} x2={toW({ x: p.outX, y: p.outY! }).x} y2={toW({ x: p.outX, y: p.outY! }).y} stroke="var(--ai-select)" strokeWidth={lineW} />
                      <circle data-hout={i} className="pointer-events-auto" cx={toW({ x: p.outX, y: p.outY! }).x} cy={toW({ x: p.outX, y: p.outY! }).y} r={hs * 0.5} fill="white" stroke="var(--ai-select)" strokeWidth={lineW * 1.5} style={{ cursor: "pointer" }} />
                    </>
                  )}
                </g>
              );
            })}
            {directLocal.map((p, i) => {
              const a = toW(p);
              const on = anchors.includes(i);
              return <rect key={`a${i}`} data-anchor={i} className="pointer-events-auto" x={a.x - hs / 2} y={a.y - hs / 2} width={hs} height={hs} fill={on ? "var(--ai-select)" : "white"} stroke="var(--ai-select)" strokeWidth={lineW * 1.5} style={{ cursor: "pointer" }} />;
            })}
          </svg>
        )}

        {/* The Pen's path so far, the next segment following the pointer, and the first point to click to close it. */}
        {pen.length > 0 && (
          <svg className="pointer-events-none absolute overflow-visible" style={{ left: 0, top: 0, width: 1, height: 1 }}>
            <path d={pathD(pen, false, 1, 1)} fill="none" stroke="var(--ai-select)" strokeWidth={lineW * 1.5} />
            {penHover && tool === "pen" && (
              <path d={pathD([pen[pen.length - 1], { x: penHover.x, y: penHover.y }], false, 1, 1)} fill="none" stroke="var(--ai-select)" strokeWidth={lineW} strokeDasharray={`${4 / view.zoom} ${3 / view.zoom}`} />
            )}
            {pen.map((p, i) => (
              <g key={i}>
                {p.outX !== undefined && (
                  <>
                    <line x1={p.inX} y1={p.inY} x2={p.outX} y2={p.outY} stroke="var(--ai-select)" strokeWidth={lineW} />
                    <circle cx={p.outX} cy={p.outY} r={hs * 0.4} fill="white" stroke="var(--ai-select)" strokeWidth={lineW} />
                    <circle cx={p.inX} cy={p.inY} r={hs * 0.4} fill="white" stroke="var(--ai-select)" strokeWidth={lineW} />
                  </>
                )}
                <rect x={p.x - hs / 2} y={p.y - hs / 2} width={hs} height={hs} fill={i === 0 && pen.length >= 3 ? "white" : "var(--ai-select)"} stroke="var(--ai-select)" strokeWidth={lineW * 1.5} />
              </g>
            ))}
          </svg>
        )}
        {brushLive && brushLive.length > 1 && (
          <svg className="pointer-events-none absolute overflow-visible" style={{ left: 0, top: 0, width: 1, height: 1 }}>
            <polyline points={brushLive.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke={prefs.brushColor} strokeOpacity={0.85} strokeWidth={prefs.brushSize} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {lineGhost && (
          <svg className="pointer-events-none absolute overflow-visible" style={{ left: 0, top: 0, width: 1, height: 1 }}>
            <line x1={lineGhost.a.x} y1={lineGhost.a.y} x2={lineGhost.b.x} y2={lineGhost.b.y} stroke="var(--ai-select)" strokeWidth={lineW * 1.5} />
          </svg>
        )}

        {/* Snap guides. */}
        {guides.x.map((x) => (
          <div key={`gx${x}`} className="pointer-events-none absolute bg-pink-500" style={{ left: x, top: -2000, width: lineW, height: doc.artboard.h + 4000 }} />
        ))}
        {guides.y.map((y) => (
          <div key={`gy${y}`} className="pointer-events-none absolute bg-pink-500" style={{ top: y, left: -2000, height: lineW, width: doc.artboard.w + 4000 }} />
        ))}

        {ghost && <div className="pointer-events-none absolute border-[var(--ai-select)] bg-[color-mix(in_oklch,var(--ai-select),transparent_90%)]" style={{ left: ghost.x, top: ghost.y, width: ghost.w, height: ghost.h, borderWidth: lineW, borderStyle: tool === "zoom" ? "dashed" : "solid" }} />}
        {marquee && <div className="pointer-events-none absolute border-[var(--ai-select)] bg-[color-mix(in_oklch,var(--ai-select),transparent_90%)]" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, borderWidth: lineW, borderStyle: "solid" }} />}
      </div>

      {scope && (
        <div className="pointer-events-none absolute z-10 flex items-center gap-1.5 rounded-[3px] bg-[var(--ai-select)] px-2 py-0.5 text-[11px] font-medium text-white shadow" style={{ left: inset + 8, top: inset + 8 }}>
          Inside group <span className="opacity-80">· Esc to leave</span>
        </div>
      )}
      {prefs.rulers && (
        <>
          <Ruler side="top" zoom={view.zoom} offset={view.x - RULER_SIZE} length={size.w - RULER_SIZE} markerRef={topMarker} />
          <Ruler side="left" zoom={view.zoom} offset={view.y - RULER_SIZE} length={size.h - RULER_SIZE} markerRef={leftMarker} />
          <RulerCorner />
        </>
      )}

    </div>
    </>
  );
}

/**
 * A ruler guide across the whole view. Drawn a pixel wide whatever the zoom; when it
 * can be picked up, a few pixels either side of it take the pointer too.
 */
function GuideLine({
  axis,
  position,
  data,
  seen,
  lineW,
  grab,
  selected,
}: {
  axis: GuideAxis;
  position: number;
  data?: string;
  seen: { x0: number; y0: number; w: number; h: number };
  lineW: number;
  grab: number;
  selected?: boolean;
}) {
  const vertical = axis === "x";
  const half = grab > 0 ? grab : lineW / 2;
  const thick = selected ? lineW * 1.5 : lineW;
  const along = vertical ? { top: seen.y0 - 100, height: seen.h + 200 } : { left: seen.x0 - 100, width: seen.w + 200 };
  return (
    <div
      data-guide={grab > 0 ? data : undefined}
      className={cn("absolute", grab > 0 ? "pointer-events-auto" : "pointer-events-none")}
      style={{
        ...along,
        ...(vertical ? { left: position - half, width: half * 2 } : { top: position - half, height: half * 2 }),
        cursor: grab > 0 ? (vertical ? "col-resize" : "row-resize") : undefined,
      }}
    >
      <div
        className="pointer-events-none absolute"
        style={{
          background: selected ? "#22d3ee" : "rgba(34,211,238,0.7)",
          ...(vertical ? { left: "50%", marginLeft: -thick / 2, top: 0, bottom: 0, width: thick } : { top: "50%", marginTop: -thick / 2, left: 0, right: 0, height: thick }),
        }}
      />
    </div>
  );
}

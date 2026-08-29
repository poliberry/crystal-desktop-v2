"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  LAYER_LIMITS,
  layerHeight,
  patchLayer,
  resolveLayer,
  type CosmeticLayer,
} from "@/lib/cosmetic-layers";
import { cn } from "@/lib/utils";

/**
 * The canvas half of the cosmetic editor: artwork you drag, resize and turn
 * against the thing it decorates.
 *
 * The thing it decorates is `children` — the real profile card, or an avatar —
 * rendered at its real width inside the stage, so what you arrange against is
 * what everybody else will see rather than a diagram of it.
 *
 * ## Two coordinate systems
 *
 * Layers are stored in percent of the stage's *width* (see
 * src/lib/cosmetic-layers.ts) and the canvas works in screen pixels, so every
 * interaction converts between them. The conversion is one number — `scale`,
 * pixels per percent — which is why zooming needs no other change: it moves
 * that number and everything else follows.
 *
 * ## Why the drag maths is not just "add the delta"
 *
 * A layer can be rotated, and resizing a rotated box by its corner has to keep
 * the *opposite* corner still, or the artwork walks across the canvas as you
 * scale it. So a corner drag is done in the layer's own turned frame: the
 * pointer is rotated back by the layer's angle, the size is measured there, and
 * the centre is recomputed from the corner that isn't moving.
 */

/** Snap targets, in percent of stage width: the stage's own edges and middle. */
const SNAP_TOLERANCE = 1.6;

/** Nudge per arrow key, and with shift held. */
const NUDGE = 0.5;
const NUDGE_FAST = 5;

export type Handle =
  | "move"
  | "nw"
  | "ne"
  | "sw"
  | "se"
  | "w"
  | "e"
  | "n"
  | "s"
  | "rotate";

/** Every corner and edge handle, and where each sits in the layer's own frame
 * as a fraction of its box. */
const HANDLES: { handle: Handle; fx: number; fy: number; cursor: string }[] = [
  { handle: "nw", fx: -0.5, fy: -0.5, cursor: "nwse-resize" },
  { handle: "n", fx: 0, fy: -0.5, cursor: "ns-resize" },
  { handle: "ne", fx: 0.5, fy: -0.5, cursor: "nesw-resize" },
  { handle: "e", fx: 0.5, fy: 0, cursor: "ew-resize" },
  { handle: "se", fx: 0.5, fy: 0.5, cursor: "nwse-resize" },
  { handle: "s", fx: 0, fy: 0.5, cursor: "ns-resize" },
  { handle: "sw", fx: -0.5, fy: 0.5, cursor: "nesw-resize" },
  { handle: "w", fx: -0.5, fy: 0, cursor: "ew-resize" },
];

export interface StageGeometry {
  /** Width of the decorated thing, in CSS pixels at zoom 1. */
  width: number;
  /** Its height. For a card this is whatever the preview is currently set to,
   * which is the point of being able to change it. */
  height: number;
}

interface Drag {
  handle: Handle;
  layerId: string;
  /** The layer as it was when the drag started — every frame is computed from
   * this rather than from the last frame, so rounding can't accumulate. */
  start: CosmeticLayer;
  startHeight: number;
  pointerX: number;
  pointerY: number;
}

/** Where a layer's centre sits vertically, in percent of stage width measured
 * from the stage's top edge. The anchor is what `y` is relative to. */
function centreY(layer: CosmeticLayer, stageHeightPercent: number): number {
  if (layer.anchor === "center") return stageHeightPercent / 2 + layer.y;
  if (layer.anchor === "bottom") return stageHeightPercent + layer.y;
  return layer.y;
}

/** The inverse: a centre in stage coordinates back to the layer's own `y`. */
function yFromCentre(
  anchor: CosmeticLayer["anchor"],
  centre: number,
  stageHeightPercent: number,
): number {
  if (anchor === "center") return centre - stageHeightPercent / 2;
  if (anchor === "bottom") return centre - stageHeightPercent;
  return centre;
}

const rotate = (x: number, y: number, degrees: number) => {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function LayerCanvas({
  layers,
  stage,
  selectedId,
  onSelect,
  onChange,
  onCommit,
  /** Ratios by url, so a layer that keeps its own proportions still gets
   * handles in the right place. Measured by the caller as images load. */
  ratios,
  variant,
  zoom,
  onZoomChange,
  pan,
  onPanChange,
  resolveSrc,
  children,
  className,
}: {
  layers: CosmeticLayer[];
  stage: StageGeometry;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Called continuously through a drag. */
  onChange: (layers: CosmeticLayer[]) => void;
  /** Called once when a drag or a key press finishes, which is when the result
   * is worth a round trip. */
  onCommit: (layers: CosmeticLayer[]) => void;
  ratios: Record<string, number>;
  /** Which shape of card is on the canvas. Layers are drawn as that shape's
   * placement, and edits are written back to it — see `patchLayer`. */
  variant: string;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  /** How far the whole scene has been shoved around, in screen pixels. Owned
   * by the editor so its "reset view" can put it back. */
  pan: { x: number; y: number };
  onPanChange: (pan: { x: number; y: number }) => void;
  /** A layer's stored url to the picture to draw for it. Identity for a frame,
   * where a url is a url; the decoration editor passes the one that also knows
   * how to draw a preset key. */
  resolveSrc: (url: string) => string;
  children: React.ReactNode;
  className?: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /**
   * The arrangement the last pointer move produced.
   *
   * Committed from here rather than from the `layers` prop, because that prop
   * reaches this component through the parent's state: between the last move
   * and the pointer coming up there may be no re-render, and committing a list
   * from before the final move is a drag that snaps back the moment you let go.
   */
  const pending = useRef<CosmeticLayer[] | null>(null);
  /** A pan in progress: where the pointer went down, and where the scene was
   * at that moment. */
  const [panFrom, setPanFrom] = useState<{
    x: number;
    y: number;
    pan: { x: number; y: number };
    moved: boolean;
  } | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});

  /** Pixels per percent-of-stage-width, which is the only number that connects
   * the stored geometry to the screen. */
  const scale = (stage.width * zoom) / 100;
  const stageHeightPercent = (stage.height / stage.width) * 100;

  /** The height a layer actually occupies, in the same percent-of-width unit —
   * from its own `height`, from the artwork's ratio, or from the card when it
   * stretches. */
  const heightOf = useCallback(
    (layer: CosmeticLayer) => layerHeight(layer, ratios[layer.url], stageHeightPercent),
    [ratios, stageHeightPercent],
  );

  /** What the layers look like on the shape of card currently underneath them.
   * Everything on screen — boxes, handles, hit-testing — is this list; the
   * stored one is only touched when writing an edit back. */
  const placed = useMemo(
    () => layers.map((layer) => resolveLayer(layer, variant)),
    [layers, variant],
  );

  const patch = useCallback(
    (id: string, next: Partial<CosmeticLayer>) =>
      layers.map((layer) => (layer.id === id ? patchLayer(layer, next, variant) : layer)),
    [layers, variant],
  );

  // --- Dragging ------------------------------------------------------------

  const beginDrag = (event: React.PointerEvent, handle: Handle, layer: CosmeticLayer) => {
    event.preventDefault();
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    onSelect(layer.id);
    setDrag({
      handle,
      layerId: layer.id,
      // The placement as drawn, so a drag starts from where the artwork
      // actually is rather than from where the default shape would put it.
      start: resolveLayer(layer, variant),
      startHeight: heightOf(layer),
      pointerX: event.clientX,
      pointerY: event.clientY,
    });
  };

  useEffect(() => {
    if (!drag) return;

    const move = (event: PointerEvent) => {
      const dx = (event.clientX - drag.pointerX) / scale;
      const dy = (event.clientY - drag.pointerY) / scale;
      const snapping = !event.shiftKey;
      const { start } = drag;

      /** Draw it, and remember it as the thing to save when this ends. */
      const apply = (next: CosmeticLayer[]) => {
        pending.current = next;
        onChange(next);
      };

      if (drag.handle === "move") {
        let x = start.x + dx;
        let y = start.y + dy;
        const nextGuides: { x?: number; y?: number } = {};

        if (snapping) {
          // The three lines worth landing on: the stage's left edge, its
          // middle and its right edge, matched against the layer's own centre
          // and its two edges so a frame can be lined up by whichever of them
          // the artwork actually reaches.
          const height = drag.startHeight;
          for (const offset of [0, -start.width / 2, start.width / 2]) {
            for (const target of [0, 50, 100]) {
              if (Math.abs(x + offset - target) < SNAP_TOLERANCE) {
                x = target - offset;
                nextGuides.x = target;
              }
            }
          }
          const centre = centreY({ ...start, y }, stageHeightPercent);
          for (const offset of [0, -height / 2, height / 2]) {
            for (const target of [0, stageHeightPercent / 2, stageHeightPercent]) {
              if (Math.abs(centre + offset - target) < SNAP_TOLERANCE) {
                y = yFromCentre(start.anchor, target - offset, stageHeightPercent);
                nextGuides.y = target;
              }
            }
          }
        }
        setGuides(nextGuides);
        apply(patch(start.id, { x, y }));
        return;
      }

      if (drag.handle === "rotate") {
        // The angle from the layer's centre to the pointer, with the offset
        // that makes "straight up" zero.
        const box = stageRef.current?.getBoundingClientRect();
        if (!box) return;
        const cx = box.left + (start.x / 100) * stage.width * zoom;
        const cy =
          box.top + (centreY(start, stageHeightPercent) / 100) * stage.width * zoom;
        const angle =
          (Math.atan2(event.clientY - cy, event.clientX - cx) * 180) / Math.PI + 90;
        const snapped = snapping ? Math.round(angle / 15) * 15 : angle;
        apply(
          patch(start.id, {
            rotation: clamp(
              ((snapped + 180) % 360) - 180,
              LAYER_LIMITS.rotation.min,
              LAYER_LIMITS.rotation.max,
            ),
          }),
        );
        return;
      }

      // A resize. Work in the layer's own turned frame so the corner opposite
      // the one being dragged can be held still.
      const spec = HANDLES.find((h) => h.handle === drag.handle);
      if (!spec) return;
      const rotation = start.rotation ?? 0;
      const height = drag.startHeight;
      const local = rotate(dx, dy, -rotation);

      let width = start.width;
      let nextHeight: number | undefined = start.height;

      if (spec.fx !== 0) {
        width = clamp(
          start.width + local.x * Math.sign(spec.fx) * 2,
          LAYER_LIMITS.size.min,
          LAYER_LIMITS.size.max,
        );
        // A corner scales the whole thing; an edge handle only widens it. When
        // the height is the artwork's own, it follows the width by itself and
        // there is nothing to write down.
        if (spec.fy !== 0 && start.height !== undefined) {
          nextHeight = (start.height * width) / start.width;
        }
      }
      if (spec.fy !== 0 && spec.fx === 0) {
        nextHeight = clamp(
          height + local.y * Math.sign(spec.fy) * 2,
          LAYER_LIMITS.size.min,
          LAYER_LIMITS.size.max,
        );
      }

      // Keep the fixed corner where it was: the centre moves by half of
      // whatever the box grew, in the direction of the handle.
      // Half of whatever it grew, in the direction of the handle: that is the
      // move that leaves the opposite corner where it was.
      const shift = rotate(
        ((width - start.width) / 2) * Math.sign(spec.fx),
        (((nextHeight ?? height) - height) / 2) * Math.sign(spec.fy),
        rotation,
      );

      apply(
        patch(start.id, {
          width,
          height: nextHeight,
          // Stretching and an explicit height are two answers to the same
          // question, so setting one puts the other away.
          stretchY: nextHeight !== undefined ? undefined : start.stretchY,
          x: start.x + shift.x,
          y: start.y + shift.y,
        }),
      );
    };

    const end = () => {
      setDrag(null);
      setGuides({});
      // Nothing moved — a click that selected something, not a drag.
      if (pending.current) onCommit(pending.current);
      pending.current = null;
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [drag, layers, onChange, onCommit, patch, scale, stage.width, stageHeightPercent, variant, zoom]);

  // --- Panning -------------------------------------------------------------

  /**
   * Dragging anywhere that isn't a layer moves the view.
   *
   * A layer stops its own pointerdown from reaching here, so anything that does
   * reach it is background — the checkerboard, or the card itself, which is a
   * picture of a card rather than a working one. Holding space or using the
   * middle button pans from anywhere, including from on top of a layer, which
   * is the gesture anyone who has used a canvas will try first.
   */
  const beginPan = (event: React.PointerEvent) => {
    if (event.button !== 0 && event.button !== 1) return;
    setPanFrom({ x: event.clientX, y: event.clientY, pan, moved: false });
  };

  useEffect(() => {
    if (!panFrom) return;
    const move = (event: PointerEvent) => {
      const dx = event.clientX - panFrom.x;
      const dy = event.clientY - panFrom.y;
      // A few pixels of slop, so a click that wobbles still counts as a click.
      if (!panFrom.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      panFrom.moved = true;
      onPanChange({ x: panFrom.pan.x + dx, y: panFrom.pan.y + dy });
    };
    const end = () => {
      // A click on the background with no drag in it means "nothing selected".
      if (!panFrom.moved) onSelect(null);
      setPanFrom(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [panFrom, onPanChange, onSelect]);

  /**
   * The wheel: scroll to shove the view about, ctrl (or a pinch, which arrives
   * as ctrl+wheel) to zoom.
   *
   * Listened for by hand rather than with `onWheel`, because React attaches
   * wheel listeners passively and a passive listener cannot call
   * `preventDefault` — without which the dialog behind this scrolls instead.
   */
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const next = Math.min(3, Math.max(0.2, zoom * (1 - event.deltaY / 500)));
        onZoomChange(Math.round(next * 100) / 100);
        return;
      }
      onPanChange({
        x: pan.x - (event.shiftKey ? event.deltaY : event.deltaX),
        y: pan.y - (event.shiftKey ? 0 : event.deltaY),
      });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [onPanChange, onZoomChange, pan.x, pan.y, zoom]);

  /** Space is the hold-to-pan key everywhere else, so it is here too — but only
   * while the pointer is over the canvas, or it would swallow the space bar
   * from every button in the dialog. */
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !rootRef.current?.matches(":hover")) return;
      event.preventDefault();
      setSpaceHeld(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // --- Keyboard ------------------------------------------------------------

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Never while something is being typed into — the inspector's number
      // fields are one tab away from here.
      if (target?.matches("input, textarea, [contenteditable]")) return;

      const step = event.shiftKey ? NUDGE_FAST : NUDGE;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = moves[event.key];
      if (!delta) return;
      event.preventDefault();
      const layer = placed.find((l) => l.id === selectedId);
      if (!layer) return;
      const next = patch(selectedId, { x: layer.x + delta[0], y: layer.y + delta[1] });
      onChange(next);
      onCommit(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placed, onChange, onCommit, patch, selectedId]);

  // --- Render --------------------------------------------------------------

  const selected = placed.find((layer) => layer.id === selectedId) ?? null;

  return (
    <div
      className={cn(
        // The checkerboard says "transparent" the way every image editor does,
        // which matters here: almost every frame is mostly nothing.
        "relative flex items-center justify-center overflow-hidden rounded-md border border-border/50 bg-[repeating-conic-gradient(#0000_0_25%,#ffffff12_0_50%)] bg-[length:16px_16px]",
        className,
      )}
      ref={rootRef}
      onPointerDown={beginPan}
      style={{ cursor: panFrom?.moved ? "grabbing" : spaceHeld ? "grab" : undefined }}
    >
      <div
        ref={stageRef}
        className="relative"
        style={{
          width: stage.width * zoom,
          height: stage.height * zoom,
          // The whole scene, shifted. Layer geometry is worked out from pointer
          // *deltas*, which a translation doesn't touch, so panning needs no
          // other allowance anywhere.
          transform: `translate(${pan.x}px, ${pan.y}px)`,
        }}
      >
        <div
          // Rendered at its true size and scaled as a whole, so every
          // proportion inside it — text, avatar, padding — stays right at any
          // zoom instead of being re-laid out smaller.
          className="absolute top-0 left-0 origin-top-left"
          style={{ width: stage.width, height: stage.height, transform: `scale(${zoom})` }}
        >
          {children}
        </div>

        {placed.map((layer) => {
          const height = heightOf(layer);
          const isSelected = layer.id === selectedId;
          const box = {
            left: ((layer.x - layer.width / 2) / 100) * stage.width * zoom,
            top:
              ((centreY(layer, stageHeightPercent) - height / 2) / 100) * stage.width * zoom,
            width: (layer.width / 100) * stage.width * zoom,
            height: (height / 100) * stage.width * zoom,
          };
          return (
            <div
              key={layer.id}
              // The whole layer is the move handle. A frame is mostly
              // transparent, so hit-testing the picture itself would mean
              // hunting for a pixel of it to grab.
              onPointerDown={(event) => beginDrag(event, "move", layer)}
              className={cn(
                "absolute cursor-move",
                isSelected ? "outline-2 outline-primary" : "hover:outline-1 hover:outline-primary/50",
              )}
              style={{
                ...box,
                transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
                opacity: layer.opacity ?? 1,
              }}
            >
              <img
                src={resolveSrc(layer.url)}
                alt=""
                draggable={false}
                className="pointer-events-none size-full select-none object-contain"
                style={{ objectFit: layer.height !== undefined ? "fill" : "contain" }}
              />

              {isSelected && (
                <>
                  {HANDLES.map((spec) => (
                    <span
                      key={spec.handle}
                      onPointerDown={(event) => beginDrag(event, spec.handle, layer)}
                      style={{
                        cursor: spec.cursor,
                        left: `calc(${(spec.fx + 0.5) * 100}% - 5px)`,
                        top: `calc(${(spec.fy + 0.5) * 100}% - 5px)`,
                      }}
                      className="absolute size-2.5 rounded-[2px] border border-primary bg-background"
                    />
                  ))}
                  <span
                    onPointerDown={(event) => beginDrag(event, "rotate", layer)}
                    style={{ left: "calc(50% - 6px)", top: -26 }}
                    className="absolute size-3 cursor-grab rounded-full border border-primary bg-background"
                  />
                </>
              )}
            </div>
          );
        })}

        {/* Snap guides, drawn only while something has landed on one. */}
        {guides.x !== undefined && (
          <span
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-primary/70"
            style={{ left: (guides.x / 100) * stage.width * zoom }}
          />
        )}
        {guides.y !== undefined && (
          <span
            className="pointer-events-none absolute right-0 left-0 h-px bg-primary/70"
            style={{ top: (guides.y / 100) * stage.width * zoom }}
          />
        )}
      </div>

      {/* A word about what to do, but only when there's nothing to do it to. */}
      {layers.length === 0 && (
        <p className="pointer-events-none absolute bottom-3 text-xs text-muted-foreground">
          Add an image to start
        </p>
      )}
      {selected && (
        <p className="pointer-events-none absolute right-2 bottom-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          {Math.round(selected.width)}% × {Math.round(heightOf(selected))}%
        </p>
      )}
    </div>
  );
}

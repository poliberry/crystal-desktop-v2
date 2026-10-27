"use client";

import { useEffect, useRef } from "react";

/** The ruler's thickness in screen pixels. */
export const RULER_SIZE = 16;

/** A theme colour, resolved to something a canvas will take (custom properties and color-mix() are not). */
function themed(el: HTMLElement, name: string, fallback: string): string {
  el.style.color = `var(${name}, ${fallback})`;
  return getComputedStyle(el).color || fallback;
}
const NICE = [1, 2, 5];

/** Round numbers a label can sit on: 1, 2, 5, 10, 20, 50, 100… */
function niceStep(minUnits: number): number {
  let magnitude = 10 ** Math.floor(Math.log10(Math.max(minUnits, 1e-6)));
  for (let guard = 0; guard < 40; guard++) {
    for (const n of NICE) if (n * magnitude >= minUnits) return n * magnitude;
    magnitude *= 10;
  }
  return magnitude;
}

const fmt = (v: number) => String(Number(v.toFixed(3)));

/**
 * Where the ticks and labels fall for a view: positions in screen pixels along the
 * ruler, with the document-unit value each stands for. Pure so it can be tested
 * without a canvas.
 *
 * `offset` is the screen position of document 0 along the ruler's axis, `length`
 * how far the ruler runs. Labels are never closer than ~64px; between two labels
 * there are ten divisions, a stronger one at the half, and divisions that would be
 * closer than 4px are left out.
 */
export function rulerTicks(zoom: number, offset: number, length: number): { px: number; value: number; level: "major" | "half" | "minor" }[] {
  const labelStep = niceStep(64 / zoom);
  const minor = labelStep / 10;
  const showMinor = minor * zoom >= 4;
  const showHalf = (labelStep / 2) * zoom >= 4;
  const from = Math.floor((0 - offset) / zoom / minor) - 1;
  const to = Math.ceil((length - offset) / zoom / minor) + 1;
  const out: { px: number; value: number; level: "major" | "half" | "minor" }[] = [];
  for (let i = from; i <= to; i++) {
    const level = i % 10 === 0 ? "major" : i % 5 === 0 ? "half" : "minor";
    if (level === "minor" && !showMinor) continue;
    if (level === "half" && !showHalf) continue;
    const value = i * minor;
    out.push({ px: offset + value * zoom, value, level });
  }
  return out;
}

/**
 * One ruler. `top` measures x along the top edge; `left` measures y down the left
 * edge. `offset` is where document 0 sits along it, already relative to this
 * element (so the caller subtracts the corner).
 *
 * The ruler only draws. The viewport above it reads `data-ruler` off the pointer
 * target to start a guide drag, which keeps all pointer handling in one place.
 */
export function Ruler({
  side,
  zoom,
  offset,
  length,
  markerRef,
}: {
  side: "top" | "left";
  zoom: number;
  offset: number;
  length: number;
  markerRef: React.Ref<HTMLDivElement>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const top = side === "top";

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || length <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = top ? length : RULER_SIZE;
    const h = top ? RULER_SIZE : length;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const BG = themed(canvas, "--ai-ruler-bg", "#535353");
    const EDGE = themed(canvas, "--ai-ruler-edge", "#303030");
    const TICK = themed(canvas, "--ai-ruler-tick", "#a0a0a0");
    const TEXT = themed(canvas, "--ai-ruler-text", "#c0c0c0");
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = TICK;
    ctx.fillStyle = TEXT;
    ctx.lineWidth = 1;
    ctx.font = "9px \"Segoe UI\", system-ui, sans-serif";
    ctx.textBaseline = "top";

    const size = { major: RULER_SIZE, half: RULER_SIZE * 0.55, minor: RULER_SIZE * 0.3 } as const;
    ctx.beginPath();
    for (const t of rulerTicks(zoom, offset, length)) {
      const p = Math.round(t.px) + 0.5;
      const len = size[t.level];
      if (top) {
        ctx.moveTo(p, RULER_SIZE);
        ctx.lineTo(p, RULER_SIZE - len);
      } else {
        ctx.moveTo(RULER_SIZE, p);
        ctx.lineTo(RULER_SIZE - len, p);
      }
    }
    ctx.stroke();

    for (const t of rulerTicks(zoom, offset, length)) {
      if (t.level !== "major") continue;
      const p = Math.round(t.px);
      if (top) {
        ctx.fillText(fmt(t.value), p + 3, 2);
      } else {
        ctx.save();
        ctx.translate(2, p - 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(fmt(t.value), 0, 0);
        ctx.restore();
      }
    }

    // The edge that separates it from the canvas.
    ctx.strokeStyle = EDGE;
    ctx.beginPath();
    if (top) {
      ctx.moveTo(0, RULER_SIZE - 0.5);
      ctx.lineTo(w, RULER_SIZE - 0.5);
    } else {
      ctx.moveTo(RULER_SIZE - 0.5, 0);
      ctx.lineTo(RULER_SIZE - 0.5, h);
    }
    ctx.stroke();
  }, [top, zoom, offset, length]);

  return (
    <div
      data-ruler={side}
      className="absolute z-10"
      style={
        top
          ? { left: RULER_SIZE, top: 0, width: Math.max(0, length), height: RULER_SIZE, cursor: "row-resize" }
          : { left: 0, top: RULER_SIZE, width: RULER_SIZE, height: Math.max(0, length), cursor: "col-resize" }
      }
      title={top ? "Drag down to make a horizontal guide" : "Drag right to make a vertical guide"}
    >
      <canvas ref={ref} className="pointer-events-none block" style={{ width: top ? length : RULER_SIZE, height: top ? RULER_SIZE : length }} />
      {/* Moved by the viewport as the pointer moves, so the ruler needn't redraw. */}
      <div
        ref={markerRef}
        className="pointer-events-none absolute bg-[var(--ai-select)]"
        style={top ? { left: 0, top: 0, width: 1, height: RULER_SIZE, display: "none" } : { left: 0, top: 0, width: RULER_SIZE, height: 1, display: "none" }}
      />
    </div>
  );
}

/** The square where the two rulers meet. */
export function RulerCorner() {
  return <div className="pointer-events-none absolute top-0 left-0 z-10 border-r border-b border-[var(--ai-edge)] bg-[var(--ai-ruler-bg)]" style={{ width: RULER_SIZE, height: RULER_SIZE }} />;
}

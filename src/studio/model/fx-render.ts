import { applyShader, fxBox, fxPadding, linearEnds, parseColor, sortedStops, toRgbaString, type Box } from "@/studio/model/fx";
import { pathD } from "@/studio/model/path";
import { brushPolygons, orient } from "@/studio/model/brush";
import { materialPixels } from "@/studio/model/material";
import type { Gradient, ImageNode, Material, Node, PathNode, ShapeNode, TextNode } from "@/studio/model/types";

/**
 * Drawing a node to a canvas, with its effects.
 *
 * This is the one place a node's pixels are made. The editor shows what it returns, the store
 * picture is composed from it, and a node with effects is sent to the server as the picture it
 * returns — so what a creator sees, what the listing shows and what a buyer gets are the same.
 * It uses a 2D canvas only: effects that need the pixels run in `applyShader` over ImageData, so
 * the result doesn't depend on a GPU.
 */

export type Images = Map<string, HTMLImageElement>;

// --- Loading ----------------------------------------------------------------------------------

const loaded = new Map<string, Promise<HTMLImageElement>>();

/** An image by address, loaded once. Rejects (and forgets) if it can't be read. */
export function loadImageUrl(url: string): Promise<HTMLImageElement> {
  let p = loaded.get(url);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        loaded.delete(url);
        reject(new Error("A picture in this design couldn't be read."));
      };
      img.src = url;
    });
    loaded.set(url, p);
  }
  return p;
}

// --- Plain drawing ----------------------------------------------------------------------------

function gradientStyle(ctx: CanvasRenderingContext2D, g: Gradient, w: number, h: number): CanvasGradient {
  let grad: CanvasGradient;
  if (g.type === "radial") {
    // A circle reaching the farthest corner, as CSS's `circle farthest-corner` does.
    grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(1e-6, Math.hypot(w, h) / 2));
  } else {
    const e = linearEnds(g, w, h);
    grad = ctx.createLinearGradient(e.x0, e.y0, e.x1, e.y1);
  }
  for (const s of sortedStops(g.stops)) grad.addColorStop(s.offset, toRgbaString(parseColor(s.color)));
  return grad;
}

// Making a texture costs real time, and the same one is wanted again for every redraw that doesn't change it.
const textures = new Map<string, HTMLCanvasElement>();

/**
 * A material as a fill or stroke style for the node being drawn. The context's current transform is the
 * node's (artboard scale, turn and offset), so its length along x is pixels per artboard unit, which is
 * the resolution the texture is made at; one texture pixel is then laid on one device pixel. The texture
 * reaches `reach` units past the node's box so that the outer half of an outline is textured too.
 */
function materialStyle(ctx: CanvasRenderingContext2D, m: Material, w: number, h: number, reach: number): CanvasPattern | string {
  const t = ctx.getTransform();
  const scale = Math.min(8, Math.max(0.05, Math.hypot(t.a, t.b)));
  const pad = Math.ceil(reach);
  const pw = Math.max(1, Math.ceil((w + pad * 2) * scale));
  const ph = Math.max(1, Math.ceil((h + pad * 2) * scale));
  const key = `${JSON.stringify(m)}|${pw}x${ph}|${scale.toFixed(3)}|${pad}`;
  let tex = textures.get(key);
  if (!tex) {
    tex = newCanvas(pw, ph);
    const data = new ImageData(materialPixels(m, pw, ph, scale, { x: -pad, y: -pad }) as unknown as Uint8ClampedArray<ArrayBuffer>, pw, ph);
    tex.getContext("2d")!.putImageData(data, 0, 0);
    textures.set(key, tex);
    // Keep the few most recent: a design has a handful of materials, and a drag shouldn't pile up pictures.
    if (textures.size > 16) textures.delete(textures.keys().next().value as string);
  }
  const pattern = ctx.createPattern(tex, "no-repeat");
  if (!pattern) return m.color;
  // One texture pixel is 1/scale units, and the picture starts `pad` units before the node's corner.
  pattern.setTransform(new DOMMatrix().translate(-pad, -pad).scale(1 / scale));
  return pattern;
}

/** What to paint with: a material over a gradient over a colour. */
function paintStyle(ctx: CanvasRenderingContext2D, color: string, gradient: Gradient | undefined, material: Material | undefined, w: number, h: number, reach = 0): string | CanvasGradient | CanvasPattern {
  if (material) return materialStyle(ctx, material, w, h, reach);
  if (gradient) return gradientStyle(ctx, gradient, w, h);
  return color;
}

/**
 * One node, turned and placed in artboard units, with its opacity, and no effects. The
 * context's current transform is the artboard's.
 */
export function drawNode(ctx: CanvasRenderingContext2D, n: Node, images: Images, opts: { opacity?: boolean } = {}) {
  const c = { x: n.x + n.w / 2, y: n.y + n.h / 2 };
  ctx.save();
  if (opts.opacity !== false) ctx.globalAlpha = n.opacity;
  ctx.translate(c.x, c.y);
  if (n.rotation) ctx.rotate((n.rotation * Math.PI) / 180);
  ctx.translate(-n.w / 2, -n.h / 2);

  if (n.type === "image") {
    const img = images.get((n as ImageNode).assetId);
    if (img) ctx.drawImage(img, 0, 0, n.w, n.h);
  } else if (n.type === "shape") {
    const s = n as ShapeNode;
    ctx.beginPath();
    if (s.shape === "ellipse") ctx.ellipse(n.w / 2, n.h / 2, n.w / 2, n.h / 2, 0, 0, Math.PI * 2);
    else ctx.roundRect(0, 0, n.w, n.h, Math.min(s.radius, n.w / 2, n.h / 2));
    ctx.fillStyle = paintStyle(ctx, s.fill, s.fillGradient, s.fillMaterial, n.w, n.h);
    ctx.fill();
    if (s.strokeWidth > 0) {
      ctx.lineWidth = s.strokeWidth;
      ctx.strokeStyle = paintStyle(ctx, s.stroke, s.strokeGradient, s.strokeMaterial, n.w, n.h, s.strokeWidth);
      ctx.stroke();
    }
  } else if (n.type === "path") {
    const pn = n as PathNode;
    const d = pathD(pn.points, pn.closed, n.w, n.h);
    if (d) {
      const path = new Path2D(d);
      // An open path is filled as though closed, as every vector editor does, but only if it has a fill.
      if (pn.fill !== "none" || pn.fillGradient || pn.fillMaterial) {
        ctx.fillStyle = paintStyle(ctx, pn.fill, pn.fillGradient, pn.fillMaterial, n.w, n.h);
        // Several contours are a compound path: where one lies in another there is a hole.
        ctx.fill(path, pn.points.some((q) => q.m) ? "evenodd" : "nonzero");
      }
      if (pn.strokeWidth > 0 && pn.brush) {
        // A brush's marks are filled, in the stroke's paint, as one shape so that overlapping marks don't
        // double up a translucent colour.
        const marks = new Path2D();
        for (const poly of brushPolygons(pn.points, pn.closed, n.w, n.h, pn.brush, pn.strokeWidth)) {
          const q = orient(poly);
          marks.moveTo(q[0].x, q[0].y);
          for (let i = 1; i < q.length; i++) marks.lineTo(q[i].x, q[i].y);
          marks.closePath();
        }
        ctx.fillStyle = paintStyle(ctx, pn.stroke, pn.strokeGradient, pn.strokeMaterial, n.w, n.h, pn.strokeWidth * 1.4 + 2);
        ctx.fill(marks, "nonzero");
      } else if (pn.strokeWidth > 0) {
        ctx.lineWidth = pn.strokeWidth;
        ctx.lineCap = pn.cap;
        ctx.lineJoin = pn.join;
        ctx.miterLimit = 8;
        ctx.strokeStyle = paintStyle(ctx, pn.stroke, pn.strokeGradient, pn.strokeMaterial, n.w, n.h, pn.strokeWidth * (pn.join === "miter" ? 1.5 : 0.5) + 2);
        ctx.stroke(path);
      }
    }
  } else if (n.type === "text") {
    const t = n as TextNode;
    ctx.font = `${t.italic ? "italic " : ""}${t.fontWeight} ${t.fontSize}px system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = t.align;
    const x = t.align === "left" ? 0 : t.align === "right" ? n.w : n.w / 2;
    const lines = t.text.split("\n");
    const lh = t.fontSize * 1.15;
    const top = n.h / 2 - ((lines.length - 1) * lh) / 2;
    const fill = paintStyle(ctx, t.color, t.colorGradient, t.colorMaterial, n.w, n.h);
    lines.forEach((line, i) => {
      if (t.strokeWidth > 0) {
        ctx.lineWidth = t.strokeWidth * 2;
        ctx.lineJoin = "round";
        ctx.strokeStyle = t.stroke;
        ctx.strokeText(line, x, top + i * lh);
      }
      ctx.fillStyle = fill;
      ctx.fillText(line, x, top + i * lh);
    });
  }
  ctx.restore();
}

// --- With effects -----------------------------------------------------------------------------

function newCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Draw only the shadow of `src` (its alpha, softened and tinted) and not `src` itself. The
 * picture is drawn off to the left of the canvas and its shadow thrown back across, which is
 * the one way a 2D canvas will show a shadow without its caster.
 */
function shadowOnly(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, dx: number, dy: number, blurPx: number, color: string, opacity: number) {
  const away = src.width + Math.ceil(blurPx) * 4 + 64;
  const [r, g, b, a] = parseColor(color);
  ctx.save();
  ctx.shadowColor = `rgba(${r},${g},${b},${+(a * Math.min(1, Math.max(0, opacity))).toFixed(3)})`;
  ctx.shadowBlur = blurPx;
  ctx.shadowOffsetX = dx + away;
  ctx.shadowOffsetY = dy;
  ctx.drawImage(src, -away, 0);
  ctx.restore();
}

/**
 * A node drawn to its own picture, effects and all, with no opacity (a layer carries that) and
 * no rotation left to apply (it is baked in). Returns the picture and where it goes in the artboard.
 *
 * `scale` is pixels per artboard unit.
 */
export function renderFx(n: Node, images: Images, scale: number): { canvas: HTMLCanvasElement; box: Box } {
  const box = fxBox(n);
  const W = Math.max(1, Math.ceil(box.w * scale));
  const H = Math.max(1, Math.ceil(box.h * scale));
  const fx = n.fx;

  // 1. The node itself.
  let body = newCanvas(W, H);
  {
    const ctx = body.getContext("2d")!;
    ctx.scale(W / box.w, H / box.h);
    ctx.translate(-box.x, -box.y);
    drawNode(ctx, n, images, { opacity: false });
  }

  // 2. Blur, then the pixel programs, in the order they were added.
  if (fx?.blur && fx.blur > 0) {
    const out = newCanvas(W, H);
    const ctx = out.getContext("2d")!;
    ctx.filter = `blur(${+(fx.blur * scale).toFixed(2)}px)`;
    ctx.drawImage(body, 0, 0);
    body = out;
  }
  const shaders = (fx?.shaders ?? []).filter((s) => s.on);
  if (shaders.length) {
    const ctx = body.getContext("2d")!;
    const data = ctx.getImageData(0, 0, W, H);
    for (const s of shaders) applyShader(data.data, W, H, s, scale);
    ctx.putImageData(data, 0, 0);
  }

  // 3. Glow and shadow behind it, inner shadow over it.
  const out = newCanvas(W, H);
  const ctx = out.getContext("2d")!;
  if (fx?.glow?.on) {
    // Strength stacks the halo, as Illustrator's Outer Glow opacity can't exceed 100%.
    const reps = Math.max(1, Math.min(6, Math.round(fx.glow.strength)));
    for (let i = 0; i < reps; i++) shadowOnly(ctx, body, 0, 0, fx.glow.blur * scale, fx.glow.color, fx.glow.opacity);
  }
  if (fx?.shadow?.on) shadowOnly(ctx, body, fx.shadow.x * scale, fx.shadow.y * scale, fx.shadow.blur * scale, fx.shadow.color, fx.shadow.opacity);
  ctx.drawImage(body, 0, 0);
  if (fx?.innerGlow?.on) {
    const g = fx.innerGlow;
    // The glow of everything that *isn't* the node, kept only where the node is: light creeping in from the edge.
    const hole = newCanvas(W, H);
    const hctx = hole.getContext("2d")!;
    hctx.fillStyle = "#000";
    hctx.fillRect(0, 0, W, H);
    hctx.globalCompositeOperation = "destination-out";
    hctx.drawImage(body, 0, 0);
    const inner = newCanvas(W, H);
    const ictx = inner.getContext("2d")!;
    const reps = Math.max(1, Math.min(6, Math.round(g.strength)));
    for (let i = 0; i < reps; i++) shadowOnly(ictx, hole, 0, 0, g.blur * scale, g.color, g.opacity);
    ictx.globalCompositeOperation = "destination-in";
    ictx.drawImage(body, 0, 0);
    ctx.drawImage(inner, 0, 0);
  }
  if (fx?.innerShadow?.on) {
    const s = fx.innerShadow;
    // The shadow of everything that *isn't* the node, kept only where the node is.
    const hole = newCanvas(W, H);
    const hctx = hole.getContext("2d")!;
    hctx.fillStyle = "#000";
    hctx.fillRect(0, 0, W, H);
    hctx.globalCompositeOperation = "destination-out";
    hctx.drawImage(body, 0, 0);
    const inner = newCanvas(W, H);
    const ictx = inner.getContext("2d")!;
    shadowOnly(ictx, hole, s.x * scale, s.y * scale, s.blur * scale, s.color, s.opacity);
    ictx.globalCompositeOperation = "destination-in";
    ictx.drawImage(body, 0, 0);
    ctx.drawImage(inner, 0, 0);
  }
  return { canvas: out, box };
}

/** How many pixels per unit a baked picture is made at: sharp, but never huge. */
export function bakeScale(box: Box): number {
  return Math.min(4, Math.max(1, 1024 / Math.max(box.w, box.h, 1)));
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the picture."))), "image/png"));
}

export { fxPadding };

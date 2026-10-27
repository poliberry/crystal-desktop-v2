import {
  fbm2, parseHex, parseRgba, particlesAt, restOffset, sampleClips, textChars, evalColor, evalProp, rgbaString,
  type BlendMode, type Clip, type MotionSpec, type Particle, type Resolved, type ResolvedFx, type Source,
} from "../../convex/lib/motion";

/**
 * Drawing a motion design to a canvas.
 *
 * `convex/lib/motion.ts` decides what is on screen at a moment (every keyframe, retime, transition and particle
 * evaluated); this turns that into pixels with a 2D canvas, and nothing else. The app plays designs with it and
 * Crystal Studio previews with the very same code, so the editor shows what everyone else will see.
 *
 * A design is drawn onto an internal canvas exactly as big as its stage at the chosen `scale` (pixels per stage
 * unit), so effects and masks are in stage units whatever size it is shown at; `drawCover` then places that on a
 * visible canvas the way `object-fit: cover` would.
 */

export type MotionImages = Map<string, CanvasImageSource>;

/** The key a canvas layer's picture is kept under in `MotionImages` while editing in Studio. */
export const layerKey = (nodeId: string) => `layer:${nodeId}`;

const BLEND: Record<BlendMode, GlobalCompositeOperation> = {
  normal: "source-over",
  add: "lighter",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  softLight: "soft-light",
  hardLight: "hard-light",
  colorDodge: "color-dodge",
  difference: "difference",
  lighten: "lighten",
  darken: "darken",
};

type Ctx = CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** `rgba(r,g,b,a)` with its alpha multiplied by `k`. */
function withAlpha(color: string, k: number): string {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(color);
  return m ? `rgba(${m[1]},${m[2]},${m[3]},${+(parseFloat(m[4]) * k).toFixed(3)})` : color;
}

/** The CSS filter a clip's effects and transition amount to, in stage units scaled to pixels. */
export function filterFor(fx: ResolvedFx[], extraBlur: number, flash: number, scale: number): string {
  const parts: string[] = [];
  const blur = fx.reduce((s, f) => s + (f.type === "blur" ? f.amount : 0), 0) + extraBlur;
  if (blur > 0.01) parts.push(`blur(${+(blur * scale).toFixed(2)}px)`);
  for (const f of fx) {
    if (f.type === "adjust") parts.push(`hue-rotate(${+f.hue.toFixed(1)}deg) saturate(${+f.saturation.toFixed(3)}) brightness(${+f.brightness.toFixed(3)}) contrast(${+f.contrast.toFixed(3)})`);
  }
  if (flash > 0.001) parts.push(`brightness(${+(1 + flash).toFixed(3)})`);
  for (const f of fx) {
    if (f.type === "glow" && f.strength > 0 && f.blur > 0) {
      // Strength stacks the halo, as Outer Glow's does; a fraction fades the first layer.
      const reps = Math.max(1, Math.ceil(f.strength));
      for (let i = 0; i < reps; i++) parts.push(`drop-shadow(0 0 ${+(f.blur * scale).toFixed(2)}px ${withAlpha(f.color, i === reps - 1 ? f.strength - (reps - 1) : 1)})`);
    } else if (f.type === "shadow") {
      parts.push(`drop-shadow(${+(f.x * scale).toFixed(2)}px ${+(f.y * scale).toFixed(2)}px ${+(f.blur * scale).toFixed(2)}px ${withAlpha(f.color, f.opacity)})`);
    }
  }
  return parts.length ? parts.join(" ") : "none";
}

// --- Shapes -------------------------------------------------------------------------------------

function starPath(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, points: number, inner: number) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const k = i % 2 ? inner : 1;
    const x = cx + Math.cos(a) * rx * k;
    const y = cy + Math.sin(a) * ry * k;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function heartPath(ctx: Ctx, cx: number, cy: number, rx: number, ry: number) {
  ctx.beginPath();
  for (let i = 0; i <= 32; i++) {
    const t = (i / 32) * Math.PI * 2;
    const x = cx + (16 * Math.sin(t) ** 3 / 16) * rx;
    const y = cy - ((13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16) * ry;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawParticle(ctx: Ctx, p: Particle) {
  if (p.alpha <= 0.002 || p.size <= 0.05) return;
  ctx.save();
  ctx.globalAlpha *= p.alpha;
  ctx.translate(p.x, p.y);
  ctx.rotate((p.rotation * Math.PI) / 180);
  const r = p.size / 2;
  ctx.fillStyle = rgbaString(parseHex(p.color));
  ctx.strokeStyle = ctx.fillStyle;
  switch (p.shape) {
    case "square":
      ctx.fillRect(-r, -r, p.size, p.size);
      break;
    case "star":
      starPath(ctx, 0, 0, r, r, 5, 0.45);
      ctx.fill();
      break;
    case "heart":
      heartPath(ctx, 0, 0, r, r);
      ctx.fill();
      break;
    case "spark":
      starPath(ctx, 0, 0, r * 1.3, r * 1.3, 4, 0.18);
      ctx.fill();
      break;
    case "ring":
      ctx.lineWidth = Math.max(0.5, p.size * 0.16);
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(0.1, r - ctx.lineWidth / 2), 0, Math.PI * 2);
      ctx.stroke();
      break;
    default:
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
  }
  ctx.restore();
}

// --- The renderer -------------------------------------------------------------------------------

/** How big a source is, as the box its anchor is measured in, in stage units. */
function boxOf(ctx: Ctx, s: Source, stage: { w: number; h: number }): { w: number; h: number } {
  switch (s.type) {
    case "rays":
      return { w: s.r * 2, h: s.r * 2 };
    case "compound":
    case "adjust":
      return { w: stage.w, h: stage.h };
    case "layer":
      return { w: s.w, h: s.h };
    case "text": {
      ctx.save();
      ctx.font = fontOf(s);
      const w = Math.max(1, ctx.measureText(s.text).width);
      ctx.restore();
      return { w, h: s.size * 1.25 };
    }
    default:
      return { w: s.w, h: s.h };
  }
}

const fontOf = (s: Extract<Source, { type: "text" }>) => `${s.italic ? "italic " : ""}${s.weight} ${s.size}px system-ui, -apple-system, "Segoe UI", sans-serif`;

let measureCtx: CanvasRenderingContext2D | null = null;

/** The box a source is drawn in, in stage units: what the viewer's handles surround. Text is measured. */
export function sourceBox(s: Source, stage: { w: number; h: number }): { w: number; h: number } {
  if (s.type === "text") {
    measureCtx ??= makeCanvas(4, 4).getContext("2d")!;
    return boxOf(measureCtx, s, stage);
  }
  return boxOf(null as unknown as Ctx, s, stage);
}

export class MotionRenderer {
  private pool: HTMLCanvasElement[] = [];
  private noiseTile = new Map<string, HTMLCanvasElement>();
  /** The internal canvas the design is drawn to; replaced when the size changes. */
  canvas: HTMLCanvasElement;

  constructor(
    public spec: MotionSpec,
    private images: MotionImages,
    public scale: number,
  ) {
    this.canvas = makeCanvas(spec.stage.w * scale, spec.stage.h * scale);
  }

  setScale(scale: number) {
    const s = Math.max(0.1, Math.min(3, scale));
    if (Math.abs(s - this.scale) < 0.01) return;
    this.scale = s;
    this.canvas = makeCanvas(this.spec.stage.w * s, this.spec.stage.h * s);
    this.pool = [];
  }

  setImages(images: MotionImages) {
    this.images = images;
  }

  /** A scratch canvas the size of the stage, cleared; `slot` keeps nested levels from sharing one. */
  private scratch(slot: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
    const w = Math.max(1, Math.round(this.spec.stage.w * this.scale));
    const h = Math.max(1, Math.round(this.spec.stage.h * this.scale));
    let c = this.pool[slot];
    if (!c || c.width !== w || c.height !== h) c = this.pool[slot] = makeCanvas(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: false })!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.scale(this.scale, this.scale);
    return { canvas: c, ctx };
  }

  /** Draw the design at time `t` seconds, returning the internal canvas (stage-sized, transparent where nothing is). */
  render(t: number): HTMLCanvasElement {
    const ctx = this.canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.scale(this.scale, this.scale);
    this.drawClips(ctx, this.spec.clips, t, this.spec.stage, 0);
    return this.canvas;
  }

  private drawClips(target: Ctx, clips: Clip[], t: number, stage: { w: number; h: number }, depth: number) {
    for (const r of sampleClips(clips, t, stage)) {
      if (r.opacity <= 0.001 && r.clip.source.type !== "adjust") continue;
      if (r.clip.source.type === "adjust") this.adjustLayer(target, r, stage, depth);
      else this.drawClip(target, r, stage, depth);
    }
  }

  private pixelFilter(r: Resolved) {
    return filterFor(r.fx, r.transition.blur, r.transition.flash, this.scale);
  }

  /** An adjustment layer: what is below it so far is redrawn through its effects. */
  private adjustLayer(target: Ctx, r: Resolved, stage: { w: number; h: number }, depth: number) {
    const snap = this.scratch(depth * 3 + 1);
    snap.ctx.setTransform(1, 0, 0, 1, 0, 0);
    snap.ctx.drawImage(target.canvas, 0, 0);
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    const op = Math.min(1, Math.max(0, r.opacity));
    target.clearRect(0, 0, target.canvas.width, target.canvas.height);
    if (op < 1) target.drawImage(snap.canvas, 0, 0);
    target.globalAlpha = op;
    target.filter = this.pixelFilter(r);
    target.drawImage(snap.canvas, 0, 0);
    target.restore();
    void stage;
  }

  private drawClip(target: Ctx, r: Resolved, stage: { w: number; h: number }, depth: number) {
    const layer = this.scratch(depth * 3);
    const lctx = layer.ctx;
    const src = r.clip.source;
    const box = boxOf(lctx, src, stage);

    lctx.save();
    // The pivot: the stage's centre, where the source rests (a picture drawn off-centre), and the clip's own offset.
    const rest = restOffset(src);
    lctx.translate(stage.w / 2 + r.x + rest.x, stage.h / 2 + r.y + rest.y);
    if (r.rotation) lctx.rotate((r.rotation * Math.PI) / 180);
    lctx.scale(r.sx, r.sy);
    lctx.translate(-r.anchorX * box.w, -r.anchorY * box.h);
    this.drawSource(lctx, r, box, stage, depth);
    lctx.restore();

    // Tint: colour laid over the clip's own pixels only.
    for (const f of r.fx) {
      if (f.type !== "tint" || f.amount <= 0) continue;
      lctx.save();
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.globalCompositeOperation = "source-atop";
      lctx.globalAlpha = f.amount;
      lctx.fillStyle = f.color;
      lctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
      lctx.restore();
    }

    if (r.mask || r.transition.wipe) this.applyMasks(layer, r, stage, depth);

    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = r.opacity;
    target.globalCompositeOperation = BLEND[r.blend] ?? "source-over";
    target.filter = this.pixelFilter(r);
    target.drawImage(layer.canvas, 0, 0);
    target.restore();
  }

  /** The clip's mask and any wipe, cut out of its layer. */
  private applyMasks(layer: { canvas: HTMLCanvasElement; ctx: Ctx }, r: Resolved, stage: { w: number; h: number }, depth: number) {
    const mk = this.scratch(depth * 3 + 1);
    const m = mk.ctx;
    const cut = (invert: boolean) => {
      layer.ctx.save();
      layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
      layer.ctx.globalCompositeOperation = invert ? "destination-out" : "destination-in";
      layer.ctx.drawImage(mk.canvas, 0, 0);
      layer.ctx.restore();
    };
    if (r.mask) {
      const k = r.mask;
      m.save();
      if (k.feather > 0) m.filter = `blur(${+(k.feather * this.scale).toFixed(2)}px)`;
      const rest = restOffset(r.clip.source);
      m.translate(stage.w / 2 + r.x + rest.x, stage.h / 2 + r.y + rest.y);
      if (r.rotation) m.rotate((r.rotation * Math.PI) / 180);
      m.scale(r.sx, r.sy);
      m.fillStyle = "#000";
      m.beginPath();
      if (k.shape === "ellipse") m.ellipse(k.x, k.y, Math.max(0.01, k.w / 2), Math.max(0.01, k.h / 2), 0, 0, Math.PI * 2);
      else m.rect(k.x - k.w / 2, k.y - k.h / 2, k.w, k.h);
      m.fill();
      m.restore();
      cut(k.invert);
    }
    if (r.transition.wipe) {
      const { dir, p } = r.transition.wipe;
      const mk2 = this.scratch(depth * 3 + 1);
      const c = mk2.ctx;
      c.fillStyle = "#000";
      // Revealed from the side the direction names: wipe "left" uncovers from the left edge rightwards.
      const W = stage.w;
      const H = stage.h;
      if (dir === "left") c.fillRect(0, 0, W * p, H);
      else if (dir === "right") c.fillRect(W * (1 - p), 0, W * p, H);
      else if (dir === "up") c.fillRect(0, 0, W, H * p);
      else c.fillRect(0, H * (1 - p), W, H * p);
      layer.ctx.save();
      layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
      layer.ctx.globalCompositeOperation = "destination-in";
      layer.ctx.drawImage(mk2.canvas, 0, 0);
      layer.ctx.restore();
    }
  }

  private drawSource(ctx: Ctx, r: Resolved, box: { w: number; h: number }, stage: { w: number; h: number }, depth: number) {
    const s = r.clip.source;
    const lt = r.local;
    switch (s.type) {
      case "image":
      case "layer": {
        const img = this.images.get(s.type === "image" ? s.url : layerKey(s.nodeId));
        if (img) ctx.drawImage(img, 0, 0, s.w, s.h);
        break;
      }
      case "solid":
        ctx.fillStyle = evalColor(s.color, lt);
        ctx.fillRect(0, 0, s.w, s.h);
        break;
      case "shape":
        this.drawShape(ctx, s, lt);
        break;
      case "gradient": {
        const a = (evalProp(s.angle, lt) * Math.PI) / 180;
        let g: CanvasGradient;
        if (s.kind === "radial") g = ctx.createRadialGradient(s.w / 2, s.h / 2, 0, s.w / 2, s.h / 2, Math.max(1e-6, Math.hypot(s.w, s.h) / 2));
        else {
          const dx = Math.cos(a);
          const dy = Math.sin(a);
          const len = Math.abs(s.w * dx) + Math.abs(s.h * dy);
          g = ctx.createLinearGradient(s.w / 2 - (dx * len) / 2, s.h / 2 - (dy * len) / 2, s.w / 2 + (dx * len) / 2, s.h / 2 + (dy * len) / 2);
        }
        for (const st of s.stops) g.addColorStop(Math.min(1, Math.max(0, st.o)), evalColor(st.c, lt));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s.w, s.h);
        break;
      }
      case "noise":
        this.drawNoise(ctx, s, lt);
        break;
      case "shimmer": {
        const cycle = r.src / s.period;
        // The sweep takes half a period and then rests, like light catching a surface.
        const p = Math.min(1, (cycle - Math.floor(cycle)) * 2);
        const a = (s.angle * Math.PI) / 180;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        const len = Math.abs(s.w * dx) + Math.abs(s.h * dy);
        const cx = s.w / 2;
        const cy = s.h / 2;
        const pos = -s.width + p * (1 + s.width * 2);
        const col = parseHex(s.color);
        const clear = rgbaString([col[0], col[1], col[2], 0]);
        const g = ctx.createLinearGradient(cx - (dx * len) / 2, cy - (dy * len) / 2, cx + (dx * len) / 2, cy + (dy * len) / 2);
        const at = (v: number) => Math.min(1, Math.max(0, v));
        g.addColorStop(0, clear);
        g.addColorStop(at(pos - s.width / 2), clear);
        g.addColorStop(at(pos), rgbaString(col));
        g.addColorStop(at(pos + s.width / 2), clear);
        g.addColorStop(1, clear);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s.w, s.h);
        break;
      }
      case "rays": {
        const col = evalColor(s.color, lt);
        const cx = s.r;
        const cy = s.r;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, s.r);
        g.addColorStop(0, col);
        g.addColorStop(Math.max(0.01, 1 - s.softness * 0.9), withAlpha(col, 0.55));
        g.addColorStop(1, withAlpha(col, 0));
        ctx.fillStyle = g;
        const spin = (s.spin * r.src * Math.PI) / 180;
        const half = (Math.PI / s.count) * 0.5;
        for (let i = 0; i < s.count; i++) {
          const a = spin + (i * Math.PI * 2) / s.count;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, s.r, a - half, a + half);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
      case "particles": {
        ctx.save();
        ctx.translate(s.w / 2, s.h / 2);
        for (const p of particlesAt(s, r.src)) drawParticle(ctx, p);
        ctx.restore();
        break;
      }
      case "text":
        this.drawText(ctx, s, box, lt);
        break;
      case "compound": {
        // The inner design is drawn on its own stage-sized layer, then placed like any other picture.
        // Each depth owns three scratch canvases (its layer, its mask, and this inner target), so a nested
        // level never draws onto the canvas its parent is in the middle of using.
        const inner = this.scratch(depth * 3 + 2);
        this.drawClips(inner.ctx, s.clips, r.src, stage, depth + 1);
        ctx.save();
        ctx.scale(1 / this.scale, 1 / this.scale);
        ctx.drawImage(inner.canvas, 0, 0);
        ctx.restore();
        break;
      }
      case "adjust":
        break;
    }
  }

  private drawShape(ctx: Ctx, s: Extract<Source, { type: "shape" }>, lt: number) {
    const fill = evalColor(s.fill, lt);
    const stroke = evalColor(s.stroke, lt);
    const cx = s.w / 2;
    const cy = s.h / 2;
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    switch (s.shape) {
      case "rect":
        ctx.beginPath();
        ctx.roundRect(0, 0, s.w, s.h, Math.min(s.radius, s.w / 2, s.h / 2));
        break;
      case "ellipse":
        ctx.beginPath();
        ctx.ellipse(cx, cy, s.w / 2, s.h / 2, 0, 0, Math.PI * 2);
        break;
      case "star":
        starPath(ctx, cx, cy, s.w / 2, s.h / 2, s.points, s.inner);
        break;
      case "heart":
        heartPath(ctx, cx, cy, s.w / 2, s.h / 2);
        break;
      case "triangle":
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(s.w, s.h);
        ctx.lineTo(0, s.h);
        ctx.closePath();
        break;
      case "ring": {
        ctx.lineWidth = s.strokeWidth > 0 ? s.strokeWidth : Math.min(s.w, s.h) * 0.1;
        ctx.strokeStyle = fill;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(0.01, s.w / 2 - ctx.lineWidth / 2), Math.max(0.01, s.h / 2 - ctx.lineWidth / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
        return;
      }
      case "line":
        ctx.lineWidth = s.strokeWidth > 0 ? s.strokeWidth : Math.max(1, s.h);
        ctx.strokeStyle = fill;
        ctx.beginPath();
        ctx.moveTo(ctx.lineWidth / 2, cy);
        ctx.lineTo(s.w - ctx.lineWidth / 2, cy);
        ctx.stroke();
        return;
    }
    ctx.fill();
    if (s.strokeWidth > 0) {
      ctx.lineWidth = s.strokeWidth;
      ctx.stroke();
    }
  }

  private drawText(ctx: Ctx, s: Extract<Source, { type: "text" }>, box: { w: number; h: number }, lt: number) {
    ctx.font = fontOf(s);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const chars = textChars(s, lt);
    const fill = evalColor(s.color, lt);
    // Each character is placed at its own advance, so it can be moved and faded on its own.
    let x = 0;
    const widths = chars.map((c) => ctx.measureText(c.ch).width);
    const midY = box.h / 2;
    chars.forEach((c, i) => {
      if (c.alpha > 0.002) {
        ctx.save();
        ctx.globalAlpha *= c.alpha;
        ctx.translate(x + widths[i] / 2 + c.dx, midY + c.dy);
        ctx.scale(c.scale, c.scale);
        ctx.translate(-widths[i] / 2, 0);
        if (s.strokeWidth > 0) {
          ctx.lineWidth = s.strokeWidth * 2;
          ctx.lineJoin = "round";
          ctx.strokeStyle = s.stroke;
          ctx.strokeText(c.ch, 0, 0);
        }
        ctx.fillStyle = fill;
        ctx.fillText(c.ch, 0, 0);
        ctx.restore();
      }
      x += widths[i];
    });
  }

  private drawNoise(ctx: Ctx, s: Extract<Source, { type: "noise" }>, lt: number) {
    // Made at low resolution and drawn smoothly scaled: clouds have no fine detail to lose.
    const cell = Math.max(2, Math.min(12, s.scale / 8));
    const tw = Math.max(1, Math.ceil(s.w / cell));
    const th = Math.max(1, Math.ceil(s.h / cell));
    const key = `${s.seed}|${tw}x${th}`;
    let tile = this.noiseTile.get(key);
    if (!tile) {
      tile = makeCanvas(tw, th);
      this.noiseTile.set(key, tile);
      if (this.noiseTile.size > 8) this.noiseTile.delete(this.noiseTile.keys().next().value as string);
    }
    const tctx = tile.getContext("2d")!;
    const img = tctx.createImageData(tw, th);
    const col = parseRgba(evalColor(s.color, lt));
    const drift = lt * s.speed;
    const gain = 1 + s.contrast * 3;
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const v = fbm2((x * cell) / s.scale + drift, (y * cell) / s.scale + drift * 0.6, s.seed, 4);
        const a = Math.min(1, Math.max(0, (v - 0.5) * gain + 0.5));
        const o = (y * tw + x) * 4;
        img.data[o] = col[0];
        img.data[o + 1] = col[1];
        img.data[o + 2] = col[2];
        img.data[o + 3] = a * col[3] * 255;
      }
    }
    tctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(tile, 0, 0, s.w, s.h);
    ctx.restore();
  }
}

/** Place a rendered stage on a visible canvas the way `object-fit: cover` would: filled, centred, cropped. */
export function drawCover(dst: HTMLCanvasElement, src: HTMLCanvasElement) {
  const ctx = dst.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, dst.width, dst.height);
  if (dst.width === 0 || dst.height === 0) return;
  const k = Math.max(dst.width / src.width, dst.height / src.height);
  const w = src.width * k;
  const h = src.height * k;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, (dst.width - w) / 2, (dst.height - h) / 2, w, h);
}

/** Pixels per stage unit that fills a `w`×`h` box when covered, capped so a big screen doesn't make a huge canvas. */
export function coverScale(stage: { w: number; h: number }, w: number, h: number, cap = 2): number {
  return Math.max(0.1, Math.min(cap, Math.max(w / stage.w, h / stage.h)));
}

// --- Pictures -----------------------------------------------------------------------------------

const loaded = new Map<string, Promise<HTMLImageElement>>();

/** An image by address, loaded once and shared between everything that plays a design. Rejects (and forgets) if unreadable. */
export function loadMotionImage(url: string): Promise<HTMLImageElement> {
  let p = loaded.get(url);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
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

/** Every picture a design uses, loaded. A picture that fails is simply missing: the rest of the design still plays. */
export async function loadMotionImages(urls: string[]): Promise<MotionImages> {
  const out: MotionImages = new Map();
  await Promise.all(urls.map((u) => loadMotionImage(u).then((img) => out.set(u, img), () => {})));
  return out;
}

import { boundsOf, nodesInOrder } from "@/studio/model/doc";
import type { Doc, ImageNode, Node, ShapeNode, TextNode, ThemePackData } from "@/studio/model/types";

/**
 * Pictures made in the browser for the store listing.
 *
 * A listing needs a picture of the thing, and a design made of text and shapes has
 * no single file to point at — so it is drawn to a canvas here. Only the project's
 * own files and plain colours go in, so the canvas is never tainted and can be
 * read back as a PNG.
 */

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve(img);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      reject(new Error("A picture in this design couldn't be read."));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the picture."))), "image/png"));
}

function drawNode(ctx: CanvasRenderingContext2D, n: Node, images: Map<string, HTMLImageElement>) {
  const c = { x: n.x + n.w / 2, y: n.y + n.h / 2 };
  ctx.save();
  ctx.globalAlpha = n.opacity;
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
    ctx.fillStyle = s.fill;
    ctx.fill();
    if (s.strokeWidth > 0) {
      ctx.lineWidth = s.strokeWidth;
      ctx.strokeStyle = s.stroke;
      ctx.stroke();
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
    lines.forEach((line, i) => {
      if (t.strokeWidth > 0) {
        ctx.lineWidth = t.strokeWidth * 2;
        ctx.lineJoin = "round";
        ctx.strokeStyle = t.stroke;
        ctx.strokeText(line, x, top + i * lh);
      }
      ctx.fillStyle = t.color;
      ctx.fillText(line, x, top + i * lh);
    });
  }
  ctx.restore();
}

async function imagesFor(doc: Doc, getBlob: (id: string) => Promise<Blob | null>) {
  const images = new Map<string, HTMLImageElement>();
  for (const n of nodesInOrder(doc)) {
    if (n.type !== "image" || images.has(n.assetId)) continue;
    const blob = await getBlob(n.assetId);
    if (blob) images.set(n.assetId, await loadImage(blob));
  }
  return images;
}

/** A decoration on a stand-in avatar, or a sticker on a stand-in card, as a square-ish PNG. */
export async function rasterizeCosmetic(doc: Doc, getBlob: (id: string) => Promise<Blob | null>, size = 512): Promise<Blob> {
  const images = await imagesFor(doc, getBlob);
  const { w: AW, h: AH } = doc.artboard;
  const margin = doc.kind === "decoration" ? AW * 0.3 : AW * 0.08;
  const vw = AW + margin * 2;
  const vh = AH + margin * 2;
  const scale = size / Math.max(vw, vh);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1c1c22";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.translate(margin, margin);

  if (doc.kind === "decoration") {
    const g = ctx.createLinearGradient(0, 0, AW, AH);
    g.addColorStop(0, "#6d5bd0");
    g.addColorStop(1, "#2b8fd6");
    ctx.beginPath();
    ctx.arc(AW / 2, AH / 2, AW / 2, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.roundRect(0, 0, AW, AH, 20);
    ctx.fillStyle = "#2a2a31";
    ctx.fill();
    const g = ctx.createLinearGradient(0, 0, AW, AH * 0.28);
    g.addColorStop(0, "rgba(139,92,246,0.6)");
    g.addColorStop(1, "rgba(14,165,233,0.5)");
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, AW, AH * 0.28, [20, 20, 0, 0]);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(54, AH * 0.28, 34, 0, Math.PI * 2);
    ctx.fillStyle = "#4b4b55";
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect(20, AH * 0.28 + 48, 110, 12);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(20, AH * 0.28 + 70, 80, 9);
  }
  for (const n of nodesInOrder(doc)) if (!n.hidden && (n.type === "image" || n.type === "shape" || n.type === "text")) drawNode(ctx, n, images);
  return toBlob(canvas);
}

/** A theme pack's swatch: its colours as a little window, with the font on show. */
export async function rasterizeThemePack(data: ThemePackData, name: string, fontFamily?: string): Promise<Blob> {
  const c = data.theme?.colors ?? {};
  const dark = data.theme?.isDark !== false;
  const get = (k: string, fallback: string) => c[k] || fallback;
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 400;
  const ctx = canvas.getContext("2d")!;
  const rect = (x: number, y: number, w: number, h: number, fill: string, r = 0) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  // Colours may be oklch(): the canvas understands CSS colours, so they are used as written.
  rect(0, 0, 640, 400, get("background", dark ? "#18181b" : "#ffffff"));
  rect(0, 0, 150, 400, get("sidebar", dark ? "#202024" : "#f5f5f5"));
  for (let i = 0; i < 5; i++) rect(18, 24 + i * 38, 114, 26, i === 1 ? get("sidebar-accent", "#34343a") : "rgba(128,128,128,0.18)", 8);
  rect(176, 28, 438, 70, get("card", dark ? "#26262b" : "#fafafa"), 14);
  rect(176, 118, 438, 150, get("card", dark ? "#26262b" : "#fafafa"), 14);
  rect(196, 300, 140, 40, get("primary", "#8b5cf6"), 12);
  rect(352, 300, 120, 40, get("secondary", dark ? "#34343a" : "#eeeeee"), 12);
  rect(488, 300, 60, 40, get("accent", "#34343a"), 12);
  ctx.fillStyle = get("foreground", dark ? "#fafafa" : "#111111");
  ctx.font = `700 26px ${fontFamily ? `"${fontFamily}", ` : ""}system-ui, sans-serif`;
  ctx.fillText(name.slice(0, 28) || "Theme pack", 196, 70);
  ctx.font = `400 16px ${fontFamily ? `"${fontFamily}", ` : ""}system-ui, sans-serif`;
  ctx.fillStyle = get("muted-foreground", "#999999");
  ctx.fillText("The quick brown fox jumps over the lazy dog", 196, 160);
  ctx.fillText("0123456789  Aa Bb Cc", 196, 188);
  return toBlob(canvas);
}

/** One frame of a clip, as a PNG: the store picture for a scene whose room is a video. */
export function posterFromVideo(blob: Blob, size = 960): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    const done = (fn: () => void) => {
      URL.revokeObjectURL(url);
      fn();
    };
    v.onloadeddata = () => {
      // A little in, so a clip that fades up from black isn't a black poster.
      v.currentTime = Math.min(0.5, (v.duration || 1) / 4);
    };
    v.onseeked = () => {
      const c = document.createElement("canvas");
      const k = size / Math.max(v.videoWidth, v.videoHeight);
      c.width = Math.round(v.videoWidth * k);
      c.height = Math.round(v.videoHeight * k);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((b) => done(() => (b ? resolve(b) : reject(new Error("Couldn't make a picture from the clip.")))), "image/png");
    };
    v.onerror = () => done(() => reject(new Error("That clip couldn't be read.")));
    v.src = url;
  });
}

export { boundsOf };

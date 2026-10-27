"use client";

import { useEffect, useRef, useState } from "react";

import { layerKey, loadMotionImage, type MotionImages } from "@/lib/motion-render";
import { nodesInOrder } from "@/studio/model/doc";
import { fxBox, fxKey } from "@/studio/model/fx";
import { bakeScale, loadImageUrl, renderFx, type Images } from "@/studio/model/fx-render";
import type { Doc } from "@/studio/model/types";
import type { LoadedAsset } from "@/studio/storage/assets";

/**
 * The pictures the timeline plays: every drawn layer of the canvas, rendered by the canvas editor's own renderer (so
 * a material, a brush stroke or a glow looks here exactly as it does there), plus the project's imported pictures,
 * both in the form the motion renderer wants.
 *
 * A layer is re-rendered only when what it looks like changes (`fxKey`), after a short pause so dragging it on the
 * canvas isn't a render per frame. Hidden layers have no picture, so they are not on screen.
 */
export function useLayerPictures(doc: Doc, assets: Map<string, LoadedAsset>): { images: MotionImages; version: number } {
  const made = useRef(new Map<string, { key: string; canvas: HTMLCanvasElement }>());
  const imported = useRef(new Map<string, HTMLImageElement>());
  const [version, setVersion] = useState(0);
  const images = useRef<MotionImages>(new Map());

  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      const nodes = nodesInOrder(doc).filter((n) => !n.hidden && (n.type === "image" || n.type === "shape" || n.type === "text" || n.type === "path"));
      const pics: Images = new Map();
      for (const n of nodes) {
        if (n.type !== "image" || pics.has(n.assetId)) continue;
        const u = assets.get(n.assetId)?.url;
        if (u) pics.set(n.assetId, await loadImageUrl(u).catch(() => null as never));
      }
      let changed = false;
      for (const n of nodes) {
        const key = fxKey(n) + (n.type === "image" ? (pics.get(n.assetId) ? "+" : "-") : "");
        if (made.current.get(n.id)?.key === key) continue;
        try {
          const { canvas } = renderFx(n, pics, bakeScale(fxBox(n)));
          made.current.set(n.id, { key, canvas });
          changed = true;
        } catch {
          // A layer that can't be drawn is left out rather than breaking the preview.
        }
      }
      const present = new Set(nodes.map((n) => n.id));
      for (const id of [...made.current.keys()]) {
        if (!present.has(id)) {
          made.current.delete(id);
          changed = true;
        }
      }
      // Pictures imported straight onto the timeline: by the address the project's files have in this session.
      for (const [id, a] of assets) {
        if (imported.current.has(id)) continue;
        try {
          imported.current.set(id, await loadMotionImage(a.url));
          changed = true;
        } catch {
          // Missing: the clip simply shows nothing.
        }
      }
      if (!live || !changed) return;
      const next: MotionImages = new Map();
      for (const [id, m] of made.current) next.set(layerKey(id), m.canvas);
      for (const [id, img] of imported.current) next.set(`studio:asset/${id}`, img);
      images.current = next;
      setVersion((v) => v + 1);
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [doc, assets]);

  return { images: images.current, version };
}

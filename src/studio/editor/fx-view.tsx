"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { fxBox, fxKey, nodeGradient, nodeMaterial } from "@/studio/model/fx";
import { pathD } from "@/studio/model/path";
import { bakeScale, loadImageUrl, renderFx, type Images } from "@/studio/model/fx-render";
import type { Node } from "@/studio/model/types";
import type { LoadedAsset } from "@/studio/storage/assets";

/** Round up to a power of two, so zooming through a range re-renders a few times rather than every wheel tick. */
const bucket = (x: number) => 2 ** Math.ceil(Math.log2(Math.max(0.25, x)));

/**
 * A node with effects, drawn from `renderFx` into a canvas placed at the box the effects
 * cover. It is a sibling of a transparent hit area at the node's own box, not a parent of
 * it, because the picture reaches past the node and must not catch the pointer there.
 */
export function FxView({ node, assets, zoom }: { node: Node; assets: Map<string, LoadedAsset>; zoom: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<Images>(() => new Map());

  // The picture an image node is made from, loaded once per file.
  const assetId = node.type === "image" ? node.assetId : null;
  const url = assetId ? assets.get(assetId)?.url : undefined;
  useEffect(() => {
    if (!assetId || !url) return;
    let live = true;
    loadImageUrl(url).then(
      (img) => live && setImages((cur) => (cur.get(assetId) === img ? cur : new Map(cur).set(assetId, img))),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [assetId, url]);

  const key = useMemo(() => fxKey(node), [node]);
  const box = fxBox(node);
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const scale = Math.min(bakeScale(box), bucket(zoom * dpr));

  // Drawn only when how it looks changes: a move changes x and y, which are not in the key.
  // `node` is read inside the effect but the key stands in for it.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    try {
      const { canvas } = renderFx(node, images, scale);
      target.width = canvas.width;
      target.height = canvas.height;
      target.getContext("2d")!.drawImage(canvas, 0, 0);
    } catch {
      // A render that can't complete (a canvas too large for the machine) leaves the last picture up.
    }
  }, [key, images, scale]);
  /* eslint-enable react-hooks/exhaustive-deps */

  return (
    <>
      <canvas
        ref={ref}
        aria-hidden
        className="pointer-events-none absolute"
        style={{ left: box.x, top: box.y, width: box.w, height: box.h, opacity: node.opacity }}
      />
      {node.type === "path" ? (
        // The picture reaches past the outline and a line is a pixel thick, so what takes the pointer is
        // the outline itself, drawn a few pixels fatter than it is.
        <svg
          data-node-id={node.id}
          aria-hidden
          className="pointer-events-none absolute overflow-visible"
          style={{ left: node.x, top: node.y, width: node.w, height: node.h, transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined }}
        >
          <path
            d={pathD(node.points, node.closed, node.w, node.h)}
            fill="transparent"
            fillRule={node.points.some((q) => q.m) ? "evenodd" : "nonzero"}
            stroke="transparent"
            strokeWidth={Math.max(node.strokeWidth, 10 / zoom)}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ pointerEvents: node.fill !== "none" || nodeGradient(node) || nodeMaterial(node) ? "all" : "stroke" }}
          />
        </svg>
      ) : (
        <div
          data-node-id={node.id}
          className="absolute"
          style={{
            left: node.x,
            top: node.y,
            width: node.w,
            height: node.h,
            transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
            borderRadius: node.type === "shape" ? (node.shape === "ellipse" ? "50%" : node.radius) : 0,
          }}
        />
      )}
    </>
  );
}

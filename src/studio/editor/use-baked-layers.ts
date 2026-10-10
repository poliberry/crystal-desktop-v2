"use client";

import { useEffect, useRef, useState } from "react";

import { bakesToPicture, fxKey } from "@/studio/model/fx";
import { bakeScale, canvasToPng, loadImageUrl, renderFx, type Images } from "@/studio/model/fx-render";
import { fxBox } from "@/studio/model/fx";
import { nodesInOrder } from "@/studio/model/doc";
import type { Doc } from "@/studio/model/types";
import type { LoadedAsset } from "@/studio/storage/assets";

/**
 * Every visible node that is sent as a picture (effects, gradients, paths), rendered the way
 * submission renders it, as object URLs by node id — for the Preview to show what will be sent.
 * Re-rendered only for nodes whose look changed (see `fxKey`), after a short pause so a drag isn't
 * a render per frame; object URLs of pictures that are replaced or gone are released.
 */
export function useBakedLayers(doc: Doc, assets: Map<string, LoadedAsset>): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const made = useRef(new Map<string, { key: string; url: string }>());

  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      const todo = nodesInOrder(doc).filter((n) => !n.hidden && bakesToPicture(doc, n));
      const images: Images = new Map();
      for (const n of todo) {
        if (n.type !== "image" || images.has(n.assetId)) continue;
        const u = assets.get(n.assetId)?.url;
        if (u) images.set(n.assetId, await loadImageUrl(u).catch(() => null as never));
      }
      for (const n of todo) {
        const key = fxKey(n) + (n.type === "image" ? (images.has(n.assetId) ? "+" : "-") : "");
        if (made.current.get(n.id)?.key === key) continue;
        try {
          const { canvas } = renderFx(n, images, bakeScale(fxBox(n)));
          const url = URL.createObjectURL(await canvasToPng(canvas));
          const old = made.current.get(n.id);
          if (old) URL.revokeObjectURL(old.url);
          made.current.set(n.id, { key, url });
        } catch {
          // A picture that can't be drawn is left out of the preview rather than breaking it.
        }
      }
      const present = new Set(todo.map((n) => n.id));
      for (const [id, m] of made.current) {
        if (!present.has(id)) {
          URL.revokeObjectURL(m.url);
          made.current.delete(id);
        }
      }
      if (live) setUrls(new Map([...made.current].map(([id, m]) => [id, m.url])));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [doc, assets]);

  // Release everything when the preview goes away.
  useEffect(() => {
    const m = made.current;
    return () => {
      for (const { url } of m.values()) URL.revokeObjectURL(url);
      m.clear();
    };
  }, []);

  return urls;
}

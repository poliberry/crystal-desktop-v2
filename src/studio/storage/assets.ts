"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { newId } from "@/studio/model/doc";
import type { AssetMeta } from "@/studio/model/types";
import { deleteAsset, getAssetBlob, listAssets, putAsset } from "@/studio/storage/db";

/** What a project may hold. A pack of pictures, not a media library. */
export const ASSET_LIMITS = {
  image: 8 * 1024 * 1024,
  /** A scene's looping background clip. */
  video: 8 * 1024 * 1024,
  font: 4 * 1024 * 1024,
  sound: 2 * 1024 * 1024,
  icon: 64 * 1024,
} as const;

/** One imported file, ready to draw: its record and an address the page can load. */
export interface LoadedAsset extends AssetMeta {
  url: string;
}

function measure(blob: Blob): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (blob.type.startsWith("video/")) {
      const url = URL.createObjectURL(blob);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        resolve({ width: v.videoWidth, height: v.videoHeight });
        URL.revokeObjectURL(url);
      };
      v.onerror = () => {
        resolve(null);
        URL.revokeObjectURL(url);
      };
      v.src = url;
      return;
    }
    if (!blob.type.startsWith("image/")) return resolve(null);
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/**
 * A project's imported files, loaded once and kept as object URLs.
 *
 * Returned as a map by id so a node can look its picture up in one step, and so
 * a redraw doesn't ask storage for anything. URLs are revoked when the project
 * is closed.
 */
export function useProjectAssets(projectId: string | null) {
  const [assets, setAssets] = useState<Map<string, LoadedAsset>>(new Map());
  const urls = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = [];
    setAssets(new Map());
    if (!projectId) return;
    void (async () => {
      const metas = await listAssets(projectId);
      const loaded = new Map<string, LoadedAsset>();
      for (const meta of metas) {
        const blob = await getAssetBlob(meta.id);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        urls.current.push(url);
        loaded.set(meta.id, { ...meta, url });
      }
      if (!cancelled) setAssets(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(
    () => () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  const add = useCallback(
    async (file: File | Blob, name?: string): Promise<LoadedAsset> => {
      if (!projectId) throw new Error("Open a project first.");
      const size = measure(file);
      const meta: AssetMeta = {
        id: newId("a"),
        projectId,
        name: name ?? (file instanceof File ? file.name : "asset"),
        type: file.type || "application/octet-stream",
        size: file.size,
        createdAt: Date.now(),
        ...((await size) ?? {}),
      };
      await putAsset(meta, file);
      const url = URL.createObjectURL(file);
      urls.current.push(url);
      const loaded = { ...meta, url };
      setAssets((prev) => new Map(prev).set(meta.id, loaded));
      return loaded;
    },
    [projectId],
  );

  const remove = useCallback(async (id: string) => {
    await deleteAsset(id);
    setAssets((prev) => {
      const next = new Map(prev);
      const gone = next.get(id);
      if (gone) URL.revokeObjectURL(gone.url);
      next.delete(id);
      return next;
    });
  }, []);

  return { assets, add, remove };
}

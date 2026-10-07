"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { emptyDoc, newId } from "@/studio/model/doc";
import { emptyThemePack, type DocKind, type Project, type ProjectKind } from "@/studio/model/types";
import { deleteProject, getAssetBlob, listAssets, listProjects, putAsset, saveProject } from "@/studio/storage/db";

const SAVE_DELAY_MS = 500;

export function newProject(kind: ProjectKind, name: string): Project {
  const now = Date.now();
  const base: Project = {
    id: newId("p"),
    kind,
    name,
    createdAt: now,
    updatedAt: now,
    listing: { name, description: "", free: false, priceUsd: "1.99" },
  };
  if (kind === "decoration" || kind === "sticker" || kind === "scene") return { ...base, doc: emptyDoc(kind as DocKind) };
  if (kind === "themePack") return { ...base, themePack: emptyThemePack() };
  if (kind === "pack") return { ...base, pack: { projectIds: [] } };
  return base;
}

/**
 * Every project on this device, kept in memory and written back as they change.
 *
 * Saves are debounced per project, so dragging a node writes once when it has
 * settled; whatever is still waiting is written when the window is hidden or
 * closed, so a change is never lost to the timer.
 */
export function useProjects() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const pending = useRef(new Map<string, { project: Project; timer: number }>());

  useEffect(() => {
    let alive = true;
    listProjects()
      .then((list) => alive && setProjects(list))
      .catch(() => alive && setProjects([]));
    return () => {
      alive = false;
    };
  }, []);

  const flush = useCallback(async () => {
    const entries = [...pending.current.values()];
    pending.current.clear();
    for (const e of entries) {
      window.clearTimeout(e.timer);
      await saveProject(e.project);
    }
  }, []);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [flush]);

  const update = useCallback((id: string, change: (p: Project) => Project) => {
    setProjects((prev) => {
      if (!prev) return prev;
      return prev.map((p) => {
        if (p.id !== id) return p;
        const next = { ...change(p), updatedAt: Date.now() };
        const queued = pending.current.get(id);
        if (queued) window.clearTimeout(queued.timer);
        pending.current.set(id, {
          project: next,
          timer: window.setTimeout(() => {
            pending.current.delete(id);
            void saveProject(next);
          }, SAVE_DELAY_MS),
        });
        return next;
      });
    });
  }, []);

  const create = useCallback(async (kind: ProjectKind, name: string) => {
    const project = newProject(kind, name);
    await saveProject(project);
    setProjects((prev) => [project, ...(prev ?? [])]);
    return project;
  }, []);

  const duplicate = useCallback(async (id: string) => {
    const source = projects?.find((p) => p.id === id);
    if (!source) return null;
    const copy: Project = { ...structuredClone(source), id: newId("p"), name: `${source.name} copy`, createdAt: Date.now(), updatedAt: Date.now() };
    copy.listing = { ...copy.listing, name: `${source.listing.name || source.name} copy` };
    // Files are copied under new ids, and every reference to them follows.
    const idMap = new Map<string, string>();
    for (const asset of await listAssets(source.id)) {
      const blob = await getAssetBlob(asset.id);
      if (!blob) continue;
      const nid = newId("a");
      idMap.set(asset.id, nid);
      await putAsset({ ...asset, id: nid, projectId: copy.id }, blob);
    }
    const remap = (value: string) => idMap.get(value) ?? value;
    if (copy.doc) for (const n of Object.values(copy.doc.nodes)) if (n.type === "image") n.assetId = remap(n.assetId);
    if (copy.picture) copy.picture.assetId = remap(copy.picture.assetId);
    if (copy.themePack) {
      const font = copy.themePack.font;
      if (font?.assetId) font.assetId = remap(font.assetId);
      if (font?.faces) font.faces = font.faces.map((f) => ({ ...f, assetId: remap(f.assetId) }));
      for (const k of Object.keys(copy.themePack.sounds)) copy.themePack.sounds[k] = remap(copy.themePack.sounds[k]);
      for (const k of Object.keys(copy.themePack.icons)) copy.themePack.icons[k] = remap(copy.themePack.icons[k]);
    }
    await saveProject(copy);
    setProjects((prev) => [copy, ...(prev ?? [])]);
    return copy;
  }, [projects]);

  const remove = useCallback(async (id: string) => {
    const queued = pending.current.get(id);
    if (queued) window.clearTimeout(queued.timer);
    pending.current.delete(id);
    await deleteProject(id);
    setProjects((prev) => (prev ?? []).filter((p) => p.id !== id));
  }, []);

  return { projects, update, create, duplicate, remove, flush };
}

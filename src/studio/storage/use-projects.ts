"use client";

import { emptyMotion } from "../../../convex/lib/motion";
import { useCallback, useEffect, useRef, useState } from "react";

import { emptyDoc, newId } from "@/studio/model/doc";
import { remapAssetIds } from "@/studio/model/remap";
import { newExtension } from "@/studio/model/extension";
import { emptyBot, emptyThemePack, type DocKind, type Project, type ProjectKind } from "@/studio/model/types";
import { deleteProject, getAssetBlob, listAssets, listProjects, putAsset, saveProject, storageLoadErrors } from "@/studio/storage/db";
import type { LoadError } from "@/studio/storage/types";

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
  if (kind === "nameplate" || kind === "effect") return { ...base, doc: emptyDoc(kind), motion: emptyMotion(kind, name) };
  if (kind === "themePack") return { ...base, themePack: emptyThemePack() };
  if (kind === "pack") return { ...base, pack: { projectIds: [] } };
  if (kind === "extension") return { ...base, extension: newExtension(name) };
  if (kind === "bot") return { ...base, bot: emptyBot() };
  return base;
}

/**
 * Whether a project writes itself as it changes. Only a theme pack does: it is edited with sliders and
 * pickers whose every tick is a change, and has nothing to be careful about. Everything else (the
 * canvas editors, extensions, bots, packs) is saved when the person says so, so a half-finished edit
 * is never what is on disk and Undo can still take back the last hour.
 */
export const autosaves = (p: Pick<Project, "kind">): boolean => p.kind === "themePack";

/**
 * Every project on this device, kept in memory.
 *
 * A theme pack is written back as it changes (debounced, so dragging a slider writes once when it has
 * settled). Any other project is only written by `save(id)`; until then it is *unsaved*: `dirty` says
 * which, `revert(id)` puts back what is on disk, and the caller is expected to ask before throwing
 * changes away. What is waiting on the timer is also written when the window is hidden or closed.
 */
export function useProjects() {
  const [projects, setProjectsState] = useState<Project[] | null>(null);
  const [loadErrors, setLoadErrors] = useState<LoadError[]>([]);
  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef(new Map<string, { project: Project; timer: number }>());
  /** The latest list, readable straight after an update (state isn't, until the next render). */
  const live = useRef<Project[] | null>(null);
  /** What is on disk for each project: what `revert` goes back to. */
  const onDisk = useRef(new Map<string, Project>());

  const setProjects = useCallback((next: Project[] | null) => {
    live.current = next;
    setProjectsState(next);
  }, []);
  const markDirty = useCallback((id: string, on: boolean) => {
    setDirty((prev) => {
      if (prev.has(id) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    listProjects()
      .then((list) => {
        if (!alive) return;
        for (const p of list) onDisk.current.set(p.id, p);
        setProjects(list);
        setLoadErrors(storageLoadErrors());
      })
      .catch((e) => {
        if (!alive) return;
        setProjects([]);
        setLoadErrors([{ folder: "Crystal Studio", level: "error", message: e instanceof Error ? e.message : "Couldn't open the projects folder." }]);
      });
    return () => {
      alive = false;
    };
  }, [setProjects]);

  /** Write what is waiting on a timer (theme packs only: nothing else is ever queued). */
  const flush = useCallback(async () => {
    const entries = [...pending.current.values()];
    pending.current.clear();
    for (const e of entries) {
      window.clearTimeout(e.timer);
      await saveProject(e.project);
      onDisk.current.set(e.project.id, e.project);
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

  const update = useCallback(
    (id: string, change: (p: Project) => Project) => {
      const list = live.current;
      const current = list?.find((p) => p.id === id);
      if (!list || !current) return;
      const next = { ...change(current), updatedAt: Date.now() };
      setProjects(list.map((p) => (p.id === id ? next : p)));
      if (autosaves(next)) {
        const queued = pending.current.get(id);
        if (queued) window.clearTimeout(queued.timer);
        pending.current.set(id, {
          project: next,
          timer: window.setTimeout(() => {
            pending.current.delete(id);
            void saveProject(next).then(() => onDisk.current.set(id, next));
          }, SAVE_DELAY_MS),
        });
      } else {
        markDirty(id, true);
      }
    },
    [markDirty, setProjects],
  );

  /** Write a project now. Resolves once it is on disk; rejects (leaving it unsaved) if it can't be. */
  const save = useCallback(
    async (id: string) => {
      const queued = pending.current.get(id);
      if (queued) {
        window.clearTimeout(queued.timer);
        pending.current.delete(id);
      }
      const project = live.current?.find((p) => p.id === id);
      if (!project) return;
      await saveProject(project);
      onDisk.current.set(id, project);
      // Unless it changed again while that was being written.
      if (live.current?.find((p) => p.id === id) === project) markDirty(id, false);
    },
    [markDirty],
  );

  /** Throw away unsaved changes: the project goes back to what is on disk. */
  const revert = useCallback(
    (id: string) => {
      const saved = onDisk.current.get(id);
      if (saved && live.current) setProjects(live.current.map((p) => (p.id === id ? saved : p)));
      markDirty(id, false);
    },
    [markDirty, setProjects],
  );

  const create = useCallback(async (kind: ProjectKind, name: string) => {
    const project = newProject(kind, name);
    await saveProject(project);
    onDisk.current.set(project.id, project);
    setProjects([project, ...(live.current ?? [])]);
    return project;
  }, [setProjects]);

  const duplicate = useCallback(async (id: string) => {
    const source = projects?.find((p) => p.id === id);
    if (!source) return null;
    const copy: Project = { ...structuredClone(source), id: newId("p"), name: `${source.name} copy`, createdAt: Date.now(), updatedAt: Date.now() };
    copy.listing = { ...copy.listing, name: `${source.listing.name || source.name} copy` };
    // A copy is a new thing in the store, not an update to the original's listing.
    delete copy.store;
    // The copy is saved first, so it has a folder for its files to go into; then they are copied
    // under new ids, and every reference to them follows.
    await saveProject(copy);
    const idMap = new Map<string, string>();
    for (const asset of await listAssets(source.id)) {
      const blob = await getAssetBlob(asset.id);
      if (!blob) continue;
      const nid = newId("a");
      idMap.set(asset.id, nid);
      await putAsset({ ...asset, id: nid, projectId: copy.id }, blob);
    }
    remapAssetIds(copy, (value) => idMap.get(value) ?? value);
    await saveProject(copy);
    onDisk.current.set(copy.id, copy);
    setProjects([copy, ...(live.current ?? [])]);
    return copy;
  }, [projects, setProjects]);

  const remove = useCallback(async (id: string) => {
    const queued = pending.current.get(id);
    if (queued) window.clearTimeout(queued.timer);
    pending.current.delete(id);
    await deleteProject(id);
    onDisk.current.delete(id);
    markDirty(id, false);
    setProjects((live.current ?? []).filter((p) => p.id !== id));
  }, [markDirty, setProjects]);

  return { projects, loadErrors, dirty, update, save, revert, create, duplicate, remove, flush };
}

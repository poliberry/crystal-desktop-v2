"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";

import { emptyMotion, type Clip, type MotionSpec } from "../../../convex/lib/motion";
import { History } from "@/studio/model/history";
import { syncLayers } from "@/studio/model/motion-doc";
import type { Project } from "@/studio/model/types";
import { FPS, FRAME, breakApart, deleteClips, duplicateClips, makeCompound, mapScope, scopeOf, snapFrame, splitAt } from "@/studio/motion/ops";

/**
 * The state of one open timeline: the design and the history behind it, the playhead and playback, what is selected,
 * the tool in hand, and how the timeline is viewed.
 *
 * The playhead is not React state. It changes 30–60 times a second while playing, and everything that shows it (the
 * viewer, the timeline's playhead line, the timecode) reads it from a `Clock` and draws directly, so the rest of the
 * editor — the inspector, the browser, the lanes — doesn't re-render per frame.
 */

// --- The clock ------------------------------------------------------------------------------------

export class Clock {
  private t = 0;
  private listeners = new Set<() => void>();
  get value() {
    return this.t;
  }
  set(t: number) {
    const v = Math.max(0, t);
    if (v === this.t) return;
    this.t = v;
    for (const l of this.listeners) l();
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
}

/** The playhead as React state, frame-exact when paused and at most `hz` times a second while playing. */
export function useClockValue(clock: Clock, playing: boolean, hz = 12): number {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const last = useRef(0);
  useEffect(
    () =>
      clock.subscribe(() => {
        const now = performance.now();
        if (!playing || now - last.current > 1000 / hz) {
          last.current = now;
          force();
        }
      }),
    [clock, playing, hz],
  );
  return useSyncExternalStore(clock.subscribe, () => clock.value, () => 0);
}

// --- Tools ----------------------------------------------------------------------------------------

export { MOTION_TOOLS, type MotionTool } from "@/studio/motion/tools";
import type { MotionTool } from "@/studio/motion/tools";

// --- Histories outlive the editor --------------------------------------------------------------------

const histories = new Map<string, History<MotionSpec>>();
export const forgetMotionHistory = (key: string) => histories.delete(key);

export const MIN_ZOOM = 12;
export const MAX_ZOOM = 600;

export function useMotionEditor(project: Project, onChange: (p: Project) => void) {
  const projectRef = useRef(project);
  projectRef.current = project;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const kind = project.kind === "effect" ? "effect" : "nameplate";
  const initial = project.motion ?? emptyMotion(kind, project.name);

  const history = useRef<History<MotionSpec>>(null as unknown as History<MotionSpec>);
  if (!history.current) {
    const kept = histories.get(project.id);
    // Undo history outlives the editor (switching tabs), but only if it still ends at what the project holds: a project
    // reverted or reloaded from disk starts a fresh one rather than undoing into something unrelated.
    const same = !!kept && (!project.motion || JSON.stringify(syncLayers(kept.value, project.doc!)) === JSON.stringify(project.motion));
    history.current = same ? kept! : new History(initial);
    histories.set(project.id, history.current);
  }
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const clock = useRef(new Clock()).current;
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(true);
  const [selection, setSelectionState] = useState<string[]>([]);
  const [path, setPathState] = useState<string[]>([]);
  const [tool, setTool] = useState<MotionTool>("select");
  const [snapping, setSnapping] = useState(true);
  const [autoKey, setAutoKey] = useState(false);
  const [zoom, setZoom] = useState(90);
  const [range, setRange] = useState<{ a: number; b: number } | null>(null);
  const [animation, setAnimation] = useState(true);

  // The design as shown: whatever was last committed, brought in step with the artwork (a layer drawn since, or deleted).
  const doc = project.doc!;
  const raw = history.current.value;
  const spec = useMemo(() => syncLayers(raw, doc), [raw, doc]);

  // Written back to the project whenever it differs from what is saved there.
  useEffect(() => {
    if (spec !== projectRef.current.motion) onChangeRef.current({ ...projectRef.current, motion: spec });
  }, [spec]);

  const scope = useMemo(() => scopeOf(spec, path) ?? { clips: spec.clips, duration: spec.duration }, [spec, path]);
  // A path to a compound clip that no longer exists is no longer a place to be.
  useEffect(() => {
    if (path.length && !scopeOf(spec, path)) setPathState([]);
  }, [spec, path]);

  const selected = useMemo(() => scope.clips.filter((c) => selection.includes(c.id)), [scope, selection]);
  const setSelection = useCallback((ids: string[]) => setSelectionState(ids), []);

  /** Change the design. `key` joins the steps of one gesture into one undo. The change is made to what is shown. */
  const commit = useCallback((fn: (s: MotionSpec) => MotionSpec, key?: string) => {
    const h = history.current;
    const current = syncLayers(h.value, projectRef.current.doc!);
    const next = fn(current);
    if (next === current) return;
    h.push(next, key);
    bump();
  }, []);

  /** Change the clips in the scope being edited (the top level, or inside a compound clip). */
  const commitClips = useCallback(
    (fn: (clips: Clip[], duration: number) => Clip[], key?: string) => commit((s) => mapScope(s, path, fn), key),
    [commit, path],
  );

  const undo = useCallback(() => {
    if (history.current.undo()) bump();
  }, []);
  const redo = useCallback(() => {
    if (history.current.redo()) bump();
  }, []);

  // --- Playback -----------------------------------------------------------------------------------
  const end = scope.duration;
  const playRef = useRef({ playing, rate, loop, range, end });
  playRef.current = { playing, rate, loop, range, end };

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let t0 = clock.value;
    let w0 = performance.now();
    const tick = (now: number) => {
      const { rate: r, loop: lp, range: rg, end: e } = playRef.current;
      let t = t0 + ((now - w0) / 1000) * r;
      const lo = rg ? Math.min(rg.a, rg.b) : 0;
      const hi = rg ? Math.max(rg.a, rg.b) : e;
      if (t >= hi || t < lo) {
        if (lp) {
          t = r >= 0 ? lo + ((t - lo) % Math.max(FRAME, hi - lo)) : hi - ((lo - t) % Math.max(FRAME, hi - lo));
          t0 = t;
          w0 = now;
        } else {
          clock.set(r >= 0 ? Math.min(hi, e) : lo);
          setPlaying(false);
          return;
        }
      }
      clock.set(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, clock]);

  // A change of speed while playing continues from here at the new speed.
  const seek = useCallback((t: number) => clock.set(Math.min(Math.max(0, t), end)), [clock, end]);
  const step = useCallback((frames: number) => {
    setPlaying(false);
    clock.set(Math.min(end - 1e-4, Math.max(0, snapFrame(clock.value) + frames / FPS)));
  }, [clock, end]);

  const togglePlay = useCallback(() => {
    setRate(1);
    setPlaying((p) => {
      // Play from the start if parked at the end.
      if (!p && clock.value >= playRef.current.end - 1e-3) clock.set(0);
      return !p;
    });
  }, [clock]);

  /** J, K, L as in Final Cut: each press of L runs faster forwards, J backwards, K stops. */
  const shuttle = useCallback((dir: -1 | 1) => {
    setPlaying((p) => {
      setRate((r) => (p && Math.sign(r) === dir ? Math.min(8, Math.abs(r) * 2) * dir : dir));
      return true;
    });
  }, []);
  const stop = useCallback(() => setPlaying(false), []);

  // --- Whole-design actions ---------------------------------------------------------------------
  const split = useCallback(() => {
    const t = snapFrame(clock.value);
    commitClips((clips) => splitAt(clips, t, selection.length ? new Set(selection) : undefined));
  }, [clock, commitClips, selection]);

  const remove = useCallback(
    (ripple = false) => {
      if (!selection.length) return;
      commitClips((clips) => deleteClips(clips, new Set(selection), ripple));
      setSelectionState([]);
    },
    [commitClips, selection],
  );

  const duplicate = useCallback(() => {
    if (!selection.length) return;
    let ids: string[] = [];
    commitClips((clips, dur) => {
      const r = duplicateClips(clips, new Set(selection), dur);
      ids = r.ids;
      return r.clips;
    });
    if (ids.length) setSelectionState(ids);
  }, [commitClips, selection]);

  const group = useCallback(() => {
    if (!selection.length) return;
    let id: string | null = null;
    commitClips((clips) => {
      const r = makeCompound(clips, new Set(selection));
      if (!r) return clips;
      id = r.id;
      return r.clips;
    });
    if (id) setSelectionState([id]);
  }, [commitClips, selection]);

  const ungroup = useCallback(() => {
    const only = selected.length === 1 ? selected[0] : null;
    if (!only) return;
    let ids: string[] = [];
    commitClips((clips) => {
      const r = breakApart(clips, only.id);
      if (!r) return clips;
      ids = r.ids;
      return r.clips;
    });
    if (ids.length) setSelectionState(ids);
  }, [commitClips, selected]);

  const open = useCallback((id: string) => {
    setPathState((p) => [...p, id]);
    setSelectionState([]);
    clock.set(0);
    setPlaying(false);
    setRange(null);
  }, [clock]);
  const close = useCallback(() => {
    setPathState((p) => p.slice(0, -1));
    setSelectionState([]);
    clock.set(0);
    setPlaying(false);
    setRange(null);
  }, [clock]);

  return {
    spec, scope, path, commit, commitClips, undo, redo, canUndo: history.current.canUndo, canRedo: history.current.canRedo,
    clock, playing, setPlaying, rate, loop, setLoop, togglePlay, shuttle, stop, seek, step,
    selection, setSelection, selected,
    tool, setTool, snapping, setSnapping, autoKey, setAutoKey, zoom, setZoom, range, setRange, animation, setAnimation,
    split, remove, duplicate, group, ungroup, open, close,
  };
}

export type MotionEditor = ReturnType<typeof useMotionEditor>;

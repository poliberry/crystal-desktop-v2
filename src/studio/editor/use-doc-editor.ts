"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import type { Tool } from "@/studio/editor/tools";
import { groupExists } from "@/studio/model/doc";
import { History } from "@/studio/model/history";
import type { Doc } from "@/studio/model/types";

export type { Tool };

/**
 * The state of one open design: its document and the history behind it, what is
 * selected, and which tool is in hand.
 *
 * The document lives in a `History`, not in React state, so a drag can change it
 * sixty times a second without a copy of it per frame sitting in a component tree;
 * `version` is what tells React something changed. `onChange` is told after every
 * change so the project can be saved.
 */
/**
 * Undo history outlives the editor that made it: switching to another tab
 * unmounts this one, and coming back should still be able to undo. A history is
 * only reused if the document it ends at is the one being opened, so a project
 * changed some other way starts fresh rather than undoing into the wrong thing.
 */
const histories = new Map<string, History<Doc>>();

export function forgetHistory(key: string) {
  histories.delete(key);
}

export function useDocEditor(initial: Doc, onChange: (doc: Doc) => void, historyKey?: string) {
  const history = useRef<History<Doc>>(null as unknown as History<Doc>);
  if (!history.current) {
    const kept = historyKey ? histories.get(historyKey) : undefined;
    history.current = kept && kept.value === initial ? kept : new History(initial);
    if (historyKey) histories.set(historyKey, history.current);
  }
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [selection, setSelectionState] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  /** The group being worked inside (entered by double-clicking it), as its chain "g1/g2"; "" is the top level. */
  const [scopeState, setScope] = useState("");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const doc = history.current.value;
  // A group that has since been dissolved (or undone away) is no longer one to be inside.
  const scope = groupExists(doc, scopeState) ? scopeState : "";

  const setSelection = useCallback((ids: string[]) => setSelectionState(ids), []);

  /** Change the document. `key` joins consecutive changes of one gesture into one undo step. */
  const commit = useCallback((next: Doc | ((d: Doc) => Doc), key?: string) => {
    const h = history.current;
    const value = typeof next === "function" ? next(h.value) : next;
    if (value === h.value) return;
    h.push(value, key);
    onChangeRef.current(value);
    bump();
  }, []);

  const undo = useCallback(() => {
    const r = history.current.undo();
    if (r) {
      onChangeRef.current(r);
      // Anything selected that no longer exists is dropped.
      setSelectionState((s) => s.filter((id) => r.nodes[id]));
      bump();
    }
  }, []);
  const redo = useCallback(() => {
    const r = history.current.redo();
    if (r) {
      onChangeRef.current(r);
      setSelectionState((s) => s.filter((id) => r.nodes[id]));
      bump();
    }
  }, []);

  // Escape returns to the pointer.
  useEffect(() => {
    if (tool === "select") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTool("select");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool]);

  return {
    doc,
    commit,
    undo,
    redo,
    canUndo: history.current.canUndo,
    canRedo: history.current.canRedo,
    selection,
    setSelection,
    tool,
    setTool,
    scope,
    setScope,
  };
}

export type DocEditor = ReturnType<typeof useDocEditor>;

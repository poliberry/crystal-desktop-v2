"use client";

import type * as Monaco from "monaco-editor";
import { Columns2, FileText, Loader2, Minus, Plus, Rows2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { languageFor, type MonacoApi } from "@/studio/code/monaco";
import type { GitState } from "@/studio/code/use-git";
import { FileGlyph } from "@/studio/code/vscode-ui";
import { EDITOR_FONT, EDITOR_FONT_SIZE } from "@/studio/code/vscode-theme";
import { baseOf, parentOf } from "@/studio/storage/workspace";
import type { GitDiffMode, GitDiffSides } from "../../../electron/gitTypes";

export interface DiffTarget {
  path: string;
  /** Where a renamed file came from. */
  from?: string;
  mode: GitDiffMode;
}

const POLL_MS = 3000;

const sameSides = (a: GitDiffSides, b: GitDiffSides) =>
  a.original === b.original && a.modified === b.modified && a.binary === b.binary && a.tooLarge === b.tooLarge && a.originalLabel === b.originalLabel && a.modifiedLabel === b.modifiedLabel;

/**
 * A change, side by side: what git has on the left, what's in the folder (or staged) on the right,
 * in Monaco's own diff editor with the workbench's colours.
 *
 * Both sides are read-only copies made here, under their own `crystal-git:` addresses, so looking
 * at a change never touches the file's own editor tab, its undo history or its unsaved edits. It
 * looks again every few seconds, so it follows what's being typed, saved or run in the terminal.
 * Squiggles are turned off on the copies: they are old versions of a file, and the TypeScript
 * service would otherwise complain about an import that only resolves in the current one.
 */
export function GitDiffView({ git, monaco, target, onOpenFile }: { git: GitState; monaco: MonacoApi; target: DiffTarget; onOpenFile: (path: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);
  const models = useRef<{ original: Monaco.editor.ITextModel; modified: Monaco.editor.ITextModel } | null>(null);
  const [sides, setSides] = useState<GitDiffSides | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inline, setInline] = useState(false);
  const gitRef = useRef(git);
  gitRef.current = git;

  // Fetch the two sides now, and keep looking.
  useEffect(() => {
    let dead = false;
    const load = async () => {
      const r = await gitRef.current.diff({ path: target.path, from: target.from, mode: target.mode });
      if (dead) return;
      if (r.ok) {
        setError(null);
        setSides((prev) => (prev && sameSides(prev, r.value) ? prev : r.value));
      } else setError(r.message);
    };
    void load();
    const id = setInterval(() => !document.hidden && void load(), POLL_MS);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [target.path, target.from, target.mode]);

  // The editor, once.
  useEffect(() => {
    if (!host.current) return;
    const ed = monaco.editor.createDiffEditor(host.current, {
      theme: "crystal-app",
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
      renderValidationDecorations: "off",
      ignoreTrimWhitespace: false,
      renderOverviewRuler: true,
      enableSplitViewResizing: true,
      fontFamily: EDITOR_FONT,
      fontSize: EDITOR_FONT_SIZE(),
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      glyphMargin: false,
      folding: true,
      scrollbar: { verticalScrollbarSize: 14, horizontalScrollbarSize: 10, useShadows: false },
    });
    editor.current = ed;
    return () => {
      ed.setModel(null);
      ed.dispose();
      editor.current = null;
      models.current?.original.dispose();
      models.current?.modified.dispose();
      models.current = null;
    };
  }, [monaco]);

  useEffect(() => {
    editor.current?.updateOptions({ renderSideBySide: !inline });
  }, [inline]);

  // Put the text in the models, making them the first time and changing them after.
  useEffect(() => {
    const ed = editor.current;
    if (!ed || !sides || sides.binary || sides.tooLarge) return;
    if (!models.current) {
      const language = languageFor(target.path);
      const make = (side: string, text: string) => {
        const uri = monaco.Uri.from({ scheme: "crystal-git", authority: side, path: `/${target.mode}/${target.path}` });
        monaco.editor.getModel(uri)?.dispose();
        return monaco.editor.createModel(text, language, uri);
      };
      models.current = { original: make("original", sides.original), modified: make("modified", sides.modified) };
      ed.setModel(models.current);
      return;
    }
    if (models.current.original.getValue() !== sides.original) models.current.original.setValue(sides.original);
    if (models.current.modified.getValue() !== sides.modified) models.current.modified.setValue(sides.modified);
  }, [sides, monaco, target.mode, target.path]);

  const change = git.byPath.get(target.path);
  const canStage = target.mode === "unstaged" && !!change?.unstaged;
  const canUnstage = target.mode === "staged" && !!change?.staged;
  const gone = !!change && change.unstaged === "D";
  const same = !!sides && !sides.binary && !sides.tooLarge && sides.original === sides.modified;
  const message = error ?? (sides?.binary ? "This file isn't text, so there is nothing to compare here." : sides?.tooLarge ? "This file is too big to compare here." : null);

  const button = "flex h-[22px] items-center gap-1 rounded-[2px] px-2 text-[12px] hover:bg-[var(--vsc-list-hover)] disabled:opacity-40";
  return (
    <div className="absolute inset-0 z-10 flex flex-col" style={{ background: "var(--vsc-editor)" }}>
      <div className="flex h-[30px] shrink-0 items-center gap-2 border-b px-3 text-[12px]" style={{ borderColor: "var(--vsc-border)", background: "var(--vsc-widget)" }}>
        <FileGlyph name={baseOf(target.path)} />
        <span className="min-w-0 truncate">
          {baseOf(target.path)}
          {parentOf(target.path) && <span style={{ color: "var(--vsc-muted)" }}> {parentOf(target.path)}</span>}
        </span>
        {sides && !message && (
          <span className="shrink-0" style={{ color: "var(--vsc-muted)" }}>
            {sides.originalLabel} ↔ {sides.modifiedLabel}
            {target.from && target.from !== target.path ? ` (renamed from ${target.from})` : ""}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {canStage && (
            <button type="button" className={button} onClick={() => void git.stage([target.path])} title="Stage this change">
              <Plus className="size-3.5" /> Stage
            </button>
          )}
          {canUnstage && (
            <button type="button" className={button} onClick={() => void git.unstage([target.path])} title="Unstage this change">
              <Minus className="size-3.5" /> Unstage
            </button>
          )}
          <button type="button" className={button} onClick={() => setInline((i) => !i)} title={inline ? "Show side by side" : "Show inline"}>
            {inline ? <Columns2 className="size-3.5" /> : <Rows2 className="size-3.5" />}
            {inline ? "Side by side" : "Inline"}
          </button>
          <button type="button" className={button} disabled={gone} onClick={() => onOpenFile(target.path)} title="Open the file in the editor">
            <FileText className="size-3.5" /> Open file
          </button>
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={host} className="absolute inset-0" />
        {(!sides && !error) && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: "var(--vsc-editor)" }}>
            <Loader2 className="size-5 animate-spin opacity-60" />
          </div>
        )}
        {message && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[13px]" style={{ background: "var(--vsc-editor)", color: error ? "var(--vsc-error)" : "var(--vsc-muted)" }}>
            {message}
          </div>
        )}
        {same && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded px-3 py-1 text-[12px]" style={{ background: "var(--vsc-widget)", color: "var(--vsc-muted)", border: "1px solid var(--vsc-widget-border)" }}>
            The two sides are the same{target.mode === "staged" ? " (only the file's mode or name changed)" : ""}.
          </div>
        )}
      </div>
    </div>
  );
}

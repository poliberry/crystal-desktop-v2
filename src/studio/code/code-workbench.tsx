"use client";

import { UnsavedDialog } from "@/studio/shell/unsaved-dialog";
import type * as Monaco from "monaco-editor";
import { AlertTriangle, Bell, Check, ChevronRight, CircleX, Files, Loader2, Maximize2, Minimize2, Play, Plus, Search, Settings, TriangleAlert, Trash2, X, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CodeMenuBar, EXPLORER_EVENT, type ExplorerRequest, type MenuDef } from "@/studio/code/code-menu-bar";
import { FileTree } from "@/studio/code/file-tree";
import { SearchView } from "@/studio/code/search-view";
import { TerminalPanel, useTerminals } from "@/studio/code/terminal-panel";
import type { CodeWorkbench as Workbench } from "@/studio/code/use-code-workbench";
import { EDITOR_FONT, EDITOR_FONT_SIZE, PaletteProvider, WORKBENCH_FONT, ctrlKey, modKey, paletteVars, shiftKey, useWorkbenchPalette, type VscPalette } from "@/studio/code/vscode-theme";
import { FileGlyph, QuickPick, Sash, type PickItem } from "@/studio/code/vscode-ui";
import { applyVscodeTheme } from "@/studio/code/monaco";
import { baseOf } from "@/studio/storage/workspace";
import { useStudioChrome } from "@/studio/shell/chrome";
import { cn } from "@/lib/utils";

interface CursorInfo {
  line: number;
  column: number;
  selected: number;
  spaces: number;
  eol: string;
  language: string;
}

const LANGUAGE_NAME: Record<string, string> = { typescript: "TypeScript", javascript: "JavaScript", json: "JSON", markdown: "Markdown", shell: "Shell Script", plaintext: "Plain Text" };

/**
 * Monaco, with VS Code's own defaults (its font and size, minimap, sticky scroll, folding, glyph
 * margin, bracket colours and guides), on whichever model the active tab has. One editor, many
 * models: undo history, scroll and cursor stay with each file.
 */
function Surface({ wb, palette, api, onCursor, onPalette, onQuickOpen }: { wb: Workbench; palette: VscPalette; api: React.MutableRefObject<Monaco.editor.IStandaloneCodeEditor | null>; onCursor: (c: CursorInfo | null) => void; onPalette: () => void; onQuickOpen: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const views = useRef(new Map<string, Monaco.editor.ICodeEditorViewState | null>());
  const shown = useRef<string | null>(null);
  const wbRef = useRef(wb);
  wbRef.current = wb;
  const handlers = useRef({ onCursor, onPalette, onQuickOpen });
  handlers.current = { onCursor, onPalette, onQuickOpen };
  const { monaco } = wb;

  useEffect(() => {
    if (!monaco || !host.current) return;
    const ed = monaco.editor.create(host.current, {
      model: null,
      theme: "crystal-app",
      automaticLayout: true,
      fontFamily: EDITOR_FONT,
      fontSize: EDITOR_FONT_SIZE(),
      lineHeight: 0,
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: true,
      minimap: { enabled: true, renderCharacters: true, maxColumn: 120, showSlider: "mouseover" },
      stickyScroll: { enabled: true },
      glyphMargin: true,
      folding: true,
      showFoldingControls: "mouseover",
      lineNumbers: "on",
      renderLineHighlight: "line",
      renderWhitespace: "selection",
      scrollBeyondLastLine: true,
      smoothScrolling: false,
      cursorBlinking: "blink",
      cursorSmoothCaretAnimation: "off",
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: false, indentation: true },
      matchBrackets: "always",
      occurrencesHighlight: "singleFile",
      selectionHighlight: true,
      quickSuggestions: { other: true, comments: false, strings: true },
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: "on",
      tabCompletion: "off",
      parameterHints: { enabled: true },
      formatOnPaste: false,
      formatOnType: false,
      linkedEditing: false,
      lightbulb: { enabled: "onCode" as never },
      fixedOverflowWidgets: true,
      contextmenu: true,
      mouseWheelZoom: false,
      scrollbar: { verticalScrollbarSize: 14, horizontalScrollbarSize: 10, useShadows: false },
      overviewRulerBorder: false,
      padding: { top: 0, bottom: 0 },
      "semanticHighlighting.enabled": true,
    });
    api.current = ed;
    // Save from the keyboard. Edits also save themselves a moment after typing stops.
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void wbRef.current.saveAll());
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => handlers.current.onQuickOpen());
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP, () => handlers.current.onPalette());
    ed.addCommand(monaco.KeyCode.F1, () => handlers.current.onPalette());

    const report = () => {
      const model = ed.getModel();
      const pos = ed.getPosition();
      if (!model || !pos) return handlers.current.onCursor(null);
      const sel = ed.getSelection();
      handlers.current.onCursor({
        line: pos.lineNumber,
        column: pos.column,
        selected: sel && !sel.isEmpty() ? model.getValueInRange(sel).length : 0,
        spaces: model.getOptions().tabSize,
        eol: model.getEOL() === "\r\n" ? "CRLF" : "LF",
        language: LANGUAGE_NAME[model.getLanguageId()] ?? "Plain Text",
      });
    };
    const subs = [ed.onDidChangeCursorPosition(report), ed.onDidChangeCursorSelection(report), ed.onDidChangeModel(report)];
    report();
    return () => {
      subs.forEach((s) => s.dispose());
      ed.dispose();
      api.current = null;
      shown.current = null;
    };
  }, [monaco, api]);

  useEffect(() => {
    if (monaco) applyVscodeTheme(monaco, palette);
  }, [monaco, palette]);

  useEffect(() => {
    const ed = api.current;
    if (!ed) return;
    if (shown.current) views.current.set(shown.current, ed.saveViewState());
    const model = wb.active ? wb.modelFor(wb.active) : null;
    ed.setModel(model);
    shown.current = wb.active;
    if (wb.active && model) {
      const saved = views.current.get(wb.active);
      if (saved) ed.restoreViewState(saved);
      ed.focus();
    }
  }, [wb.active, wb, monaco, api]);

  return <div ref={host} className="h-full w-full" />;
}

type ViewId = "explorer" | "search" | "run";
type PanelTab = "problems" | "output" | "terminal";

export interface CodeWorkbenchViewProps {
  wb: Workbench;
  projectName: string;
  /** The project's settings, opened from the gear in the activity bar or as an editor tab. */
  settings: React.ReactNode;
  settingsLabel: string;
  /** A sidebar view of its own, such as an extension's test run. */
  run?: React.ReactNode;
  /** Changes when the run view should be brought forward (a run was just started). */
  runSignal?: number;
  runLabel?: string;
  /** Buttons at the right of the tab bar, as VS Code's editor actions. */
  toolbar?: React.ReactNode;
  /** Whether this kind of project has a build step and output to show. */
  hasBuild?: boolean;
  /** Help ▸ the guide for this kind of project: the address of its overview in Explore. */
  guide?: { label: string; id: string };
  /** Help ▸ the reference for this kind of project's SDK: an address in the Reference tab (`bot/Client`). */
  reference?: { label: string; anchor: string };
  /** Extra commands for the palette. */
  commands?: PickItem[];
  /** What the Run menu offers (Build, Run, …). With none, there is no Run menu. */
  runItems?: { label: string; keys?: string; run: () => void; disabled?: boolean }[];
}

const PROBLEMS_ICON = { error: CircleX, warning: TriangleAlert } as const;

/**
 * The code workbench, laid out as VS Code's: activity bar, side bar (Explorer / Search / Run),
 * editor group with tabs and breadcrumbs, a bottom panel (Problems / Output / Terminal) and a status
 * bar, with VS Code's Dark Modern / Light Modern colours, 13px system font, sashes, Go to File,
 * Command Palette and keybindings. Its behaviour (saving, outside changes, checking, building) lives
 * in `useCodeWorkbench`; this is how it looks and how its parts are arranged.
 */
export function CodeWorkbenchView({ wb, projectName, settings, settingsLabel, run, runSignal, runLabel = "Run", toolbar, hasBuild, guide, reference, commands = [], runItems = [] }: CodeWorkbenchViewProps) {
  const theme = useWorkbenchPalette();
  const palette = useMemo(() => paletteVars(theme), [theme]);
  const terminals = useTerminals();
  // Crystal's own components (the project settings, the test-run frame, dialogs) are drawn from its
  // theme tokens. Inside the workbench those tokens are pointed at VS Code's colours, so nothing in
  // here looks like it belongs to a different program.
  const scoped = useMemo(() => {
    const p = theme;
    return {
      "--background": p.editor, "--foreground": p.editorFg, "--card": p.widget, "--card-foreground": p.editorFg,
      "--popover": p.widget, "--popover-foreground": p.editorFg, "--primary": p.accent, "--primary-foreground": p.accentFg,
      "--secondary": p.listInactive, "--secondary-foreground": p.editorFg, "--muted": p.input, "--muted-foreground": p.muted,
      "--accent": p.listHover, "--accent-foreground": p.editorFg, "--destructive": p.error, "--border": p.border,
      "--input": p.inputBorder, "--ring": p.accent, "--radius": "0.25rem",
    } as Record<string, string>;
  }, [theme]);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const [view, setView] = useState<ViewId>("explorer");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMax, setPanelMax] = useState(false);
  const [panelHeight, setPanelHeight] = useState(240);
  const [panelTab, setPanelTab] = useState<PanelTab>("problems");
  const [showSettings, setShowSettings] = useState(false);
  const [quick, setQuick] = useState<null | "files" | "commands">(null);
  const [files, setFiles] = useState<string[]>([]);
  const [cursor, setCursor] = useState<CursorInfo | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const mod = modKey();
  const chrome = useStudioChrome();
  // View ▸ Appearance toggles that belong to the editor rather than to the layout.
  const [opts, setOpts] = useState({ minimap: true, wrap: false, whitespace: false });
  useEffect(() => {
    editorRef.current?.updateOptions({
      minimap: { enabled: opts.minimap, renderCharacters: true, maxColumn: 120, showSlider: "mouseover" },
      wordWrap: opts.wrap ? "on" : "off",
      renderWhitespace: opts.whitespace ? "all" : "selection",
    });
  }, [opts, wb.ready]);

  useEffect(() => {
    if (runSignal) {
      setView("run");
      setSidebarOpen(true);
      setSidebarWidth((w) => Math.max(w, 340));
    }
  }, [runSignal]);

  // Choosing a file leaves the settings tab.
  useEffect(() => {
    if (wb.active) setShowSettings(false);
  }, [wb.active]);

  // A finished build shows its result, as a task's output does: a failure is the thing to look at.
  useEffect(() => {
    if (wb.build.status === "ok" || wb.build.status === "failed") {
      setPanelTab("output");
      setPanelOpen(true);
    }
  }, [wb.build]);

  const go = useCallback(
    async (file: string | undefined, line?: number, column?: number) => {
      if (!file) return;
      setShowSettings(false);
      await wb.openFile(file);
      if (line) {
        const reveal = () => {
          const ed = editorRef.current;
          if (!ed) return;
          ed.revealLineInCenter(line);
          ed.setPosition({ lineNumber: line, column: column ?? 1 });
          ed.focus();
        };
        requestAnimationFrame(() => requestAnimationFrame(reveal));
      }
    },
    [wb],
  );

  const showView = useCallback((v: ViewId) => {
    setView((cur) => {
      setSidebarOpen((open) => (cur === v ? !open : true));
      return v;
    });
    if (v === "run") setSidebarWidth((w) => Math.max(w, 340));
  }, []);

  const openPanel = useCallback((tab: PanelTab) => {
    setPanelTab(tab);
    setPanelOpen(true);
  }, []);
  const toggleTerminal = useCallback(() => {
    if (panelOpen && panelTab === "terminal") return setPanelOpen(false);
    openPanel("terminal");
    if (terminals.sessions.length === 0) terminals.add();
  }, [panelOpen, panelTab, openPanel, terminals]);

  const openQuick = useCallback(
    async (mode: "files" | "commands") => {
      if (mode === "files") setFiles(await wb.allFiles());
      setQuick(mode);
    },
    [wb],
  );

  const errors = wb.problems.filter((p) => p.severity === "error").length;
  const warnings = wb.problems.length - errors;
  const activeConflict = wb.active && wb.conflicts.has(wb.active);
  const activeMissing = wb.active && wb.missing.has(wb.active);
  const mac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

  // --- VS Code's keybindings --------------------------------------------------------------------
  const onKeyDown = (e: React.KeyboardEvent) => {
    const m = mac ? e.metaKey : e.ctrlKey;
    const k = e.key.toLowerCase();
    const eat = (fn: () => void) => (e.preventDefault(), e.stopPropagation(), fn());
    if (m && !e.shiftKey && !e.altKey && k === "p") return eat(() => void openQuick("files"));
    if ((m && e.shiftKey && k === "p") || e.key === "F1") return eat(() => void openQuick("commands"));
    if (m && e.shiftKey && k === "f") return eat(() => showView("search"));
    if (m && e.shiftKey && k === "e") return eat(() => showView("explorer"));
    if (m && !e.shiftKey && k === "b") return eat(() => setSidebarOpen((o) => !o));
    if (m && !e.shiftKey && k === "j") return eat(() => setPanelOpen((o) => !o));
    if (m && e.shiftKey && k === "m") return eat(() => openPanel("problems"));
    if (m && k === ",") return eat(() => setShowSettings(true));
    if (e.ctrlKey && (e.key === "`" || e.code === "Backquote")) return eat(toggleTerminal);
    if (m && !e.shiftKey && k === "w" && (wb.active || showSettings)) return eat(() => (showSettings ? setShowSettings(false) : wb.closeFile(wb.active!)));
    if (e.key === "Escape" && quick) return eat(() => setQuick(null));
  };

  // --- Palette ------------------------------------------------------------------------------------
  const action = (id: string) => () => void editorRef.current?.getAction(id)?.run();
  const commandItems: PickItem[] = [
    { id: "go-file", label: "Go to File…", hint: `${mod}P`, run: () => void openQuick("files") },
    { id: "find-files", label: "Search: Find in Files", hint: `${shiftKey()}${mod}F`, run: () => showView("search") },
    { id: "explorer", label: "View: Show Explorer", hint: `${shiftKey()}${mod}E`, run: () => showView("explorer") },
    { id: "problems", label: "View: Focus Problems", hint: `${shiftKey()}${mod}M`, run: () => openPanel("problems") },
    { id: "terminal", label: "View: Toggle Terminal", hint: `${ctrlKey()}\``, run: toggleTerminal },
    { id: "panel", label: "View: Toggle Panel", hint: `${mod}J`, run: () => setPanelOpen((o) => !o) },
    { id: "sidebar", label: "View: Toggle Primary Side Bar", hint: `${mod}B`, run: () => setSidebarOpen((o) => !o) },
    { id: "new-terminal", label: "Terminal: Create New Terminal", run: () => (openPanel("terminal"), terminals.add()) },
    { id: "save-all", label: "File: Save All", hint: mac ? "⌥⌘S" : "Ctrl+K S", run: () => void wb.saveAll() },
    { id: "close", label: "View: Close Editor", hint: `${mod}W`, run: () => wb.active && wb.closeFile(wb.active) },
    { id: "settings", label: `Preferences: Open ${settingsLabel}`, hint: `${mod},`, run: () => setShowSettings(true) },
    { id: "reveal", label: mac ? "File: Reveal in Finder" : "File: Reveal in File Explorer", run: () => void wb.ws?.reveal(wb.active ?? "") },
    { id: "format", label: "Format Document", hint: mac ? "⇧⌥F" : "Shift+Alt+F", run: action("editor.action.formatDocument") },
    { id: "goto-line", label: "Go to Line/Column…", hint: mac ? "⌃G" : "Ctrl+G", run: action("editor.action.gotoLine") },
    { id: "find", label: "Find", hint: `${mod}F`, run: action("actions.find") },
    { id: "replace", label: "Replace", hint: mac ? "⌥⌘F" : "Ctrl+H", run: action("editor.action.startFindReplace") },
    { id: "comment", label: "Toggle Line Comment", hint: `${mod}/`, run: action("editor.action.commentLine") },
    { id: "fold-all", label: "Fold All", run: action("editor.foldAll") },
    { id: "unfold-all", label: "Unfold All", run: action("editor.unfoldAll") },
    ...(run ? [{ id: "show-run", label: `View: Show ${runLabel}`, run: () => showView("run") }] : []),
    ...commands,
  ];
  const fileItems: PickItem[] = files.map((f) => ({ id: f, label: f.includes("/") ? baseOf(f) : f, detail: f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : undefined, icon: <FileGlyph name={baseOf(f)} />, run: () => void go(f) }));
  // Matching on the whole path means `src/ind` finds src/index.ts, as in VS Code.
  const fileItemsFull = fileItems.map((it) => ({ ...it, label: it.detail ? `${it.detail}/${it.label}` : it.label, detail: undefined }));

  // --- Menu bar -----------------------------------------------------------------------------------
  // VS Code's File, Edit, Selection, View, Go, Run, Terminal, Help. Each item is one of the functions
  // above (the same ones the palette and the keybindings call) or a Monaco action by its own id.
  const ed = () => editorRef.current;
  const focused = (fn: () => void) => () => {
    ed()?.focus();
    fn();
  };
  const trigger = (id: string) => () => void ed()?.trigger("menu", id, null);
  const exec = (cmd: "cut" | "copy") => focused(() => void document.execCommand(cmd));
  const paste = focused(() => {
    // Reading the clipboard asks permission; if it is refused there is simply nothing to paste.
    void navigator.clipboard
      .readText()
      .then((text) => ed()?.trigger("menu", "type", { text }))
      .catch(() => undefined);
  });
  const explorer = (action: ExplorerRequest["action"]) => () => {
    showView("explorer");
    setSidebarOpen(true);
    // After the Explorer has had a chance to mount, if it wasn't already showing.
    setTimeout(() => window.dispatchEvent(new CustomEvent<ExplorerRequest>(EXPLORER_EVENT, { detail: { action } })), 30);
  };
  const noFile = !wb.active || showSettings;
  const at = (id: string) => focused(() => void ed()?.getAction(id)?.run());

  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        { label: "New File…", run: explorer("new-file"), disabled: !wb.ws },
        { label: "New Folder…", run: explorer("new-folder"), disabled: !wb.ws },
        "-",
        { label: "Go to File…", keys: `${mod}P`, run: () => void openQuick("files") },
        "-",
        { label: "Save", keys: `${mod}S`, run: () => wb.active && void wb.saveFile(wb.active), disabled: noFile },
        { label: "Save All", keys: mac ? "⌥⌘S" : "Ctrl+K S", run: () => void wb.saveAll() },
        "-",
        { label: "Close Editor", keys: `${mod}W`, run: () => (showSettings ? setShowSettings(false) : wb.active && wb.closeFile(wb.active)), disabled: !wb.active && !showSettings },
        { label: "Reveal in " + (mac ? "Finder" : "File Explorer"), run: () => void wb.ws?.reveal(wb.active ?? ""), disabled: !wb.ws },
        "-",
        { label: `Open ${settingsLabel}`, keys: `${mod},`, run: () => setShowSettings(true) },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", keys: `${mod}Z`, run: trigger("undo"), disabled: noFile },
        { label: "Redo", keys: mac ? "⇧⌘Z" : "Ctrl+Y", run: trigger("redo"), disabled: noFile },
        "-",
        { label: "Cut", keys: `${mod}X`, run: exec("cut"), disabled: noFile },
        { label: "Copy", keys: `${mod}C`, run: exec("copy"), disabled: noFile },
        { label: "Paste", keys: `${mod}V`, run: paste, disabled: noFile },
        "-",
        { label: "Find", keys: `${mod}F`, run: at("actions.find"), disabled: noFile },
        { label: "Replace", keys: mac ? "⌥⌘F" : "Ctrl+H", run: at("editor.action.startFindReplace"), disabled: noFile },
        { label: "Find in Files", keys: `${shiftKey()}${mod}F`, run: () => showView("search") },
        "-",
        { label: "Toggle Line Comment", keys: `${mod}/`, run: at("editor.action.commentLine"), disabled: noFile },
        { label: "Format Document", keys: mac ? "⇧⌥F" : "Shift+Alt+F", run: at("editor.action.formatDocument"), disabled: noFile },
      ],
    },
    {
      label: "Selection",
      items: [
        { label: "Select All", keys: `${mod}A`, run: at("editor.action.selectAll"), disabled: noFile },
        { label: "Expand Selection", keys: mac ? "⌃⇧⌘→" : "Shift+Alt+Right", run: at("editor.action.smartSelect.expand"), disabled: noFile },
        { label: "Shrink Selection", keys: mac ? "⌃⇧⌘←" : "Shift+Alt+Left", run: at("editor.action.smartSelect.shrink"), disabled: noFile },
        "-",
        { label: "Copy Line Up", keys: mac ? "⌥⇧↑" : "Shift+Alt+Up", run: at("editor.action.copyLinesUpAction"), disabled: noFile },
        { label: "Copy Line Down", keys: mac ? "⌥⇧↓" : "Shift+Alt+Down", run: at("editor.action.copyLinesDownAction"), disabled: noFile },
        { label: "Move Line Up", keys: mac ? "⌥↑" : "Alt+Up", run: at("editor.action.moveLinesUpAction"), disabled: noFile },
        { label: "Move Line Down", keys: mac ? "⌥↓" : "Alt+Down", run: at("editor.action.moveLinesDownAction"), disabled: noFile },
        "-",
        { label: "Add Cursor Above", keys: mac ? "⌥⌘↑" : "Ctrl+Alt+Up", run: at("editor.action.insertCursorAbove"), disabled: noFile },
        { label: "Add Cursor Below", keys: mac ? "⌥⌘↓" : "Ctrl+Alt+Down", run: at("editor.action.insertCursorBelow"), disabled: noFile },
        { label: "Select All Occurrences", keys: `${shiftKey()}${mod}L`, run: at("editor.action.selectHighlights"), disabled: noFile },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Command Palette…", keys: `${shiftKey()}${mod}P`, run: () => void openQuick("commands") },
        "-",
        { label: "Explorer", keys: `${shiftKey()}${mod}E`, run: () => showView("explorer"), checked: sidebarOpen && view === "explorer" },
        { label: "Search", keys: `${shiftKey()}${mod}F`, run: () => showView("search"), checked: sidebarOpen && view === "search" },
        ...(run ? [{ label: runLabel, run: () => showView("run"), checked: sidebarOpen && view === "run" }] : []),
        "-",
        { label: "Primary Side Bar", keys: `${mod}B`, run: () => setSidebarOpen((o) => !o), checked: sidebarOpen },
        { label: "Panel", keys: `${mod}J`, run: () => setPanelOpen((o) => !o), checked: panelOpen },
        { label: "Minimap", run: () => setOpts((o) => ({ ...o, minimap: !o.minimap })), checked: opts.minimap },
        { label: "Word Wrap", run: () => setOpts((o) => ({ ...o, wrap: !o.wrap })), checked: opts.wrap },
        { label: "Render Whitespace", run: () => setOpts((o) => ({ ...o, whitespace: !o.whitespace })), checked: opts.whitespace },
        "-",
        { label: "Problems", keys: `${shiftKey()}${mod}M`, run: () => openPanel("problems") },
        ...(hasBuild ? [{ label: "Output", run: () => openPanel("output") }] : []),
        { label: "Terminal", keys: `${ctrlKey()}\``, run: toggleTerminal },
        "-",
        { label: "Fold All", run: at("editor.foldAll"), disabled: noFile },
        { label: "Unfold All", run: at("editor.unfoldAll"), disabled: noFile },
      ],
    },
    {
      label: "Go",
      items: [
        { label: "Go to File…", keys: `${mod}P`, run: () => void openQuick("files") },
        { label: "Go to Symbol in Editor…", keys: `${shiftKey()}${mod}O`, run: at("editor.action.quickOutline"), disabled: noFile },
        { label: "Go to Line/Column…", keys: mac ? "⌃G" : "Ctrl+G", run: at("editor.action.gotoLine"), disabled: noFile },
        "-",
        { label: "Go to Definition", keys: "F12", run: at("editor.action.revealDefinition"), disabled: noFile },
        { label: "Go to References", keys: "Shift+F12", run: at("editor.action.goToReferences"), disabled: noFile },
        "-",
        { label: "Next Problem", keys: "F8", run: at("editor.action.marker.next"), disabled: noFile },
        { label: "Previous Problem", keys: "Shift+F8", run: at("editor.action.marker.prev"), disabled: noFile },
      ],
    },
    {
      label: "Run",
      items: [
        { label: "Check Project", run: () => (openPanel("problems"), void wb.check()), disabled: !wb.ready },
        ...(runItems.length ? (["-", ...runItems] as MenuDef["items"]) : []),
      ],
    },
    {
      label: "Terminal",
      items: [
        { label: "New Terminal", run: () => (openPanel("terminal"), terminals.add()) },
        { label: "Toggle Terminal", keys: `${ctrlKey()}\``, run: toggleTerminal },
        { label: "Kill Terminal", run: () => terminals.current !== null && terminals.close(terminals.current), disabled: terminals.current === null },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Show All Commands", keys: `${shiftKey()}${mod}P`, run: () => void openQuick("commands") },
        ...(guide ? [{ label: guide.label, run: () => chrome.openGuides?.(guide.id), disabled: !chrome.openGuides }] : []),
        ...(reference ? [{ label: reference.label, run: () => chrome.openReference?.(reference.anchor), disabled: !chrome.openReference }] : []),
        { label: "Studio code editor guides", run: () => chrome.openGuides?.("code"), disabled: !chrome.openGuides },
      ],
    },
  ];

  const labelFor = (path: string) => {
    const name = baseOf(path);
    return wb.open.filter((p) => baseOf(p) === name).length > 1 ? `${name}` : name;
  };

  if (!wb.available) return <p className="p-6 text-sm text-muted-foreground">Extensions and bots are edited in the Crystal desktop app, where a project can be a folder of files on your computer.</p>;
  if (wb.error && !wb.ready) {
    return (
      <div role="alert" className="m-6 rounded border p-4 text-[13px]" style={{ borderColor: "#f14c4c", color: "#f14c4c" }}>
        The editor couldn&apos;t start: {wb.error}
      </div>
    );
  }

  const activityIcon = (id: ViewId, Icon: typeof Files, label: string, keys?: string) => {
    const on = sidebarOpen && view === id;
    return (
      <button
        key={id}
        type="button"
        title={keys ? `${label} (${keys})` : label}
        aria-label={label}
        aria-pressed={on}
        onClick={() => showView(id)}
        className="relative flex h-12 w-12 items-center justify-center"
        style={{ color: on ? "var(--vsc-activity-fg)" : "var(--vsc-activity-inactive)" }}
      >
        {on && <span className="absolute inset-y-0 left-0 w-0.5" style={{ background: "var(--vsc-accent)" }} />}
        <Icon className="size-6" strokeWidth={1.5} />
      </button>
    );
  };

  const panelTitle = (id: PanelTab, label: string, count?: number) => (
    <button
      key={id}
      type="button"
      onClick={() => openPanel(id)}
      className="relative flex h-full items-center gap-1.5 px-2.5 text-[11px] uppercase"
      style={{ color: panelOpen && panelTab === id ? "var(--vsc-panel-title-active)" : "var(--vsc-panel-title-inactive)", borderBottom: `1px solid ${panelOpen && panelTab === id ? "var(--vsc-panel-title-active)" : "transparent"}` }}
    >
      {label}
      {count ? <span className="rounded-full px-1.5 text-[11px] leading-[16px]" style={{ background: "var(--vsc-badge)", color: "var(--vsc-badge-fg)" }}>{count}</span> : null}
    </button>
  );

  const crumbs = wb.active ? wb.active.split("/") : [];

  return (
    <PaletteProvider value={theme}>
    <div
      ref={root}
      data-vsc-root
      onKeyDownCapture={onKeyDown}
      className="relative flex h-full min-h-0 select-none flex-col overflow-hidden"
      style={{ ...palette, ...scoped, background: "var(--vsc-editor)", color: "var(--vsc-editor-fg)", fontFamily: WORKBENCH_FONT, fontSize: 13 } as React.CSSProperties}
    >
      <CodeMenuBar menus={menus} vars={palette} scoped={scoped} />
      <div className="flex min-h-0 flex-1">
        {/* Activity bar */}
        <nav className="flex w-12 shrink-0 flex-col justify-between border-r" style={{ background: "var(--vsc-activity-bar)", borderColor: "var(--vsc-border)" }}>
          <div>
            {activityIcon("explorer", Files, "Explorer", `${shiftKey()}${mod}E`)}
            {activityIcon("search", Search, "Search", `${shiftKey()}${mod}F`)}
            {run && activityIcon("run", Play, runLabel)}
          </div>
          <div>
            <button type="button" title={`${settingsLabel} (${mod},)`} aria-label={settingsLabel} onClick={() => setShowSettings(true)} className="flex h-12 w-12 items-center justify-center" style={{ color: showSettings ? "var(--vsc-activity-fg)" : "var(--vsc-activity-inactive)" }}>
              <Settings className="size-6" strokeWidth={1.5} />
            </button>
          </div>
        </nav>

        {/* Side bar */}
        {sidebarOpen && (
          <>
            <aside className="shrink-0 overflow-hidden" style={{ width: sidebarWidth, background: "var(--vsc-sidebar)", color: "var(--vsc-sidebar-fg)" }}>
              {wb.ready && view === "explorer" && <FileTree wb={wb} projectName={projectName} />}
              {wb.ready && view === "search" && <SearchView wb={wb} onOpen={(p, l, c) => void go(p, l, c)} />}
              {view === "run" && (
                <div className="flex h-full flex-col">
                  <div className="flex h-[35px] shrink-0 items-center pl-5 text-[11px] uppercase" style={{ color: "var(--vsc-sidebar-title-fg)" }}>{runLabel}</div>
                  <div className="min-h-0 flex-1 overflow-y-auto">{run}</div>
                </div>
              )}
            </aside>
            <Sash orientation="vertical" onDrag={(d) => setSidebarWidth((w) => Math.min(600, Math.max(170, w + d)))} />
          </>
        )}

        {/* Editor group */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {!panelMax && (
            <>
              <div className="flex h-[35px] shrink-0 items-stretch" style={{ background: "var(--vsc-tab-inactive)" }}>
                <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none]">
                  {showSettings && (
                    <Tab active label={settingsLabel} glyph={<Settings className="size-3.5" />} onSelect={() => undefined} onClose={() => setShowSettings(false)} />
                  )}
                  {wb.open.map((path) => (
                    <Tab
                      key={path}
                      active={!showSettings && wb.active === path}
                      label={labelFor(path)}
                      title={path}
                      glyph={<FileGlyph name={baseOf(path)} />}
                      dirty={wb.dirty.has(path)}
                      conflict={wb.conflicts.has(path)}
                      muted={wb.missing.has(path)}
                      onSelect={() => (setShowSettings(false), wb.setActive(path))}
                      onClose={() => wb.closeFile(path)}
                    />
                  ))}
                  <div className="flex-1 border-b" style={{ borderColor: "var(--vsc-border)" }} />
                </div>
                <div className="flex shrink-0 items-center gap-1 border-b px-2" style={{ borderColor: "var(--vsc-border)" }}>{toolbar}</div>
              </div>

              {!showSettings && wb.active && (
                <div className="flex h-[22px] shrink-0 items-center gap-0.5 overflow-hidden px-3 text-[13px]" style={{ background: "var(--vsc-editor)", color: "var(--vsc-breadcrumb)" }}>
                  {crumbs.map((c, i) => (
                    <span key={i} className="flex items-center gap-0.5" style={i === crumbs.length - 1 ? { color: "var(--vsc-breadcrumb-active)" } : undefined}>
                      {i > 0 && <ChevronRight className="size-3.5 opacity-70" />}
                      {i === crumbs.length - 1 && <FileGlyph name={c} />}
                      {c}
                    </span>
                  ))}
                </div>
              )}

              {(wb.error || activeConflict || activeMissing) && !showSettings && (
                <div role="alert" className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 text-[12px]" style={{ borderColor: "var(--vsc-border)", background: "var(--vsc-widget)" }}>
                  <AlertTriangle className="size-3.5 shrink-0" style={{ color: "var(--vsc-warning)" }} />
                  <span className="min-w-0 flex-1">
                    {wb.error ??
                      (activeConflict
                        ? `The file ${baseOf(wb.active!)} is newer on disk: it was changed outside Studio while you had unsaved edits. Nothing has been overwritten.`
                        : `${baseOf(wb.active!)} was deleted or moved outside Studio. What you see is still here.`)}
                  </span>
                  {wb.error ? (
                    <VscButton onClick={wb.clearError}>Dismiss</VscButton>
                  ) : activeConflict ? (
                    <>
                      <VscButton onClick={() => void wb.reloadFromDisk(wb.active!)}>Revert</VscButton>
                      <VscButton onClick={() => void wb.overwriteDisk(wb.active!)}>Overwrite</VscButton>
                    </>
                  ) : (
                    <VscButton onClick={() => void wb.overwriteDisk(wb.active!)}>Save again</VscButton>
                  )}
                </div>
              )}

              <div className="relative min-h-0 flex-1">
                {showSettings ? (
                  <div className="absolute inset-0 select-text overflow-y-auto" style={{ background: "var(--vsc-editor)" }}>{settings}</div>
                ) : !wb.ready ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="size-5 animate-spin opacity-60" />
                  </div>
                ) : (
                  <>
                    <div className={cn("h-full w-full", !wb.active && "invisible")}>
                      <Surface wb={wb} palette={theme} api={editorRef} onCursor={setCursor} onPalette={() => void openQuick("commands")} onQuickOpen={() => void openQuick("files")} />
                    </div>
                    {!wb.active && <Watermark mod={mod} shift={shiftKey()} ctrl={ctrlKey()} />}
                  </>
                )}
              </div>
            </>
          )}

          {/* Panel */}
          {(panelOpen || panelMax) && !panelMax && <Sash orientation="horizontal" onDrag={(d) => setPanelHeight((h) => Math.min(640, Math.max(80, h - d)))} />}
          <div className={cn("flex shrink-0 flex-col", panelMax ? "min-h-0 flex-1" : "")} style={{ background: "var(--vsc-panel)", borderTop: "1px solid var(--vsc-border)", height: panelOpen ? (panelMax ? undefined : panelHeight) : 35 }}>
            <div className="flex h-[35px] shrink-0 items-stretch pl-2 pr-1.5">
              {panelTitle("problems", "Problems", wb.problems.length)}
              {hasBuild && panelTitle("output", "Output")}
              {panelTitle("terminal", "Terminal")}
              <div className="ml-auto flex items-center gap-0.5">
                {panelOpen && panelTab === "terminal" && (
                  <>
                    <PanelAction label="New Terminal" onClick={terminals.add}><Plus className="size-4" /></PanelAction>
                    <PanelAction label="Kill Terminal" disabled={terminals.current === null} onClick={() => terminals.current !== null && terminals.close(terminals.current)}><Trash2 className="size-4" /></PanelAction>
                  </>
                )}
                <PanelAction label={panelMax ? "Restore Panel Size" : "Maximize Panel Size"} onClick={() => (setPanelMax((m) => !m), setPanelOpen(true))}>{panelMax ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</PanelAction>
                <PanelAction label={panelOpen ? "Hide Panel" : "Show Panel"} onClick={() => (setPanelMax(false), setPanelOpen((o) => !o))}>{panelOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="-rotate-90 size-4" />}</PanelAction>
              </div>
            </div>
            <div className={cn("min-h-0 flex-1 border-t", !panelOpen && "hidden")} style={{ borderColor: "var(--vsc-border)" }}>
              <div className={cn("h-full select-text overflow-y-auto py-1", panelTab !== "problems" && "hidden")}>
                {wb.problems.length === 0 ? (
                  <p className="px-5 py-1 text-[13px]" style={{ color: "var(--vsc-muted)" }}>No problems have been detected in the workspace.</p>
                ) : (
                  Object.entries(wb.problems.reduce<Record<string, typeof wb.problems>>((m, p) => ((m[p.file] ??= []).push(p), m), {})).map(([file, list]) => (
                    <div key={file}>
                      <div className="flex h-[22px] items-center gap-1.5 px-2 text-[13px]">
                        <ChevronDown className="size-4" />
                        <FileGlyph name={baseOf(file)} />
                        <span>{baseOf(file)}</span>
                        <span style={{ color: "var(--vsc-muted)" }}>{file}</span>
                        <span className="rounded-full px-1.5 text-[11px]" style={{ background: "var(--vsc-badge)", color: "var(--vsc-badge-fg)" }}>{list.length}</span>
                      </div>
                      {list.map((p, i) => {
                        const Icon = PROBLEMS_ICON[p.severity];
                        return (
                          <div key={i} onClick={() => void go(p.file, p.line, p.column)} className="flex h-[22px] cursor-pointer items-center gap-1.5 pl-9 pr-3 text-[13px] hover:bg-[var(--vsc-list-hover)]">
                            <Icon className="size-4 shrink-0" style={{ color: p.severity === "error" ? "var(--vsc-error)" : "var(--vsc-warning)" }} />
                            <span className="min-w-0 truncate">{p.message}</span>
                            <span className="shrink-0" style={{ color: "var(--vsc-muted)" }}>ts [{p.line}, {p.column}]</span>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
              {hasBuild && (
                <div className={cn("h-full select-text overflow-y-auto px-5 py-2 font-mono text-[12px]", panelTab !== "output" && "hidden")}>
                  {wb.build.status === "idle" && <p style={{ color: "var(--vsc-muted)" }}>Nothing has been built yet. Build bundles src/ into dist/extension.js.</p>}
                  {wb.build.status === "building" && <p style={{ color: "var(--vsc-muted)" }}>Building…</p>}
                  {wb.build.status === "ok" && <p style={{ color: "var(--vsc-ok)" }}>Built dist/extension.js — {(wb.build.bytes / 1024).toFixed(1)} KB from {wb.build.files} file{wb.build.files === 1 ? "" : "s"}.</p>}
                  {wb.build.status === "failed" &&
                    wb.build.errors.map((e, i) => (
                      <p key={i} className="cursor-pointer py-0.5 hover:bg-[var(--vsc-list-hover)]" onClick={() => void go(e.file, e.line, e.column)}>
                        <span style={{ color: "var(--vsc-error)" }}>error</span> {e.text} {e.file && <span style={{ color: "var(--vsc-muted)" }}>({e.file}:{e.line}:{e.column})</span>}
                      </p>
                    ))}
                </div>
              )}
              <div className={cn("h-full", panelTab !== "terminal" && "hidden")}>
                <TerminalPanel terminals={terminals} folder={() => wb.ws!.folder()} visible={panelOpen && panelTab === "terminal"} onError={setPanelError} />
              </div>
              {panelError && <p role="alert" className="absolute inset-x-0 bottom-0 px-3 py-1 text-[12px]" style={{ background: "var(--vsc-widget)", color: "var(--vsc-error)" }}>{panelError}</p>}
            </div>
          </div>
        </div>
      </div>

      <UnsavedDialog name={wb.closeRequest ? baseOf(wb.closeRequest) : null} what="changes" onAnswer={(a) => wb.answerClose(a)} />

      {/* Status bar */}
      <footer className="flex h-[22px] shrink-0 items-center justify-between border-t px-1 text-[12px]" style={{ background: "var(--vsc-status-bar)", color: "var(--vsc-status-fg)", borderColor: "var(--vsc-border)" }}>
        <div className="flex items-center">
          <StatusItem title="No Problems" onClick={() => openPanel("problems")}>
            <CircleX className="size-3.5" /> {errors} <TriangleAlert className="ml-1 size-3.5" /> {warnings}
          </StatusItem>
          {wb.dirty.size > 0 && <StatusItem title={`Unsaved: ${[...wb.dirty].map(baseOf).join(", ")}. ${mod}S saves.`} onClick={() => void wb.saveAll()}>{wb.dirty.size} unsaved</StatusItem>}
        </div>
        <div className="flex items-center">
          {cursor && wb.active && !showSettings && (
            <>
              <StatusItem title="Go to Line/Column" onClick={action("editor.action.gotoLine")}>
                Ln {cursor.line}, Col {cursor.column}
                {cursor.selected > 0 ? ` (${cursor.selected} selected)` : ""}
              </StatusItem>
              <StatusItem title="Select Indentation">Spaces: {cursor.spaces}</StatusItem>
              <StatusItem title="Select Encoding">UTF-8</StatusItem>
              <StatusItem title="Select End of Line Sequence">{cursor.eol}</StatusItem>
              <StatusItem title="Select Language Mode">{cursor.language}</StatusItem>
            </>
          )}
          <StatusItem title="Notifications"><Bell className="size-3.5" /></StatusItem>
        </div>
      </footer>

      {quick && <QuickPick key={quick} items={quick === "files" ? fileItemsFull : commandItems} placeholder={quick === "files" ? "Search files by name" : "Type the name of a command to run."} onClose={() => { setQuick(null); editorRef.current?.focus(); }} />}
    </div>
    </PaletteProvider>
  );
}

function Tab({ active, label, title, glyph, dirty, conflict, muted, onSelect, onClose }: { active: boolean; label: string; title?: string; glyph: React.ReactNode; dirty?: boolean; conflict?: boolean; muted?: boolean; onSelect: () => void; onClose: () => void }) {
  return (
    <div
      role="tab"
      aria-selected={active}
      title={title}
      onClick={onSelect}
      onAuxClick={(e) => e.button === 1 && onClose()}
      className="group relative flex h-full min-w-[80px] max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 border-r pl-3 pr-1.5 text-[13px]"
      style={{
        background: active ? "var(--vsc-tab-active)" : "var(--vsc-tab-inactive)",
        color: active ? "var(--vsc-tab-active-fg)" : "var(--vsc-tab-inactive-fg)",
        borderColor: "var(--vsc-border)",
        borderBottom: active ? "1px solid var(--vsc-tab-active)" : "1px solid var(--vsc-border)",
        borderTop: `1px solid ${active ? "var(--vsc-accent)" : "transparent"}`,
        marginBottom: -1,
      }}
    >
      {glyph}
      <span className={cn("min-w-0 flex-1 truncate", muted && "line-through")}>{label}</span>
      {conflict && <TriangleAlert className="size-3.5 shrink-0" style={{ color: "var(--vsc-warning)" }} aria-label="Changed on disk" />}
      <button
        type="button"
        aria-label={`Close ${label}`}
        onClick={(e) => (e.stopPropagation(), onClose())}
        className={cn("flex size-5 shrink-0 items-center justify-center rounded hover:bg-[var(--vsc-list-hover)]", !active && !dirty && "opacity-0 group-hover:opacity-100", dirty && "[&>svg]:hidden group-hover:[&>svg]:block group-hover:[&>span]:hidden")}
      >
        {dirty && <span className="size-2.5 rounded-full" style={{ background: "currentColor" }} aria-label="Unsaved changes" />}
        <X className="size-4" />
      </button>
    </div>
  );
}

function VscButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="h-[22px] rounded-[2px] px-2.5 text-[12px] hover:opacity-90" style={{ background: "var(--vsc-accent)", color: "var(--vsc-accent-fg)" }}>
      {children}
    </button>
  );
}

function PanelAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className="flex size-[22px] items-center justify-center rounded hover:bg-[var(--vsc-list-hover)] disabled:opacity-40">
      {children}
    </button>
  );
}

function StatusItem({ children, title, onClick }: { children: React.ReactNode; title?: string; onClick?: () => void }) {
  return (
    <button type="button" title={title} onClick={onClick} disabled={!onClick} className="flex h-[22px] items-center gap-1 px-2 enabled:hover:bg-[var(--vsc-status-hover)]">
      {children}
    </button>
  );
}

/** What VS Code shows with nothing open: a faint mark and the commands worth knowing. */
function Watermark({ mod, shift, ctrl }: { mod: string; shift: string; ctrl: string }) {
  const rows: [string, string][] = [
    ["Show All Commands", `${shift}${mod}P`],
    ["Go to File", `${mod}P`],
    ["Find in Files", `${shift}${mod}F`],
    ["Toggle Terminal", `${ctrl}\``],
  ];
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6" style={{ color: "var(--vsc-muted)" }}>
      <Check className="hidden" />
      <div className="text-[64px] font-extralight leading-none opacity-20" aria-hidden>{"</>"}</div>
      <table className="text-[13px]">
        <tbody>
          {rows.map(([label, keys]) => (
            <tr key={label}>
              <td className="py-1 pr-8 text-right">{label}</td>
              <td><kbd className="rounded border px-1.5 py-0.5 text-[12px]" style={{ borderColor: "var(--vsc-widget-border)", background: "var(--vsc-widget)" }}>{keys}</kbd></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

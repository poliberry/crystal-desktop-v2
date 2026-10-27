import { loader } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";

import { withAlpha } from "@/lib/css-color";
import type { VscPalette } from "@/studio/code/vscode-theme";

/**
 * Monaco, set up for Crystal Studio's code projects.
 *
 *  - Loaded from the app's own files (`/monaco/vs`, copied there by `scripts/prepare-studio-assets.mjs`),
 *    never a CDN: it works offline, and what someone is writing is never fetched from or sent to anyone.
 *  - The TypeScript service is told what the real environment is. An extension's sandbox has no
 *    `window` or `document`, so those aren't in its libraries and the editor says so; a bot is
 *    Node, with Node's types.
 *  - Files are models at `file:///<project path>`, so imports between a project's own files resolve
 *    the same way they will when it is bundled.
 */

export type MonacoApi = typeof Monaco;
export type CodeKind = "extension" | "bot";

let ready: Promise<MonacoApi> | null = null;

export function loadMonaco(): Promise<MonacoApi> {
  if (!ready) {
    // Absolute, not "/monaco/vs": Monaco starts its language services in Web Workers, and inside a
    // worker a root-relative URL can't be parsed — the TypeScript service silently never starts, and
    // an editor with no type checking looks exactly like one whose code has no errors.
    loader.config({ paths: { vs: `${location.origin}/monaco/vs` } });
    ready = (loader.init() as Promise<MonacoApi>).catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export const uriFor = (monaco: MonacoApi, path: string) => monaco.Uri.parse(`file:///${path}`);
export const pathOf = (uri: Monaco.Uri) => uri.path.replace(/^\//, "");

export function languageFor(path: string): string {
  if (/\.(ts|mts|cts)$/.test(path)) return "typescript";
  if (/\.(js|mjs|cjs)$/.test(path)) return "javascript";
  if (/\.json$/.test(path)) return "json";
  if (/\.md$/.test(path)) return "markdown";
  if (/\.sh$/.test(path)) return "shell";
  return "plaintext";
}

/** Files the TypeScript service needs to see to check the project, whether or not a tab is open on them. */
export const isCodeFile = (path: string) => /\.(ts|mts|cts)$/.test(path);

/**
 * Monaco in the app's theme. The editor's colours come from the workbench palette (itself derived
 * from the selected theme); the syntax colours are VS Code's own light or dark set, chosen by
 * whether the theme is dark, because they are tuned to read on a light or a dark background and
 * a theme's UI colours aren't a syntax palette. (Monaco's tokenizer can't tell a function from a
 * variable the way VS Code's semantic highlighting does, so identifiers take the variable colour.)
 */
export function applyVscodeTheme(monaco: MonacoApi, p: VscPalette): void {
  const dark = p.dark;
  const rules = dark
    ? [
        ["comment", "6A9955"], ["string", "CE9178"], ["string.escape", "D7BA7D"], ["number", "B5CEA8"], ["regexp", "D16969"], ["keyword", "569CD6"], ["keyword.control", "C586C0"],
        ["type", "4EC9B0"], ["type.identifier", "4EC9B0"], ["identifier", "9CDCFE"], ["delimiter", "CCCCCC"], ["tag", "569CD6"], ["attribute.name", "9CDCFE"], ["attribute.value", "CE9178"], ["key", "9CDCFE"],
      ]
    : [
        ["comment", "008000"], ["string", "A31515"], ["string.escape", "EE0000"], ["number", "098658"], ["regexp", "811F3F"], ["keyword", "0000FF"], ["keyword.control", "AF00DB"],
        ["type", "267F99"], ["type.identifier", "267F99"], ["identifier", "001080"], ["delimiter", "3B3B3B"], ["tag", "800000"], ["attribute.name", "E50000"], ["attribute.value", "0451A5"], ["key", "0451A5"],
      ];
  monaco.editor.defineTheme("crystal-app", {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: rules.map(([token, foreground]) => ({ token, foreground })),
    colors: {
      "editor.background": p.editor,
      "editor.foreground": p.editorFg,
      "editor.lineHighlightBackground": withAlpha(p.editorFg, 0.05),
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": p.selection,
      "editor.inactiveSelectionBackground": withAlpha(p.editorFg, 0.1),
      "editor.wordHighlightBackground": withAlpha(p.editorFg, 0.12),
      "editor.findMatchBackground": p.findMatch,
      "editor.findMatchHighlightBackground": withAlpha(p.findMatch.slice(0, 7), 0.25),
      "editorCursor.foreground": p.editorFg,
      "editorLineNumber.foreground": p.muted,
      "editorLineNumber.activeForeground": p.editorFg,
      "editorIndentGuide.background1": withAlpha(p.editorFg, 0.12),
      "editorIndentGuide.activeBackground1": withAlpha(p.editorFg, 0.3),
      "editorBracketMatch.background": withAlpha(p.accent, 0.2),
      "editorBracketMatch.border": withAlpha(p.accent, 0.6),
      "editorWidget.background": p.widget,
      "editorWidget.border": p.widgetBorder,
      "editorSuggestWidget.background": p.widget,
      "editorSuggestWidget.border": p.widgetBorder,
      "editorSuggestWidget.selectedBackground": p.listActive,
      "editorHoverWidget.background": p.widget,
      "editorHoverWidget.border": p.widgetBorder,
      "editorStickyScroll.background": p.editor,
      "editorGutter.background": p.editor,
      "editorError.foreground": p.error,
      "editorWarning.foreground": p.warning,
      "editorInfo.foreground": p.info,
      "input.background": p.input,
      "input.border": p.inputBorder,
      "list.hoverBackground": p.listHover,
      "list.activeSelectionBackground": p.listActive,
      "list.focusBackground": p.listActive,
      "minimap.background": p.editor,
      "scrollbarSlider.background": p.scrollbar,
      "scrollbarSlider.hoverBackground": p.scrollbarHover,
      "scrollbarSlider.activeBackground": p.scrollbarHover,
      "focusBorder": p.accent,
    },
  });
  monaco.editor.setTheme("crystal-app");
}

/** Point the TypeScript service at the environment a project really runs in. Global, so set when a project opens. */
export function configureTypeScript(monaco: MonacoApi, kind: CodeKind): void {
  const ts = monaco.languages.typescript;
  const options: Monaco.languages.typescript.CompilerOptions = {
    target: kind === "bot" ? ts.ScriptTarget.ESNext : ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    // No DOM library, on purpose: see the header. A bot gets Node's globals from its types instead.
    lib: ["es2022"],
    strict: true,
    noEmit: true,
    allowNonTsExtensions: true,
    esModuleInterop: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    // `import … from "@crystal/extension"` resolves to the SDK copied into the project, the same
    // mapping the project's own tsconfig has.
    baseUrl: "file:///",
    paths: { [kind === "bot" ? "@crystal/bot" : "@crystal/extension"]: [`.crystal/sdk/${kind}/index.ts`] },
  };
  for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
    defaults.setCompilerOptions(options);
    defaults.setEagerModelSync(true);
    defaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
    defaults.setExtraLibs([]);
  }
}

export interface Problem {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning";
}

const flatten = (m: string | Monaco.languages.typescript.DiagnosticMessageChain): string => (typeof m === "string" ? m : [m.messageText, ...(m.next ?? []).map(flatten)].join(" "));

/**
 * What the TypeScript service says is wrong with these files — asked of the service itself, rather
 * than read from the editor's markers, so the answer is complete and current when a build or a
 * publish depends on it.
 */
export async function diagnose(monaco: MonacoApi, paths: string[]): Promise<Problem[]> {
  const getWorker = await monaco.languages.typescript.getTypeScriptWorker();
  const out: Problem[] = [];
  for (const path of paths) {
    const uri = uriFor(monaco, path);
    const model = monaco.editor.getModel(uri);
    if (!model) continue;
    const worker = await getWorker(uri);
    const name = uri.toString();
    const [syntax, semantic] = await Promise.all([worker.getSyntacticDiagnostics(name), worker.getSemanticDiagnostics(name)]);
    for (const d of [...syntax, ...semantic]) {
      const pos = model.getPositionAt(d.start ?? 0);
      out.push({ file: path, line: pos.lineNumber, column: pos.column, message: flatten(d.messageText), severity: d.category === 1 ? "error" : "warning" });
    }
  }
  return out;
}

/** Replace what is in a model without throwing away the undo history, as an external edit shouldn't. */
export function replaceModelText(monaco: MonacoApi, model: Monaco.editor.ITextModel, text: string): void {
  if (model.getValue() === text) return;
  model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
  model.pushStackElement();
  void monaco;
}

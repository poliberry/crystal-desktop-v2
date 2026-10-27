import type { GitCode, GitFileChange } from "../../../electron/gitTypes";

/** How a changed file is marked: the letter VS Code shows, its colour (workbench palette variables), and words for a tooltip. */
export interface Decoration {
  letter: string;
  color: string;
  title: string;
}

const WORDS: Record<GitCode, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  T: "Type changed",
  U: "Conflict",
  "?": "Untracked",
};

const COLOR: Record<GitCode, string> = {
  M: "var(--vsc-warning)",
  A: "var(--vsc-ok)",
  D: "var(--vsc-error)",
  R: "var(--vsc-ok)",
  C: "var(--vsc-ok)",
  T: "var(--vsc-warning)",
  U: "var(--vsc-error)",
  "?": "var(--vsc-ok)",
};

/** `?` is shown as `U` ("untracked"), as VS Code does. */
const LETTER = (c: GitCode): string => (c === "?" ? "U" : c === "U" ? "!" : c);

/** The mark for one side of a change. */
export const decorate = (code: GitCode): Decoration => ({ letter: LETTER(code), color: COLOR[code], title: WORDS[code] });

/** The mark for a file as a whole: its working-folder state if it has one, otherwise its staged one. */
export function decorationFor(change: GitFileChange): Decoration {
  if (change.conflicted) return decorate("U");
  return decorate((change.unstaged ?? change.staged ?? "M") as GitCode);
}

/** Every folder that has a changed file somewhere inside it, so the Explorer can mark them too. */
export function foldersWithChanges(changes: GitFileChange[]): Set<string> {
  const out = new Set<string>();
  for (const c of changes) {
    const parts = c.path.split("/").slice(0, -1);
    parts.forEach((_, i) => out.add(parts.slice(0, i + 1).join("/")));
  }
  return out;
}

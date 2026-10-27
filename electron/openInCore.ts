import * as path from "node:path";

import { findOnPath } from "./shellEnv";
import type { OpenInKind, OpenInTarget } from "./gitTypes";

/**
 * "Open in…": which programs on this computer can take a project folder, and exactly how each is
 * started.
 *
 * The page never names a program or a command. It is given a list of ids found here, and later
 * sends one id back; what that id runs is decided in this file, from a fixed table, with the folder
 * as the only variable part (a path Studio itself resolved, never text from the page). Arguments go
 * to the program as a list, never through a shell.
 *
 * Detection is by looking for the program, not by launching it: an application bundle in the usual
 * folders on a Mac, a known install path on Windows, a command on PATH elsewhere.
 */

interface Spec {
  id: string;
  label: string;
  kind: OpenInKind;
  /** macOS application bundles, e.g. `Visual Studio Code.app`. */
  mac?: string[];
  /** macOS bundles matched by pattern, for programs with channel suffixes (`T3 Code (Nightly).app`). */
  macPattern?: RegExp;
  /** Windows install locations, relative to LOCALAPPDATA or Program Files. */
  win?: string[];
  /** Command names that start it with a folder (macOS fallback, Linux, and agents). */
  cli?: string[];
  /** For command-line agents: what to type into a terminal. */
  terminal?: string;
  /** Opening it doesn't open the folder; the person is told what to do next. */
  copiesPath?: boolean;
}

export const SPECS: Spec[] = [
  { id: "vscode", label: "Visual Studio Code", kind: "editor", mac: ["Visual Studio Code.app"], win: ["Microsoft VS Code\\Code.exe"], cli: ["code"] },
  { id: "vscode-insiders", label: "VS Code Insiders", kind: "editor", mac: ["Visual Studio Code - Insiders.app"], win: ["Microsoft VS Code Insiders\\Code - Insiders.exe"], cli: ["code-insiders"] },
  { id: "cursor", label: "Cursor", kind: "editor", mac: ["Cursor.app"], win: ["cursor\\Cursor.exe"], cli: ["cursor"] },
  { id: "windsurf", label: "Windsurf", kind: "editor", mac: ["Windsurf.app"], win: ["Windsurf\\Windsurf.exe"], cli: ["windsurf"] },
  { id: "antigravity", label: "Antigravity", kind: "editor", mac: ["Antigravity.app"], win: ["Antigravity\\Antigravity.exe"], cli: ["antigravity"] },
  { id: "kiro", label: "Kiro", kind: "editor", mac: ["Kiro.app"], win: ["Kiro\\Kiro.exe"], cli: ["kiro"] },
  { id: "trae", label: "Trae", kind: "editor", mac: ["Trae.app"], win: ["Trae\\Trae.exe"], cli: ["trae"] },
  { id: "zed", label: "Zed", kind: "editor", mac: ["Zed.app"], win: ["Zed\\Zed.exe"], cli: ["zed"] },
  { id: "zed-preview", label: "Zed Preview", kind: "editor", mac: ["Zed Preview.app"] },
  { id: "sublime", label: "Sublime Text", kind: "editor", mac: ["Sublime Text.app"], cli: ["subl"] },
  { id: "webstorm", label: "WebStorm", kind: "editor", mac: ["WebStorm.app"] },
  { id: "intellij", label: "IntelliJ IDEA", kind: "editor", mac: ["IntelliJ IDEA.app", "IntelliJ IDEA CE.app"] },
  { id: "t3code", label: "T3 Code", kind: "app", macPattern: /^T3 Code(?: \([^)]+\))?\.app$/, copiesPath: true },
  { id: "codex-app", label: "Codex app", kind: "app", mac: ["Codex.app"] },
  { id: "claude", label: "Claude Code", kind: "agent", cli: ["claude"], terminal: "claude" },
  { id: "codex", label: "Codex CLI", kind: "agent", cli: ["codex"], terminal: "codex" },
  { id: "opencode", label: "OpenCode", kind: "agent", cli: ["opencode"], terminal: "opencode" },
  { id: "gemini", label: "Gemini CLI", kind: "agent", cli: ["gemini"], terminal: "gemini" },
];

/** How to start one of them. Never leaves this process. */
export type Launch =
  | { how: "open-app"; app: string; copiesPath?: boolean }
  | { how: "exec"; file: string }
  /** `codex app <folder>`: the desktop app, started through the command that knows how. */
  | { how: "exec-app"; file: string }
  | { how: "terminal" };

export interface Detected extends OpenInTarget {
  launch: Launch;
}

export interface Probe {
  platform: NodeJS.Platform;
  home: string;
  /** The PATH to look for commands on. */
  pathVar: string;
  exists(p: string): boolean;
  /** Names in a folder, or [] if it isn't there. */
  list(dir: string): string[];
  env: { LOCALAPPDATA?: string; ProgramFiles?: string; "ProgramFiles(x86)"?: string };
}

const MAC_APP_DIRS = (home: string) => ["/Applications", path.posix.join(home, "Applications"), "/System/Applications"];

export function detectTargets(p: Probe): Detected[] {
  const out: Detected[] = [];
  const cliOf = (spec: Spec) => {
    for (const name of spec.cli ?? []) {
      const found = findOnPath(name, p.pathVar, { platform: p.platform, exists: p.exists });
      if (found) return found;
    }
    return null;
  };
  const target = (spec: Spec, label: string, launch: Launch): Detected => ({
    id: spec.id,
    label,
    kind: spec.kind,
    via: launch.how === "terminal" ? "terminal" : "app",
    ...(spec.terminal ? { command: spec.terminal } : {}),
    launch,
  });

  for (const spec of SPECS) {
    if (spec.kind === "agent") {
      if (cliOf(spec)) out.push(target(spec, spec.label, { how: "terminal" }));
      continue;
    }

    if (p.platform === "darwin") {
      const dirs = MAC_APP_DIRS(p.home);

      // Apps that ship in channels (T3 Code, T3 Code (Nightly)…): each one installed is its own entry.
      if (spec.macPattern) {
        const found = dirs.flatMap((dir) => p.list(dir).filter((n) => spec.macPattern!.test(n)).map((n) => ({ dir, n })));
        for (const { dir, n } of found) {
          const label = n.replace(/\.app$/, "");
          const entry = target(spec, label, { how: "open-app", app: path.posix.join(dir, n), copiesPath: spec.copiesPath });
          out.push(found.length > 1 ? { ...entry, id: `${spec.id}:${label}` } : entry);
        }
        continue;
      }

      const app = dirs.flatMap((dir) => (spec.mac ?? []).map((n) => path.posix.join(dir, n))).find((candidate) => p.exists(candidate));
      if (!app) continue;
      // The Codex desktop app is opened on a folder by `codex app <folder>`, which also knows where it lives.
      const codex = spec.id === "codex-app" ? findOnPath("codex", p.pathVar, { platform: p.platform, exists: p.exists }) : null;
      out.push(target(spec, spec.label, codex ? { how: "exec-app", file: codex } : { how: "open-app", app }));
      continue;
    }

    if (p.platform === "win32") {
      const roots = [p.env.LOCALAPPDATA && path.win32.join(p.env.LOCALAPPDATA, "Programs"), p.env.ProgramFiles, p.env["ProgramFiles(x86)"]].filter((r): r is string => !!r);
      let exe: string | null = null;
      for (const rel of spec.win ?? []) {
        for (const root of roots) {
          const candidate = path.win32.join(root, rel);
          if (p.exists(candidate)) exe = exe ?? candidate;
        }
      }
      if (exe) out.push(target(spec, spec.label, { how: "exec", file: exe }));
      continue;
    }

    // Linux and anything else: a command on PATH that opens a folder.
    const cli = spec.id === "t3code" || spec.id === "codex-app" ? null : cliOf(spec);
    if (cli) out.push(target(spec, spec.label, { how: "exec", file: cli }));
  }
  return out;
}

/** What to run for a detected target and a project folder (an absolute path Studio resolved). */
export function launchPlan(d: Detected, folder: string, platform: NodeJS.Platform): { file: string; args: string[] } {
  if (!path.isAbsolute(folder) && !(platform === "win32" && path.win32.isAbsolute(folder))) throw new Error("The project folder must be an absolute path.");
  switch (d.launch.how) {
    case "open-app":
      return { file: "/usr/bin/open", args: ["-a", d.launch.app, folder] };
    case "exec":
      return { file: d.launch.file, args: [folder] };
    case "exec-app":
      return { file: d.launch.file, args: ["app", folder] };
    case "terminal":
      throw new Error(`${d.label} runs in a terminal.`);
  }
}

/** The ids the page can use, in the order they're shown. */
export const publicTargets = (list: Detected[]): OpenInTarget[] => list.map(({ launch: _launch, ...t }) => t);

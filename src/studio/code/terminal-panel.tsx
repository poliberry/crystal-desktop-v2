"use client";

import "@xterm/xterm/css/xterm.css";

import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { getDesktopAPI } from "@/lib/desktop";
import { usePalette, type VscPalette } from "@/studio/code/vscode-theme";
import { cn } from "@/lib/utils";

export interface TerminalSession {
  key: number;
  title: string;
  exited: boolean;
}

/** The terminals open in a workbench. State lives above the panel so VS Code's title-bar buttons (+, trash) can act on it. */
export function useTerminals() {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const counter = useRef(0);
  const add = useCallback(() => {
    const key = ++counter.current;
    setSessions((s) => [...s, { key, title: process_name(), exited: false }]);
    setCurrent(key);
  }, []);
  const close = useCallback((key: number) => {
    setSessions((s) => {
      const next = s.filter((x) => x.key !== key);
      setCurrent((cur) => (cur === key ? (next[next.length - 1]?.key ?? null) : cur));
      return next;
    });
  }, []);
  const markExited = useCallback((key: number) => setSessions((all) => all.map((x) => (x.key === key ? { ...x, exited: true } : x))), []);
  return { sessions, current, setCurrent, add, close, markExited };
}
export type Terminals = ReturnType<typeof useTerminals>;

/** What VS Code calls a terminal running the default shell. */
function process_name() {
  return typeof navigator !== "undefined" && /win/i.test(navigator.platform) ? "powershell" : "zsh";
}

/** The terminal in the app's theme: its background and text from the palette, ANSI colours from VS Code's light or dark set. */
function terminalTheme(p: VscPalette) {
  const ansi = p.dark
    ? { black: "#000000", red: "#cd3131", green: "#0dbc79", yellow: "#e5e510", blue: "#2472c8", magenta: "#bc3fbc", cyan: "#11a8cd", white: "#e5e5e5", brightBlack: "#666666", brightRed: "#f14c4c", brightGreen: "#23d18b", brightYellow: "#f5f543", brightBlue: "#3b8eea", brightMagenta: "#d670d6", brightCyan: "#29b8db", brightWhite: "#e5e5e5" }
    : { black: "#000000", red: "#cd3131", green: "#107c10", yellow: "#949800", blue: "#0451a5", magenta: "#bc05bc", cyan: "#0598bc", white: "#555555", brightBlack: "#666666", brightRed: "#cd3131", brightGreen: "#14ce14", brightYellow: "#b5ba00", brightBlue: "#0451a5", brightMagenta: "#bc05bc", brightCyan: "#0598bc", brightWhite: "#a5a5a5" };
  return { background: p.terminalBg, foreground: p.terminalFg, cursor: p.terminalFg, selectionBackground: p.selection, ...ansi };
}

/**
 * One shell. The terminal is xterm.js; the shell behind it is a real PTY in the main process,
 * started in the project's folder (`electron/studioTerminal.ts` says what it is and isn't allowed
 * to do). It exists only because the person asked for a terminal, and ends when it is closed.
 */
function TerminalView({ folder, active, onExit, onError }: { folder: () => Promise<string>; active: boolean; onExit: () => void; onError: (m: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const fitRef = useRef<{ fit(): void } | null>(null);
  const termRef = useRef<{ options: { theme?: unknown } } | null>(null);
  const palette = usePalette();
  const paletteRef = useRef(palette);
  paletteRef.current = palette;

  useEffect(() => {
    const api = getDesktopAPI()?.studio?.terminal;
    const el = host.current;
    if (!api || !el) return;
    let disposed = false;
    let id: string | null = null;
    const cleanups: (() => void)[] = [];
    const early: { id: string; data: string }[] = [];

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed) return;
      const mac = /mac/i.test(navigator.platform);
      const term = new Terminal({
        fontFamily: mac ? "Menlo, Monaco, 'Courier New', monospace" : "Consolas, 'Courier New', monospace",
        fontSize: mac ? 12 : 14,
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 5000,
        theme: terminalTheme(paletteRef.current),
      });
      termRef.current = term;
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(el);
      const doFit = () => {
        // Hidden tabs have no size; fitting them would shrink the shell to nothing.
        if (el.offsetWidth > 0 && el.offsetHeight > 0) {
          fit.fit();
          if (id) void api.resize(id, term.cols, term.rows);
        }
      };
      fitRef.current = { fit: doFit };
      doFit();
      cleanups.push(() => term.dispose());
      cleanups.push(api.onData((did, data) => (id === null ? early.push({ id: did, data }) : did === id && term.write(data))));
      cleanups.push(
        api.onExit((did) => {
          if (did !== id) return;
          term.write("\r\n\x1b[2m[Process exited. Close this terminal to dismiss it.]\x1b[0m\r\n");
          onExit();
        }),
      );
      const input = term.onData((d) => id && void api.write(id, d));
      cleanups.push(() => input.dispose());
      const ro = new ResizeObserver(doFit);
      ro.observe(el);
      cleanups.push(() => ro.disconnect());
      try {
        const opened = await api.open(await folder(), term.cols, term.rows);
        if (disposed) return void api.kill(opened);
        id = opened;
        for (const e of early.splice(0)) if (e.id === id) term.write(e.data);
        term.focus();
      } catch (e) {
        onError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "") : "The terminal couldn't start.");
      }
    })();

    return () => {
      disposed = true;
      if (id) void api.kill(id);
      cleanups.forEach((c) => c());
    };
    // One shell per mount; what changes afterwards is read through refs or is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The theme changing restyles shells that are already open.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = terminalTheme(palette);
  }, [palette]);

  useEffect(() => {
    if (active) requestAnimationFrame(() => fitRef.current?.fit());
  }, [active]);

  return <div ref={host} className={cn("absolute inset-0 py-1 pl-5 pr-1", !active && "hidden")} style={{ background: "var(--vsc-terminal-bg)" }} />;
}

/** The terminal area: the active shell, and — as in VS Code once there is more than one — a list of them down the right. */
export function TerminalPanel({ terminals, folder, visible, onError }: { terminals: Terminals; folder: () => Promise<string>; visible: boolean; onError: (m: string) => void }) {
  const { sessions, current } = terminals;
  const hasTerminal = !!getDesktopAPI()?.studio?.terminal;
  if (!hasTerminal) return <p className="p-4 text-[13px]" style={{ color: "var(--vsc-muted)" }}>The terminal is part of the Crystal desktop app.</p>;
  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-w-0 flex-1" style={{ background: "var(--vsc-terminal-bg)" }}>
        {sessions.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-[13px]" style={{ color: "var(--vsc-muted)" }}>
            No terminal is open. Use the + above to open one in this project&apos;s folder.
          </div>
        ) : (
          sessions.map((s) => <TerminalView key={s.key} folder={folder} active={visible && s.key === current} onExit={() => terminals.markExited(s.key)} onError={onError} />)
        )}
      </div>
      {sessions.length > 1 && (
        <div className="w-[120px] shrink-0 border-l py-1" style={{ borderColor: "var(--vsc-border)", background: "var(--vsc-panel)" }}>
          {sessions.map((s) => (
            <div
              key={s.key}
              onClick={() => terminals.setCurrent(s.key)}
              className="group flex h-[22px] cursor-pointer items-center gap-1.5 px-2 text-[13px]"
              style={s.key === current ? { background: "var(--vsc-list-inactive)", color: "var(--vsc-editor-fg)" } : { color: "var(--vsc-muted)" }}
            >
              <span className={cn("min-w-0 flex-1 truncate", s.exited && "line-through opacity-60")}>{s.title}</span>
              <button type="button" aria-label={`Kill ${s.title}`} onClick={(e) => (e.stopPropagation(), terminals.close(s.key))} className="opacity-0 group-hover:opacity-100">
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

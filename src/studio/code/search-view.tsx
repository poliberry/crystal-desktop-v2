"use client";

import { CaseSensitive, ChevronDown, ChevronRight, Regex, WholeWord } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CodeWorkbench } from "@/studio/code/use-code-workbench";
import { FileGlyph } from "@/studio/code/vscode-ui";
import { baseOf, parentOf } from "@/studio/storage/workspace";
import { cn } from "@/lib/utils";

interface Match {
  line: number;
  column: number;
  length: number;
  text: string;
}
interface FileResult {
  path: string;
  matches: Match[];
}

const MAX_RESULTS = 2000;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Search across the project's files, as VS Code's Search view: a query box with match-case,
 * whole-word and regex toggles, a count, and results grouped by file that open at the line.
 * Open files are searched as they are in the editor, not as last saved.
 */
export function SearchView({ wb, onOpen }: { wb: CodeWorkbench; onOpen: (path: string, line: number, column: number) => void }) {
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [word, setWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [results, setResults] = useState<FileResult[] | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);

  const re = useMemo(() => {
    if (!query) return null;
    try {
      const body = regex ? query : escapeRe(query);
      return new RegExp(word ? `\\b(?:${body})\\b` : body, matchCase ? "g" : "gi");
    } catch {
      return null;
    }
  }, [query, matchCase, word, regex]);

  useEffect(() => {
    if (!query) {
      setResults(null);
      setError(null);
      return;
    }
    if (!re) {
      setError("This regular expression isn't valid.");
      setResults(null);
      return;
    }
    setError(null);
    let cancelled = false;
    const t = setTimeout(async () => {
      const out: FileResult[] = [];
      let total = 0;
      for (const path of await wb.allFiles()) {
        if (cancelled) return;
        const model = wb.modelFor(path);
        let text: string;
        try {
          text = model ? model.getValue() : (await wb.ws?.read(path)) ?? "";
        } catch {
          continue;
        }
        if (text.includes("\u0000")) continue; // a binary file
        const found: Match[] = [];
        text.split("\n").forEach((line, i) => {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(line)) && total < MAX_RESULTS) {
            if (m[0].length === 0) {
              re.lastIndex++;
              continue;
            }
            found.push({ line: i + 1, column: m.index + 1, length: m[0].length, text: line });
            total++;
          }
        });
        if (found.length) out.push({ path, matches: found });
        if (total >= MAX_RESULTS) break;
      }
      if (!cancelled) {
        setResults(out);
        setTruncated(total >= MAX_RESULTS);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [re, query, wb]);

  const total = results?.reduce((n, r) => n + r.matches.length, 0) ?? 0;
  const toggle = (on: boolean, set: (v: boolean) => void, label: string, Icon: typeof Regex) => (
    <button type="button" title={label} aria-label={label} aria-pressed={on} onClick={() => set(!on)} className={cn("flex size-[20px] items-center justify-center rounded-[3px] border", on ? "border-[var(--vsc-accent)] bg-[var(--vsc-accent)]/30" : "border-transparent hover:bg-[var(--vsc-list-hover)]")}>
      <Icon className="size-3.5" />
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[35px] shrink-0 items-center pl-5 text-[11px] uppercase" style={{ color: "var(--vsc-sidebar-title-fg)" }}>Search</div>
      <div className="shrink-0 px-3 pb-2">
        <div className="flex h-[26px] items-center border pr-1 focus-within:border-[var(--vsc-accent)]" style={{ background: "var(--vsc-input)", borderColor: "var(--vsc-input-border)" }}>
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" spellCheck={false} aria-label="Search" className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-[13px] outline-none placeholder:opacity-60" style={{ color: "var(--vsc-input-fg)" }} />
          {toggle(matchCase, setMatchCase, "Match Case", CaseSensitive)}
          {toggle(word, setWord, "Match Whole Word", WholeWord)}
          {toggle(regex, setRegex, "Use Regular Expression", Regex)}
        </div>
        {error && <p className="mt-1 text-[12px]" style={{ color: "var(--vsc-error)" }}>{error}</p>}
        {results && !error && (
          <p className="mt-1.5 text-[12px]" style={{ color: "var(--vsc-muted)" }}>
            {total === 0 ? "No results found." : `${total}${truncated ? "+" : ""} result${total === 1 ? "" : "s"} in ${results.length} file${results.length === 1 ? "" : "s"}`}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto text-[13px]">
        {results?.map((r) => {
          const open = !collapsed.has(r.path);
          return (
            <div key={r.path}>
              <div
                className="flex h-[22px] cursor-pointer items-center gap-1 pl-1 pr-2 hover:bg-[var(--vsc-list-hover)]"
                onClick={() => setCollapsed((prev) => { const n = new Set(prev); open ? n.add(r.path) : n.delete(r.path); return n; })}
              >
                {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                <FileGlyph name={baseOf(r.path)} />
                <span className="truncate">{baseOf(r.path)}</span>
                <span className="truncate text-[12px]" style={{ color: "var(--vsc-muted)" }}>{parentOf(r.path)}</span>
                <span className="ml-auto shrink-0 rounded-full px-1.5 text-[11px]" style={{ background: "var(--vsc-badge)", color: "var(--vsc-badge-fg)" }}>{r.matches.length}</span>
              </div>
              {open &&
                r.matches.map((m, i) => {
                  const start = Math.max(0, m.column - 1 - 12);
                  const before = (start > 0 ? "…" : "") + m.text.slice(start, m.column - 1).trimStart();
                  return (
                    <div key={i} className="flex h-[22px] cursor-pointer items-center whitespace-pre pl-[34px] pr-2 hover:bg-[var(--vsc-list-hover)]" onClick={() => onOpen(r.path, m.line, m.column)}>
                      <span className="truncate">
                        {before}
                        <span className="rounded-[2px]" style={{ background: "#ea5c0055" }}>{m.text.slice(m.column - 1, m.column - 1 + m.length)}</span>
                        {m.text.slice(m.column - 1 + m.length, m.column - 1 + m.length + 80)}
                      </span>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

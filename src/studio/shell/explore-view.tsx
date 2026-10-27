"use client";

import { AlertTriangle, Lightbulb, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { TOPICS, type Block } from "@/studio/explore/content";
import { buildEntries, groupsOf, searchEntries } from "@/studio/explore/entries";
import { expand } from "@/studio/docs/facts";
import { Markdown } from "@/studio/docs/markdown";
import { useGuidePages } from "@/studio/docs/use-guides";
import { keyLabel } from "@/studio/editor/keys";
import { TOOLS } from "@/studio/editor/tools";
import { KIND_LABEL, type DocKind } from "@/studio/model/types";
import { cn } from "@/lib/utils";

function Kbd({ combo }: { combo: string }) {
  return <kbd className="rounded-[3px] border border-[var(--ai-edge)] bg-[var(--ai-field)] px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-[var(--ai-text)]">{keyLabel(combo)}</kbd>;
}

function Blocks({ blocks, onTry }: { blocks: Block[]; onTry: (kind: DocKind) => void }) {
  return (
    <div className="space-y-3 text-[13px] leading-relaxed">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "p":
            return <p key={i}>{b.text}</p>;
          case "h":
            return (
              <h3 key={i} className="pt-2 text-[13px] font-semibold text-foreground">
                {b.text}
              </h3>
            );
          case "steps":
            return (
              <ol key={i} className="list-decimal space-y-1.5 pl-5 marker:text-[var(--ai-dim)]">
                {b.items.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            );
          case "list":
            return (
              <ul key={i} className="list-disc space-y-1.5 pl-5 marker:text-[var(--ai-dim)]">
                {b.items.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            );
          case "tip":
          case "warn": {
            const warn = b.t === "warn";
            const Icon = warn ? AlertTriangle : Lightbulb;
            return (
              <div key={i} className={cn("flex gap-2 rounded-[3px] border px-3 py-2 text-[12px]", warn ? "border-amber-500/40 bg-amber-500/10" : "border-[var(--ai-edge)] bg-[var(--ai-field)]")}>
                <Icon className={cn("mt-0.5 size-3.5 shrink-0", warn ? "text-amber-400" : "text-[var(--ai-dim)]")} />
                <p>{b.text}</p>
              </div>
            );
          }
          case "keys":
            return (
              <table key={i} className="w-full border-collapse text-[12px]">
                <tbody>
                  {b.rows.map(([label, combo]) => (
                    <tr key={label} className="border-b border-[var(--ai-line)]">
                      <td className="py-1.5 pr-4">{label}</td>
                      <td className="py-1.5 text-right">
                        <Kbd combo={combo} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          case "tools":
            return (
              <ul key={i} className="divide-y divide-[var(--ai-line)] border-y border-[var(--ai-line)]">
                {TOOLS.map((t) => {
                  const Icon = t.icon;
                  return (
                    <li key={t.id} className="flex gap-3 py-2.5">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-[3px] bg-[var(--ai-field)]">
                        <Icon className="size-4" strokeWidth={1.5} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 font-medium text-foreground">
                          {t.label}
                          {t.key && <Kbd combo={t.key.toLowerCase()} />}
                          {t.kinds && <span className="text-[11px] font-normal text-[var(--ai-dim)]">{t.kinds.includes("scene") ? "scenes only" : "decorations and stickers"}</span>}
                        </p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-[var(--ai-text)] marker:text-[var(--ai-dim)]">
                          {t.how.map((h) => (
                            <li key={h}>{h}</li>
                          ))}
                        </ul>
                      </div>
                    </li>
                  );
                })}
              </ul>
            );
          case "try":
            return (
              <button key={i} type="button" onClick={() => onTry(b.kind)} className="ai-button !h-7 !px-3 text-[12px]">
                {b.label}
              </button>
            );
        }
      })}
    </div>
  );
}

/**
 * Explore: guides to the canvas editor, the code editor and the extension and bot SDKs. A searchable
 * list of topics, and the one chosen. The canvas editor's tool and shortcut tables are drawn from the
 * same data the editors use, so they can't be out of date; "try it" buttons make a project of the right
 * kind to practise in. The SDK guides are written pages (Markdown, in `src/studio/docs/content`) whose
 * tables of permissions, routes and limits are read from the code that enforces them, and staff can edit
 * or add pages in the Admin Console without a release.
 */
export function ExploreView({ topic, onTopic, onNew }: { topic: string; onTopic: (id: string) => void; onNew: (kind: DocKind, name: string) => void }) {
  const [query, setQuery] = useState("");
  const pages = useGuidePages();
  const entries = useMemo(() => buildEntries(TOPICS, pages), [pages]);
  const found = useMemo(() => searchEntries(entries, query), [entries, query]);
  const current = found.find((t) => t.id === topic) ?? found[0] ?? entries[0];
  const groups = groupsOf(entries);
  const mainRef = useRef<HTMLElement>(null);
  const currentId = current?.id;
  // A different page starts at its top.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [currentId]);

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-64 shrink-0 flex-col ai-edge-r bg-[var(--ai-body)]">
        <div className="p-2">
          <label className="ai-field gap-1.5">
            <Search className="size-3 shrink-0 text-[var(--ai-dim)]" strokeWidth={1.5} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the guides" spellCheck={false} aria-label="Search the guides" />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="text-[var(--ai-dim)] hover:text-foreground">
                <X className="size-3" />
              </button>
            )}
          </label>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto pb-2">
          {found.length === 0 && <p className="px-3 py-2 text-[12px] text-[var(--ai-dim)]">No guide mentions “{query}”.</p>}
          {groups.map((g) => {
            const list = found.filter((t) => t.group === g);
            if (!list.length) return null;
            return (
              <div key={g} className="pt-2">
                <p className="px-3 pb-1 text-[10px] font-semibold tracking-wide text-[var(--ai-dim)] uppercase">{g}</p>
                {list.map((t, i) => (
                  <div key={t.id}>
                    {/* Written pages are grouped into sections within their topic. */}
                    {t.section && t.section !== list[i - 1]?.section && <p className="px-3 pt-1.5 pb-0.5 text-[10px] text-[var(--ai-dim)]">{t.section}</p>}
                    <button
                      type="button"
                      onClick={() => onTopic(t.id)}
                      aria-current={t.id === current.id}
                      className={cn("block w-full px-3 py-1.5 text-left text-[12px] hover:bg-[var(--ai-hover)]", t.section && "pl-5", t.id === current.id && "bg-[var(--ai-row-active)] text-foreground")}
                    >
                      {t.title}
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>

      <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto">
        <article className="mx-auto max-w-2xl px-8 py-6">
          <p className="text-[11px] tracking-wide text-[var(--ai-dim)] uppercase">{current.group}</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">{current.title}</h1>
          <p className="mt-1 mb-5 text-[13px] text-[var(--ai-dim)]">{current.summary}</p>
          {current.topic ? (
            <Blocks blocks={current.topic.blocks} onTry={(kind) => onNew(kind, `Practice ${KIND_LABEL[kind].toLowerCase()}`)} />
          ) : current.page ? (
            <Markdown
              text={expand(current.page.body)}
              onDoc={(slug) => {
                if (!entries.some((e) => e.id === slug)) return;
                setQuery(""); // a search that would hide the page it links to is cleared
                onTopic(slug);
              }}
            />
          ) : null}
        </article>
      </main>
    </div>
  );
}

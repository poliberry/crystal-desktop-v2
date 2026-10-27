"use client";

import { Bot, ExternalLink } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { OpenInTarget } from "../../../electron/gitTypes";

/**
 * "Open in…" at the right of the tab bar: the programs on this computer that can take the project's
 * folder — editors (VS Code, Cursor, Zed…), T3 Code, the Codex app, and command-line agents (Claude
 * Code, Codex, OpenCode, Gemini CLI), which start in a terminal inside Studio. The list is made in the
 * main process from what is really installed; this only shows it and says which one was picked.
 */
export function OpenInMenu({
  targets,
  onOpen,
  onOpening,
  vars,
}: {
  targets: OpenInTarget[];
  onOpen: (t: OpenInTarget) => void;
  /** Called when the menu opens, to look again at what's installed. */
  onOpening: () => void;
  /** The workbench palette, because the menu is drawn at the end of <body>, outside it. */
  vars: React.CSSProperties;
}) {
  const editors = targets.filter((t) => t.kind === "editor");
  const apps = targets.filter((t) => t.kind === "app");
  const agents = targets.filter((t) => t.kind === "agent");
  const groups: { label: string; items: OpenInTarget[] }[] = [
    { label: "Editors", items: editors },
    { label: "Apps", items: apps },
    { label: "Agents (opens a terminal here)", items: agents },
  ].filter((g) => g.items.length > 0);

  return (
    <DropdownMenu onOpenChange={(o) => o && onOpening()}>
      <DropdownMenuTrigger asChild>
        <button type="button" title="Open this project in another program" className="flex h-[22px] items-center gap-1 rounded-[2px] px-2 text-[12px] outline-none hover:bg-[var(--vsc-list-hover)] data-[state=open]:bg-[var(--vsc-list-hover)]">
          <ExternalLink className="size-3.5" /> Open in…
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52 rounded-[5px] p-1 text-[12px]" style={{ ...vars, background: "var(--vsc-widget)", color: "var(--vsc-editor-fg)", borderColor: "var(--vsc-widget-border)" }}>
        {groups.length === 0 && <div className="px-2 py-1.5 text-[12px]" style={{ color: "var(--vsc-muted)" }}>No editors or agents were found on this computer.</div>}
        {groups.map((g, i) => (
          <div key={g.label}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="px-2 py-1 text-[11px] font-normal uppercase" style={{ color: "var(--vsc-muted)" }}>{g.label}</DropdownMenuLabel>
            {g.items.map((t) => (
              <DropdownMenuItem key={t.id} onSelect={() => onOpen(t)} className="rounded-[3px] py-[3px] text-[12px] focus:bg-[var(--vsc-accent)] focus:text-[var(--vsc-accent-fg)]">
                {t.kind === "agent" ? <Bot className="size-3.5" /> : <span className="size-3.5" />}
                {t.label}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

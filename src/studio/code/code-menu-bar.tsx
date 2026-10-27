"use client";

import { Check } from "lucide-react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChromeSlot, useStudioChrome } from "@/studio/shell/chrome";
import { cn } from "@/lib/utils";

/** One line of a menu. `checked` makes it a toggle; `keys` is shown at the right, already written for the platform. */
export type MenuEntry = { label: string; keys?: string; run: () => void; disabled?: boolean; checked?: boolean } | "-";
export interface MenuDef {
  label: string;
  items: MenuEntry[];
}

/** The event the Explorer listens for, so File ▸ New File… starts the same name entry its own button does. */
export const EXPLORER_EVENT = "crystal-studio:explorer";
export type ExplorerRequest = { action: "new-file" | "new-folder" | "refresh" | "collapse" };

/**
 * The code workbench's menu bar, in VS Code's order and drawn in its colours, in Studio's title bar.
 * Menus are plain data (`MenuDef`), so every item is the same function as the palette command or the
 * shortcut it sits beside, defined once in the workbench.
 *
 * It sits outside the workbench's own root, where the palette's variables don't reach, so it carries
 * them itself: `vars` is the palette, and `scoped` points Crystal's theme tokens at it so the dropdown
 * (which is drawn at the end of <body>) matches.
 */
export function CodeMenuBar({ menus, vars, scoped, trailing }: { menus: MenuDef[]; vars: Record<string, string>; scoped: Record<string, string>; trailing?: React.ReactNode }) {
  const chrome = useStudioChrome();
  const style = { ...vars, ...scoped } as React.CSSProperties;
  const bar = (
    <div
      className="flex h-[30px] min-w-0 items-stretch text-[12px]"
      style={{ ...style, background: "var(--vsc-activity-bar)", color: "var(--vsc-editor-fg)", WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {menus.map((m) => (
        <DropdownMenu key={m.label}>
          <DropdownMenuTrigger asChild>
            <button type="button" className="px-2 outline-none hover:bg-[var(--vsc-status-hover)] data-[state=open]:bg-[var(--vsc-status-hover)]">
              {m.label}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={0}
            className="min-w-56 rounded-[5px] p-1 text-[12px]"
            style={{ ...style, background: "var(--vsc-widget)", color: "var(--vsc-editor-fg)", borderColor: "var(--vsc-widget-border)" }}
          >
            {m.items.map((it, i) =>
              it === "-" ? (
                <DropdownMenuSeparator key={i} />
              ) : (
                <DropdownMenuItem key={`${it.label}${i}`} disabled={it.disabled} onSelect={it.run} className="rounded-[3px] py-[2px] text-[12px] focus:bg-[var(--vsc-accent)] focus:text-[var(--vsc-accent-fg)]">
                  <span className={cn("flex size-4 shrink-0 items-center justify-center", !it.checked && "opacity-0")}>
                    <Check className="size-3" />
                  </span>
                  {it.label}
                  {it.keys && <DropdownMenuShortcut className="opacity-70">{it.keys}</DropdownMenuShortcut>}
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
      {trailing && <div className="flex items-center pl-2">{trailing}</div>}
    </div>
  );
  return <ChromeSlot host={chrome.menuHost} fit>{bar}</ChromeSlot>;
}

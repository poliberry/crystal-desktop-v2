"use client";

import { createContext, useContext } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * Where an editor puts its menu bar and its control bar. Studio's title bar is the menu bar (as on
 * Windows Illustrator and VS Code, where the menus sit in the title bar) and the row beneath it is
 * the control bar, so Studio owns two empty places and the editor that is open fills them. With no
 * hosts — a bare editor — it draws them above itself instead.
 */
export interface StudioChrome {
  /** The menus, which sit after the window title on the left of the title bar. */
  menuHost: HTMLElement | null;
  /** The editor's action buttons (Submit…), at the right end of the title bar. */
  actionsHost?: HTMLElement | null;
  barHost: HTMLElement | null;
  /** Open Studio's Explore tab, at a guide if one is named. Absent where there is no Explore tab. */
  openGuides?: (topic?: string) => void;
  /** Open Studio's Reference tab, at an item (`bot/Client`, `bot/Client.on`) if one is named. */
  openReference?: (anchor?: string) => void;
  /** Save a project's settings (the `.crysproj`). With none, an editor has no one to save for. */
  saveSettings?: (id: string) => Promise<void>;
  /** Save everything about a project: its settings, and for a code project its files too. */
  saveProject?: (id: string) => Promise<void>;
  /** Whether a project has changes that aren't saved. */
  isDirty?: (id: string) => boolean;
  /**
   * A code project's files live inside its editor, not in Studio's project list, so the editor says
   * whether it has unsaved ones and how to save them; Studio asks before closing over them.
   */
  registerUnsaved?: (id: string, source: { dirty: boolean; save: () => Promise<void> } | null) => void;
}

export const StudioChromeContext = createContext<StudioChrome>({ menuHost: null, barHost: null });

/**
 * Whether the editor below is the one being looked at. An editor Studio keeps mounted but hidden (so a terminal's shell or
 * unsaved files survive a switch of tab) must not draw its menu bar into the shared title bar, or two would show at once.
 */
export const EditorActiveContext = createContext(true);
export const useStudioChrome = () => useContext(StudioChromeContext);

/**
 * Draws its children into one of Studio's chrome places, or where it stands if there is no such place.
 * `className` goes on the wrapper, which is what a canvas editor's `.ai` styling hangs from.
 */
export function ChromeSlot({ host, className, children, fit }: { host: HTMLElement | null; className?: string; children: React.ReactNode; /** Take only the room the content needs, rather than all that is left. The title bar's menus and actions do, so the space between is the window's to drag. */ fit?: boolean }) {
  const active = useContext(EditorActiveContext);
  // A hidden editor has nothing to put in the shared bars (and, with no host, nothing to draw above itself either).
  if (!active) return null;
  const body = <div className={cn("flex min-w-0", !fit && "flex-1", className)}>{children}</div>;
  return host ? createPortal(body, host) : body;
}

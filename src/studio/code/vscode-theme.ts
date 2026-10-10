"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { cssToHex, luminance, mixHex, readableOn, withAlpha } from "@/lib/css-color";

/**
 * The code workbench's colours: VS Code's layout, in the app's selected theme.
 *
 * The arrangement, sizes, icons and behaviour are VS Code's, but the colours are not — they are
 * worked out from the theme the person has chosen (`--background`, `--sidebar`, `--primary`…, whatever
 * is on `<html>` right now, a theme pack's or a custom stylesheet's included) the way VS Code's own
 * themes assign a handful of base colours to its many named parts. So the editor looks like part of
 * Crystal, whichever theme that is, and changes with it live.
 *
 * Each part is named for the VS Code colour it stands in for (`workbench.colorCustomizations`) and
 * is exposed as a CSS variable so components can use it without knowing which theme is on.
 */

export interface VscPalette {
  editor: string; // editor.background
  editorFg: string; // editor.foreground
  sidebar: string; // sideBar.background
  sidebarFg: string;
  sidebarTitleFg: string; // sideBarTitle.foreground
  sidebarSection: string; // sideBarSectionHeader.background
  border: string; // sideBar.border / panel.border / editorGroup.border
  activityBar: string;
  activityFg: string; // activityBar.foreground
  activityInactive: string; // activityBar.inactiveForeground
  accent: string; // focusBorder / activityBar.activeBorder / tab.activeBorderTop
  badge: string;
  badgeFg: string;
  /** Text on the accent colour (buttons, the badge). */
  accentFg: string;
  tabActive: string;
  tabInactive: string;
  tabActiveFg: string;
  tabInactiveFg: string;
  tabHover: string;
  panel: string;
  panelTitleActive: string;
  panelTitleInactive: string;
  statusBar: string;
  statusFg: string;
  statusHover: string;
  listActive: string; // list.activeSelectionBackground (focused)
  listActiveFg: string;
  listInactive: string; // list.inactiveSelectionBackground
  listHover: string;
  input: string;
  inputBorder: string;
  inputFg: string;
  widget: string; // quickInput.background / editorWidget.background
  widgetBorder: string;
  muted: string; // descriptionForeground
  breadcrumb: string;
  breadcrumbActive: string;
  error: string;
  warning: string;
  info: string;
  ok: string;
  scrollbar: string;
  scrollbarHover: string;
  terminalBg: string;
  terminalFg: string;
  /** The editor's selection, and its find-match highlight. */
  selection: string;
  findMatch: string;
  /** Whether this palette is dark: decides Monaco's base theme and its token colours. */
  dark: boolean;
}

const FALLBACK = { dark: "#1f1f1f", light: "#ffffff" };

/** Read the app's theme and assign it to the workbench's parts. */
export function buildPalette(root: HTMLElement = document.documentElement): VscPalette {
  const cs = getComputedStyle(root);
  const raw = (name: string) => cs.getPropertyValue(name).trim();
  // Resolved over the editor colour, because several tokens (--border, --input) are translucent.
  const bg = cssToHex(raw("--background"), "#000") ?? (root.classList.contains("dark") ? FALLBACK.dark : FALLBACK.light);
  const col = (name: string, fallback: string, over = bg) => (raw(name) ? cssToHex(raw(name), over) : null) ?? fallback;
  const dark = luminance(bg) < 0.4;
  const fg = col("--foreground", dark ? "#cccccc" : "#3b3b3b");
  const side = col("--sidebar", col("--card", bg));
  const sideFg = col("--sidebar-foreground", fg, side);
  const muted = col("--muted-foreground", mixHex(bg, fg, 0.6));
  const primary = col("--primary", dark ? "#0078d4" : "#005fb8");
  const border = col("--border", mixHex(bg, fg, 0.14));
  const popover = col("--popover", side);
  const sideAccent = col("--sidebar-accent", mixHex(side, fg, 0.12), side);
  const hover = mixHex(side, fg, dark ? 0.07 : 0.05);
  const accentFg = col("--primary-foreground", readableOn(primary), primary);
  return {
    dark,
    editor: bg,
    editorFg: fg,
    sidebar: side,
    sidebarFg: sideFg,
    sidebarTitleFg: mixHex(sideFg, side, 0.1),
    sidebarSection: side,
    border,
    activityBar: side,
    activityFg: fg,
    activityInactive: muted,
    accent: primary,
    accentFg,
    badge: primary,
    badgeFg: accentFg,
    tabActive: bg,
    tabInactive: side,
    tabActiveFg: fg,
    tabInactiveFg: muted,
    tabHover: bg,
    panel: bg,
    panelTitleActive: fg,
    panelTitleInactive: muted,
    statusBar: side,
    statusFg: sideFg,
    statusHover: withAlpha(sideFg, 0.12),
    listActive: sideAccent,
    listActiveFg: col("--sidebar-accent-foreground", fg, sideAccent),
    listInactive: sideAccent,
    listHover: hover,
    input: col("--input", mixHex(bg, fg, 0.08)),
    inputBorder: mixHex(border, fg, 0.15),
    inputFg: fg,
    widget: popover,
    widgetBorder: mixHex(border, fg, 0.18),
    muted,
    breadcrumb: muted,
    breadcrumbActive: fg,
    error: col("--destructive", dark ? "#f14c4c" : "#e51400"),
    warning: dark ? "#cca700" : "#bf8803",
    info: dark ? "#3794ff" : "#1a85ff",
    ok: dark ? "#89d185" : "#388a34",
    scrollbar: withAlpha(mixHex(bg, fg, 0.5), 0.4),
    scrollbarHover: withAlpha(mixHex(bg, fg, 0.5), 0.7),
    terminalBg: bg,
    terminalFg: fg,
    selection: withAlpha(primary, dark ? 0.35 : 0.25),
    findMatch: withAlpha(col("--chart-4", "#ea5c00"), 0.45),
  };
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The palette as CSS variables: `--vsc-side-bar`, `--vsc-tab-active`, … */
export function paletteVars(p: VscPalette): Record<string, string> {
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [`--vsc-${kebab(k)}`, v]));
}

/** Tailwind-friendly reference to one of the variables: `bg-[var(--vsc-sidebar)]` as `v("sidebar")`. */
export const v = (name: keyof VscPalette) => `var(--vsc-${kebab(name)})`;

const PaletteContext = createContext<VscPalette | null>(null);
export const PaletteProvider = PaletteContext.Provider;
/** The workbench's current palette, for parts drawn outside React's CSS (the terminal, Monaco). */
export const usePalette = (): VscPalette => useContext(PaletteContext) ?? buildPalette();

/**
 * The palette for the theme in effect, kept current. Rebuilt whenever something that can change
 * the theme does: the theme provider swapping its stylesheet, a theme pack or custom CSS being
 * applied, the `dark` class flipping (including for the OS colour scheme). `themeKey` is anything
 * the caller knows changes with the theme, as a belt to the observers' braces.
 */
export function useWorkbenchPalette(themeKey?: string): VscPalette {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let frame = 0;
    const bump = () => {
      cancelAnimationFrame(frame);
      // After the stylesheet change has been applied, once per burst of changes.
      frame = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
    };
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildPalette(), [tick, themeKey]);
}

/** The workbench's font: the system UI font at VS Code's 13px, as VS Code uses on every platform. */
export const WORKBENCH_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Ubuntu", "Droid Sans", sans-serif';
const isMac = () => typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
export const EDITOR_FONT = isMac() ? "Menlo, Monaco, 'Courier New', monospace" : "Consolas, 'Courier New', monospace";
/** VS Code's defaults: 12px on macOS, 14px elsewhere. */
export const EDITOR_FONT_SIZE = () => (isMac() ? 12 : 14);
export const modKey = () => (isMac() ? "⌘" : "Ctrl+");
export const shiftKey = () => (isMac() ? "⇧" : "Shift+");
export const ctrlKey = () => (isMac() ? "⌃" : "Ctrl+");

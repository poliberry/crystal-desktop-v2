"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Monitor, Palette } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { WheelPicker } from "@/components/ui/wheel-picker";
import {
  type SystemThemeIds,
  type Theme,
  type ThemeEntry,
  DEFAULT_SYSTEM_THEME_IDS,
  PRESET_THEMES,
  deriveDynamicTheme,
  getPresetById,
  themeEntries,
} from "@/lib/themes";
import { cn } from "@/lib/utils";

/**
 * The theme list: one card per theme, each a miniature of the app drawn in that
 * theme's own colours.
 *
 * The miniature is real markup using the same colour tokens as the app
 * (`bg-sidebar`, `bg-card`, `text-muted-foreground`…), with the theme's values
 * set as CSS variables on its root. Tailwind's tokens resolve through those
 * variables, so scoping them to the card is all it takes for the card to be in
 * a theme the rest of the page isn't — and nothing here has to be kept in step
 * with the real layout's colours, only with its rough shape.
 */

const CARD_HEIGHT = "h-40";
const SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };

/** A theme's colours as the CSS variables the app's tokens read. */
function themeVars(theme: Theme): React.CSSProperties {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme.colors)) vars[`--${key}`] = value;
  if (theme.font) vars["--font-sans"] = theme.font;
  return vars as React.CSSProperties;
}

/** A line of text, drawn as a bar. */
function Line({ className }: { className?: string }) {
  return <div className={cn("h-1 rounded-full", className)} />;
}

/** A row in a list: a picture and a line. */
function MiniRow({
  tone,
  active,
  width = "w-3/4",
}: {
  tone: string;
  active?: boolean;
  width?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1 rounded px-0.5 py-0.5", active && "bg-sidebar-accent")}>
      <div className={cn("size-3 shrink-0 rounded", tone)} />
      <Line className={cn("bg-sidebar-foreground/40", width)} />
    </div>
  );
}

/** One message in the chat area. */
function MiniMessage({ lines }: { lines: string[] }) {
  return (
    <div className="flex gap-1">
      <div className="size-3 shrink-0 rounded-full bg-primary/80" />
      <div className="flex flex-1 flex-col gap-0.5 pt-0.5">
        <Line className="w-8 bg-primary" />
        {lines.map((width, index) => (
          <Line key={index} className={cn("bg-foreground/45", width)} />
        ))}
      </div>
    </div>
  );
}

/**
 * A screen grab of Crystal, in miniature: the sidebar with its communities and
 * user card, the top bar with its tabs, a conversation and the composer, and
 * the members list at the right.
 */
export function ThemePreview({ theme, className }: { theme: Theme; className?: string }) {
  return (
    <div
      aria-hidden
      style={themeVars(theme)}
      className={cn("flex gap-1 overflow-hidden bg-background p-1.5 text-foreground", className)}
    >
      {/* Left sidebar */}
      <div className="flex w-[30%] flex-col gap-1 rounded-md border border-sidebar-border bg-sidebar p-1.5">
        <div className="flex items-center gap-1">
          <div className="size-2.5 rounded bg-primary" />
          <div className="h-2 w-5 rounded-full border border-sidebar-border" />
        </div>
        <div className="h-3 rounded bg-sidebar-accent" />
        <MiniRow tone="bg-primary/80" active />
        <MiniRow tone="bg-muted-foreground/60" width="w-1/2" />
        <MiniRow tone="bg-destructive/70" width="w-2/3" />
        <div className="mt-auto flex items-center gap-1 rounded border border-sidebar-border bg-card p-1">
          <div className="size-2.5 rounded bg-primary/80" />
          <Line className="w-1/2 bg-card-foreground/50" />
        </div>
      </div>

      {/* Top bar, conversation, composer */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex h-3 items-center gap-1">
          <div className="h-2 w-8 rounded-full bg-accent" />
          <div className="h-2 w-6 rounded-full bg-muted" />
          <div className="ml-auto size-2 rounded-full bg-muted-foreground/40" />
        </div>
        <div className="flex flex-1 flex-col gap-1.5 rounded-md bg-card/60 p-1.5">
          <MiniMessage lines={["w-4/5", "w-3/5"]} />
          <MiniMessage lines={["w-2/3"]} />
          <MiniMessage lines={["w-3/4", "w-1/3"]} />
        </div>
        <div className="flex h-4 items-center gap-1 rounded-md border border-border bg-card px-1">
          <Line className="flex-1 bg-muted-foreground/30" />
          <div className="size-2 rounded-full bg-primary" />
        </div>
      </div>

      {/* Members */}
      <div className="flex w-[17%] flex-col gap-1 rounded-md border border-sidebar-border bg-sidebar p-1">
        <Line className="w-2/3 bg-muted-foreground/40" />
        <MiniRow tone="bg-primary/80" width="w-full" />
        <MiniRow tone="bg-muted-foreground/60" width="w-full" />
        <MiniRow tone="bg-destructive/70" width="w-full" />
      </div>
    </div>
  );
}

/** The frame every card shares: a border that says whether it is the one in
 * use. */
function CardFrame({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "w-80 shrink-0 snap-start overflow-hidden rounded-xl border-2 transition-colors",
        active ? "border-primary" : "border-border hover:border-border/80",
      )}
    >
      {children}
    </div>
  );
}

const swatch = (theme: Theme) => (
  <span
    aria-hidden
    className="size-3 shrink-0 rounded-full border border-border"
    style={{ background: theme.previewAccent }}
  />
);

/**
 * "System": follows the operating system's light/dark setting, with a theme of
 * your choosing for each.
 *
 * The face is the two themes cut along a diagonal — light on one side, dark on
 * the other. The dropdown turns it into two wheels, one list of light themes
 * and one of dark, each choosing what that half of the day looks like.
 */
function SystemCard({
  active,
  ids,
  resolved,
  onSelect,
  onChange,
}: {
  active: boolean;
  ids: SystemThemeIds;
  /** Whichever of the two the system is asking for right now. */
  resolved: Theme;
  onSelect: () => void;
  onChange: (ids: Partial<SystemThemeIds>) => void;
}) {
  const [picking, setPicking] = useState(false);
  const light =
    getPresetById(ids.light) ?? (getPresetById(DEFAULT_SYSTEM_THEME_IDS.light) as Theme);
  const dark = getPresetById(ids.dark) ?? (getPresetById(DEFAULT_SYSTEM_THEME_IDS.dark) as Theme);
  const items = (themes: Theme[]) =>
    themes.map((theme) => ({ value: theme.id, label: theme.name, leading: swatch(theme) }));

  return (
    <CardFrame active={active}>
      <div className={cn("relative", CARD_HEIGHT)} style={themeVars(resolved)}>
        <button
          type="button"
          aria-label="Use the system's light and dark settings"
          onClick={onSelect}
          className="relative block size-full cursor-pointer"
        >
          <ThemePreview theme={light} className="absolute inset-0" />
          <ThemePreview
            theme={dark}
            className="absolute inset-0 [clip-path:polygon(58%_0,100%_0,100%_100%,42%_100%)]"
          />
        </button>

        <AnimatePresence initial={false}>
          {picking && (
            <motion.div
              key="wheels"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={SPRING}
              className="absolute inset-0 flex flex-col justify-center gap-0.5 bg-background px-3 text-foreground"
            >
              <div className="flex gap-3 text-center text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                <span className="flex-1">Light</span>
                <span className="flex-1">Dark</span>
              </div>
              <div className="flex gap-3">
                <WheelPicker
                  label="Theme for the system's light setting"
                  rowHeight={32}
                  visibleRows={3}
                  items={items(PRESET_THEMES.filter((t) => !t.isDark))}
                  value={light.id}
                  onChange={(id) => {
                    onChange({ light: id });
                    onSelect();
                  }}
                />
                <WheelPicker
                  label="Theme for the system's dark setting"
                  rowHeight={32}
                  visibleRows={3}
                  items={items(PRESET_THEMES.filter((t) => t.isDark))}
                  value={dark.id}
                  onChange={(id) => {
                    onChange({ dark: id });
                    onSelect();
                  }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-2 border-t bg-card px-3 py-2">
        <Monitor className="size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">System</p>
        {active && <Check className="size-3.5 shrink-0 text-primary" aria-label="In use" />}
        <button
          type="button"
          aria-expanded={picking}
          aria-label="Choose the light and dark themes"
          onClick={() => setPicking((open) => !open)}
          className="flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-xs transition-colors hover:bg-accent"
        >
          Light / Dark
          <ChevronDown
            className={cn("size-3.5 transition-transform duration-300", picking && "rotate-180")}
          />
        </button>
      </div>
    </CardFrame>
  );
}

/**
 * "Dynamic color mode": the palette is made from the system's accent colour
 * and follows its light/dark setting. Only offered where the app can read the
 * accent colour.
 */
function DynamicCard({
  active,
  accentColor,
  prefersDark,
  onSelect,
}: {
  active: boolean;
  accentColor: string;
  prefersDark: boolean;
  onSelect: () => void;
}) {
  const theme = deriveDynamicTheme(accentColor, prefersDark);

  return (
    <CardFrame active={active}>
      <div className={cn("relative", CARD_HEIGHT)}>
        <button
          type="button"
          aria-label="Use dynamic color mode"
          onClick={onSelect}
          className="block size-full cursor-pointer"
        >
          <ThemePreview theme={theme} className="size-full" />
        </button>
      </div>
      <div className="flex items-center gap-2 border-t bg-card px-3 py-2">
        <Palette className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">Dynamic color mode</p>
          <p className="truncate text-[11px] text-muted-foreground">
            Your system&apos;s accent color and appearance
          </p>
        </div>
        {active && <Check className="size-3.5 shrink-0 text-primary" aria-label="In use" />}
        <span
          aria-hidden
          className="size-4 shrink-0 rounded-full border border-border"
          style={{ background: accentColor }}
        />
      </div>
    </CardFrame>
  );
}

function ThemeCard({
  entry,
  activeId,
  activeFamily,
  onApply,
  onEdit,
}: {
  entry: ThemeEntry;
  activeId: string;
  activeFamily: string | undefined;
  onApply: (theme: Theme) => void;
  onEdit: (theme: Theme) => void;
}) {
  const [picking, setPicking] = useState(false);
  const family = entry.kind === "family" ? entry : null;
  // A family shows — and applies — whichever of its styles is on, or the last
  // (the darkest) when none is.
  const shown =
    entry.kind === "theme"
      ? entry.theme
      : (entry.variants.find((v) => v.id === activeId) ??
        entry.variants[entry.variants.length - 1]);
  const isActive = family ? activeFamily === family.id : activeId === shown.id;

  return (
    <div
      className={cn(
        "w-80 shrink-0 snap-start overflow-hidden rounded-xl border-2 transition-colors",
        isActive ? "border-primary" : "border-border hover:border-border/80",
      )}
    >
      {/* The face of the card. The wheel's rows take their colours from the
          style it is on, so scrolling it repaints the card as it goes. */}
      <div className={cn("relative", CARD_HEIGHT)} style={themeVars(shown)}>
        <button
          type="button"
          aria-label={`Use ${shown.name}`}
          onClick={() => onApply(shown)}
          className="block size-full cursor-pointer"
        >
          <ThemePreview theme={shown} className="size-full" />
        </button>

        <AnimatePresence initial={false}>
          {family && picking && (
            <motion.div
              key="wheel"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={SPRING}
              className="absolute inset-0 flex items-center justify-center bg-background text-foreground"
            >
              <WheelPicker
                label={`${family.name} style`}
                className="max-w-56 flex-none basis-56"
                items={family.variants.map((variant) => ({
                  value: variant.id,
                  label: variant.variant ?? variant.name,
                  leading: (
                    <span
                      aria-hidden
                      className="size-3 shrink-0 rounded-full border border-border"
                      style={{ background: variant.previewAccent }}
                    />
                  ),
                }))}
                value={shown.id}
                onChange={(id) => {
                  const next = family.variants.find((v) => v.id === id);
                  if (next) onApply(next);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-2 border-t bg-card px-3 py-2">
        <p className="min-w-0 truncate text-sm font-medium">{family ? family.name : shown.name}</p>
        {isActive && <Check className="size-3.5 shrink-0 text-primary" aria-label="In use" />}

        {family && (
          <button
            type="button"
            aria-expanded={picking}
            aria-label={`${family.name} style`}
            onClick={() => setPicking((open) => !open)}
            className="flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-xs transition-colors hover:bg-accent"
          >
            {shown.variant}
            <ChevronDown
              className={cn("size-3.5 transition-transform duration-300", picking && "rotate-180")}
            />
          </button>
        )}

        <button
          type="button"
          onClick={() => onEdit(shown)}
          className={cn(
            "text-[11px] text-muted-foreground underline-offset-2 hover:underline",
            !family && "ml-auto",
          )}
        >
          Edit
        </button>
      </div>
    </div>
  );
}

/**
 * Every preset as a card in one horizontal list, with the custom slot at the
 * end. A theme with more than one style carries a dropdown that turns the card
 * into a wheel for choosing between them.
 */
export function ThemePicker({
  mode,
  activeId,
  activeFamily,
  systemThemeIds,
  resolvedTheme,
  dynamic,
  onApply,
  onEdit,
  onCustom,
  onSelectSystem,
  onSelectDynamic,
  onSystemThemeIds,
}: {
  mode: "fixed" | "system" | "dynamic";
  /** The picked theme's id, when one is picked (mode `fixed`). */
  activeId: string;
  /** The family of the picked theme, so a family's card reads as in use for
   * whichever of its styles is on. */
  activeFamily: string | undefined;
  systemThemeIds: SystemThemeIds;
  /** The theme showing right now, which is what the System card is dressed in. */
  resolvedTheme: Theme;
  /** Present only where the accent colour can be read. */
  dynamic: { accentColor: string; prefersDark: boolean } | null;
  onApply: (theme: Theme) => void;
  onEdit: (theme: Theme) => void;
  onCustom: () => void;
  onSelectSystem: () => void;
  onSelectDynamic: () => void;
  onSystemThemeIds: (ids: Partial<SystemThemeIds>) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  // Whether there is anywhere further to go in each direction, for the buttons.
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const update = () =>
      setEdges({
        start: el.scrollLeft <= 1,
        end: el.scrollLeft >= el.scrollWidth - el.clientWidth - 1,
      });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      resize.disconnect();
    };
  }, []);

  // One card at a time: a card and the gap after it.
  const step = (direction: 1 | -1) => {
    const el = list.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    el.scrollBy({ left: direction * (card.offsetWidth + 12), behavior: "smooth" });
  };

  const arrow = (direction: 1 | -1) => {
    const disabled = direction === 1 ? edges.end : edges.start;
    const Icon = direction === 1 ? ChevronRight : ChevronLeft;
    return (
      <button
        type="button"
        aria-label={direction === 1 ? "Next themes" : "Previous themes"}
        disabled={disabled}
        onClick={() => step(direction)}
        className="flex size-9 shrink-0 items-center justify-center self-center rounded-full border bg-card text-foreground shadow-sm transition-[opacity,background-color] hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
      >
        <Icon className="size-4" />
      </button>
    );
  };

  return (
    <div className="flex items-stretch gap-2">
      {arrow(-1)}
      <div
        ref={list}
        // No scrollbar: the buttons either side are how it moves, and a card
        // always comes to rest square on the edge.
        className="flex min-w-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <SystemCard
          active={mode === "system"}
          ids={systemThemeIds}
          resolved={resolvedTheme}
          onSelect={onSelectSystem}
          onChange={onSystemThemeIds}
        />
        {dynamic && (
          <DynamicCard
            active={mode === "dynamic"}
            accentColor={dynamic.accentColor}
            prefersDark={dynamic.prefersDark}
            onSelect={onSelectDynamic}
          />
        )}
        {themeEntries().map((entry) => (
          <ThemeCard
            key={entry.kind === "family" ? entry.id : entry.theme.id}
            entry={entry}
            activeId={activeId}
            activeFamily={activeFamily}
            onApply={onApply}
            onEdit={onEdit}
          />
        ))}

        <button
          type="button"
          onClick={onCustom}
          className={cn(
            "flex w-40 shrink-0 snap-start items-center justify-center rounded-xl border-2 border-dashed bg-muted/30 text-sm text-muted-foreground transition-colors",
            activeId === "custom" ? "border-primary text-foreground" : "border-border hover:border-border/80",
          )}
        >
          Custom…
        </button>
      </div>
      {arrow(1)}
    </div>
  );
}

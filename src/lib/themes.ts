export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  "card-foreground": string;
  popover: string;
  "popover-foreground": string;
  primary: string;
  "primary-foreground": string;
  secondary: string;
  "secondary-foreground": string;
  muted: string;
  "muted-foreground": string;
  accent: string;
  "accent-foreground": string;
  destructive: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  "sidebar-foreground": string;
  "sidebar-primary": string;
  "sidebar-primary-foreground": string;
  "sidebar-accent": string;
  "sidebar-accent-foreground": string;
  "sidebar-border": string;
  "sidebar-ring": string;
}

export interface Theme {
  id: string;
  name: string;
  isDark: boolean;
  font?: string;
  /** Themes that are one palette in several styles share a family; the picker
   * shows the family once, with a dropdown for the style. */
  family?: { id: string; name: string };
  /** This theme's name within its family — "Mocha". */
  variant?: string;
  previewBg: string;
  previewAccent: string;
  colors: ThemeColors;
}

const LIGHT_COLORS: ThemeColors = {
  background: "oklch(1 0 0)",
  foreground: "oklch(0.141 0.005 285.823)",
  card: "oklch(1 0 0)",
  "card-foreground": "oklch(0.141 0.005 285.823)",
  popover: "oklch(1 0 0)",
  "popover-foreground": "oklch(0.141 0.005 285.823)",
  primary: "oklch(0.21 0.006 285.885)",
  "primary-foreground": "oklch(0.985 0 0)",
  secondary: "oklch(0.967 0.001 286.375)",
  "secondary-foreground": "oklch(0.21 0.006 285.885)",
  muted: "oklch(0.967 0.001 286.375)",
  "muted-foreground": "oklch(0.552 0.016 285.938)",
  accent: "oklch(0.967 0.001 286.375)",
  "accent-foreground": "oklch(0.21 0.006 285.885)",
  destructive: "oklch(0.577 0.245 27.325)",
  border: "oklch(0.92 0.004 286.32)",
  input: "oklch(0.92 0.004 286.32)",
  ring: "oklch(0.705 0.015 286.067)",
  sidebar: "oklch(0.985 0 0)",
  "sidebar-foreground": "oklch(0.141 0.005 285.823)",
  "sidebar-primary": "oklch(0.21 0.006 285.885)",
  "sidebar-primary-foreground": "oklch(0.985 0 0)",
  "sidebar-accent": "oklch(0.967 0.001 286.375)",
  "sidebar-accent-foreground": "oklch(0.21 0.006 285.885)",
  "sidebar-border": "oklch(0.92 0.004 286.32)",
  "sidebar-ring": "oklch(0.705 0.015 286.067)",
};

const DARK_COLORS: ThemeColors = {
  background: "oklch(0.141 0.005 285.823)",
  foreground: "oklch(0.985 0 0)",
  card: "oklch(0.21 0.006 285.885)",
  "card-foreground": "oklch(0.985 0 0)",
  popover: "oklch(0.21 0.006 285.885)",
  "popover-foreground": "oklch(0.985 0 0)",
  primary: "oklch(0.922 0.003 286.089)",
  "primary-foreground": "oklch(0.21 0.006 285.885)",
  secondary: "oklch(0.274 0.006 286.033)",
  "secondary-foreground": "oklch(0.985 0 0)",
  muted: "oklch(0.274 0.006 286.033)",
  "muted-foreground": "oklch(0.705 0.015 286.067)",
  accent: "oklch(0.274 0.006 286.033)",
  "accent-foreground": "oklch(0.985 0 0)",
  destructive: "oklch(0.704 0.191 22.216)",
  border: "oklch(1 0 0 / 10%)",
  input: "oklch(1 0 0 / 15%)",
  ring: "oklch(0.552 0.016 285.938)",
  sidebar: "oklch(0.21 0.006 285.885)",
  "sidebar-foreground": "oklch(0.985 0 0)",
  "sidebar-primary": "oklch(0.488 0.243 264.376)",
  "sidebar-primary-foreground": "oklch(0.985 0 0)",
  "sidebar-accent": "oklch(0.274 0.006 286.033)",
  "sidebar-accent-foreground": "oklch(0.985 0 0)",
  "sidebar-border": "oklch(1 0 0 / 10%)",
  "sidebar-ring": "oklch(0.552 0.016 285.938)",
};

/**
 * Catppuccin — one palette in four flavours: Latte for light, and Frappé,
 * Macchiato and Mocha stepping down through the dark ones.
 *
 * Each flavour names the same 26 colours, so the four are one mapping applied
 * to four sets of values rather than four themes written out by hand. Mauve is
 * the accent, as it is in most Catppuccin ports; surfaces step from `base`
 * (the page) to `mantle` (cards and the sidebar) to `surface0` (hover and
 * muted fills), with the overlays and subtexts doing the greys.
 */
interface CatppuccinPalette {
  mauve: string;
  lavender: string;
  red: string;
  text: string;
  subtext0: string;
  surface1: string;
  surface0: string;
  base: string;
  mantle: string;
  crust: string;
}

const CATPPUCCIN_FAMILY = { id: "catppuccin", name: "Catppuccin" } as const;

function catppuccinTheme(variant: string, isDark: boolean, p: CatppuccinPalette): Theme {
  // Text on the accent: the page colour in Latte, where the accent is the
  // darker of the two, and the darkest base in the dark flavours.
  const onAccent = isDark ? p.crust : p.base;
  return {
    id: `catppuccin-${variant.toLowerCase().replace("é", "e")}`,
    name: `Catppuccin ${variant}`,
    isDark,
    family: CATPPUCCIN_FAMILY,
    variant,
    previewBg: p.base,
    previewAccent: p.mauve,
    colors: {
      background: p.base,
      foreground: p.text,
      card: p.mantle,
      "card-foreground": p.text,
      popover: p.mantle,
      "popover-foreground": p.text,
      primary: p.mauve,
      "primary-foreground": onAccent,
      secondary: p.surface0,
      "secondary-foreground": p.text,
      muted: p.surface0,
      "muted-foreground": p.subtext0,
      accent: p.surface0,
      "accent-foreground": p.text,
      destructive: p.red,
      border: p.surface1,
      input: p.surface1,
      ring: p.lavender,
      sidebar: p.mantle,
      "sidebar-foreground": p.text,
      "sidebar-primary": p.mauve,
      "sidebar-primary-foreground": onAccent,
      "sidebar-accent": p.surface0,
      "sidebar-accent-foreground": p.text,
      "sidebar-border": p.surface0,
      "sidebar-ring": p.lavender,
    },
  };
}

/** Light to dark, which is the order the dropdown lists them in. */
const CATPPUCCIN_THEMES: Theme[] = [
  catppuccinTheme("Latte", false, {
    mauve: "#8839ef",
    lavender: "#7287fd",
    red: "#d20f39",
    text: "#4c4f69",
    subtext0: "#6c6f85",
    surface1: "#bcc0cc",
    surface0: "#ccd0da",
    base: "#eff1f5",
    mantle: "#e6e9ef",
    crust: "#dce0e8",
  }),
  catppuccinTheme("Frappé", true, {
    mauve: "#ca9ee6",
    lavender: "#babbf1",
    red: "#e78284",
    text: "#c6d0f5",
    subtext0: "#a5adce",
    surface1: "#51576d",
    surface0: "#414559",
    base: "#303446",
    mantle: "#292c3c",
    crust: "#232634",
  }),
  catppuccinTheme("Macchiato", true, {
    mauve: "#c6a0f6",
    lavender: "#b7bdf8",
    red: "#ed8796",
    text: "#cad3f5",
    subtext0: "#a5adcb",
    surface1: "#494d64",
    surface0: "#363a4f",
    base: "#24273a",
    mantle: "#1e2030",
    crust: "#181926",
  }),
  catppuccinTheme("Mocha", true, {
    mauve: "#cba6f7",
    lavender: "#b4befe",
    red: "#f38ba8",
    text: "#cdd6f4",
    subtext0: "#a6adc8",
    surface1: "#45475a",
    surface0: "#313244",
    base: "#1e1e2e",
    mantle: "#181825",
    crust: "#11111b",
  }),
];

export const PRESET_THEMES: Theme[] = [
  {
    id: "dark",
    name: "Dark",
    isDark: true,
    previewBg: "#141414",
    previewAccent: "#ebebeb",
    colors: DARK_COLORS,
  },
  {
    id: "light",
    name: "Light",
    isDark: false,
    previewBg: "#ffffff",
    previewAccent: "#141414",
    colors: LIGHT_COLORS,
  },
  {
    id: "purple",
    name: "Purple Violet",
    isDark: true,
    previewBg: "#1a0f2e",
    previewAccent: "#a855f7",
    colors: {
      background: "oklch(0.14 0.025 290)",
      foreground: "oklch(0.97 0 0)",
      card: "oklch(0.19 0.03 290)",
      "card-foreground": "oklch(0.97 0 0)",
      popover: "oklch(0.19 0.03 290)",
      "popover-foreground": "oklch(0.97 0 0)",
      primary: "oklch(0.65 0.28 290)",
      "primary-foreground": "oklch(0.97 0 0)",
      secondary: "oklch(0.26 0.05 290)",
      "secondary-foreground": "oklch(0.97 0 0)",
      muted: "oklch(0.26 0.05 290)",
      "muted-foreground": "oklch(0.65 0.04 290)",
      accent: "oklch(0.26 0.05 290)",
      "accent-foreground": "oklch(0.97 0 0)",
      destructive: "oklch(0.704 0.191 22.216)",
      border: "oklch(1 0 0 / 12%)",
      input: "oklch(1 0 0 / 18%)",
      ring: "oklch(0.65 0.28 290)",
      sidebar: "oklch(0.19 0.03 290)",
      "sidebar-foreground": "oklch(0.97 0 0)",
      "sidebar-primary": "oklch(0.65 0.28 290)",
      "sidebar-primary-foreground": "oklch(0.97 0 0)",
      "sidebar-accent": "oklch(0.26 0.05 290)",
      "sidebar-accent-foreground": "oklch(0.97 0 0)",
      "sidebar-border": "oklch(1 0 0 / 12%)",
      "sidebar-ring": "oklch(0.65 0.28 290)",
    },
  },
  {
    id: "pink",
    name: "Pink Fuchsia",
    isDark: true,
    previewBg: "#1f0a18",
    previewAccent: "#e879a0",
    colors: {
      background: "oklch(0.14 0.025 330)",
      foreground: "oklch(0.97 0 0)",
      card: "oklch(0.19 0.03 330)",
      "card-foreground": "oklch(0.97 0 0)",
      popover: "oklch(0.19 0.03 330)",
      "popover-foreground": "oklch(0.97 0 0)",
      primary: "oklch(0.65 0.3 330)",
      "primary-foreground": "oklch(0.97 0 0)",
      secondary: "oklch(0.26 0.05 330)",
      "secondary-foreground": "oklch(0.97 0 0)",
      muted: "oklch(0.26 0.05 330)",
      "muted-foreground": "oklch(0.65 0.04 330)",
      accent: "oklch(0.26 0.05 330)",
      "accent-foreground": "oklch(0.97 0 0)",
      destructive: "oklch(0.704 0.191 22.216)",
      border: "oklch(1 0 0 / 12%)",
      input: "oklch(1 0 0 / 18%)",
      ring: "oklch(0.65 0.3 330)",
      sidebar: "oklch(0.19 0.03 330)",
      "sidebar-foreground": "oklch(0.97 0 0)",
      "sidebar-primary": "oklch(0.65 0.3 330)",
      "sidebar-primary-foreground": "oklch(0.97 0 0)",
      "sidebar-accent": "oklch(0.26 0.05 330)",
      "sidebar-accent-foreground": "oklch(0.97 0 0)",
      "sidebar-border": "oklch(1 0 0 / 12%)",
      "sidebar-ring": "oklch(0.65 0.3 330)",
    },
  },
  {
    id: "wintergreen",
    name: "Wintergreen",
    isDark: true,
    previewBg: "#0a1f18",
    previewAccent: "#34d399",
    colors: {
      background: "oklch(0.14 0.025 165)",
      foreground: "oklch(0.97 0 0)",
      card: "oklch(0.19 0.03 165)",
      "card-foreground": "oklch(0.97 0 0)",
      popover: "oklch(0.19 0.03 165)",
      "popover-foreground": "oklch(0.97 0 0)",
      primary: "oklch(0.62 0.22 165)",
      "primary-foreground": "oklch(0.97 0 0)",
      secondary: "oklch(0.26 0.05 165)",
      "secondary-foreground": "oklch(0.97 0 0)",
      muted: "oklch(0.26 0.05 165)",
      "muted-foreground": "oklch(0.65 0.04 165)",
      accent: "oklch(0.26 0.05 165)",
      "accent-foreground": "oklch(0.97 0 0)",
      destructive: "oklch(0.704 0.191 22.216)",
      border: "oklch(1 0 0 / 12%)",
      input: "oklch(1 0 0 / 18%)",
      ring: "oklch(0.62 0.22 165)",
      sidebar: "oklch(0.19 0.03 165)",
      "sidebar-foreground": "oklch(0.97 0 0)",
      "sidebar-primary": "oklch(0.62 0.22 165)",
      "sidebar-primary-foreground": "oklch(0.97 0 0)",
      "sidebar-accent": "oklch(0.26 0.05 165)",
      "sidebar-accent-foreground": "oklch(0.97 0 0)",
      "sidebar-border": "oklch(1 0 0 / 12%)",
      "sidebar-ring": "oklch(0.62 0.22 165)",
    },
  },
  {
    id: "nord",
    name: "Nord Blue",
    isDark: true,
    previewBg: "#2e3440",
    previewAccent: "#88c0d0",
    colors: {
      background: "oklch(0.25 0.025 240)",
      foreground: "oklch(0.88 0.01 240)",
      card: "oklch(0.30 0.025 240)",
      "card-foreground": "oklch(0.88 0.01 240)",
      popover: "oklch(0.30 0.025 240)",
      "popover-foreground": "oklch(0.88 0.01 240)",
      primary: "oklch(0.73 0.07 210)",
      "primary-foreground": "oklch(0.25 0.025 240)",
      secondary: "oklch(0.35 0.025 240)",
      "secondary-foreground": "oklch(0.88 0.01 240)",
      muted: "oklch(0.35 0.025 240)",
      "muted-foreground": "oklch(0.62 0.02 240)",
      accent: "oklch(0.35 0.025 240)",
      "accent-foreground": "oklch(0.88 0.01 240)",
      destructive: "oklch(0.65 0.18 28)",
      border: "oklch(1 0 0 / 10%)",
      input: "oklch(1 0 0 / 15%)",
      ring: "oklch(0.73 0.07 210)",
      sidebar: "oklch(0.30 0.025 240)",
      "sidebar-foreground": "oklch(0.88 0.01 240)",
      "sidebar-primary": "oklch(0.73 0.07 210)",
      "sidebar-primary-foreground": "oklch(0.25 0.025 240)",
      "sidebar-accent": "oklch(0.35 0.025 240)",
      "sidebar-accent-foreground": "oklch(0.88 0.01 240)",
      "sidebar-border": "oklch(1 0 0 / 10%)",
      "sidebar-ring": "oklch(0.73 0.07 210)",
    },
  },
  ...CATPPUCCIN_THEMES,
];

export const DEFAULT_THEME_ID = "dark";

/**
 * How the theme is chosen.
 *
 * - `fixed`: one theme, the one picked.
 * - `system`: follows the operating system's light/dark setting, using one
 *   theme for each (`systemThemeIds`).
 * - `dynamic`: follows the system's light/dark setting *and* its accent colour,
 *   with a palette made from that colour. Only where the app can read it.
 */
export type ThemeMode = "fixed" | "system" | "dynamic";

export interface SystemThemeIds {
  light: string;
  dark: string;
}

export const DEFAULT_SYSTEM_THEME_IDS: SystemThemeIds = { light: "light", dark: "dark" };

// --- Dynamic colour ----------------------------------------------------------

/** `#rrggbb` to OKLCH — the space the app's own colours are written in, and the
 * one where "same hue, different lightness" is a thing that can be said. */
function hexToOklch(hex: string): { l: number; c: number; h: number } {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(1);
  const g = channel(3);
  const b = channel(5);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(a, bb);
  const hue = (Math.atan2(bb, a) * 180) / Math.PI;
  return { l: lightness, c: chroma, h: (hue + 360) % 360 };
}

/**
 * A theme made from the system's accent colour.
 *
 * The accent's hue tints every surface — faintly, so the app reads as neutral
 * with a colour cast rather than as a coloured app — and the accent itself is
 * the primary, pulled to a lightness that has contrast on the surfaces it sits
 * on (light on dark, dark on light). A grey accent (macOS's Graphite) has no
 * hue to speak of, and the same arithmetic gives a neutral theme.
 */
export function deriveDynamicTheme(accentHex: string, isDark: boolean): Theme {
  const accent = hexToOklch(accentHex);
  const h = accent.h.toFixed(1);
  const chroma = Math.min(0.2, accent.c);
  // Surfaces: a fraction of the accent's chroma, never more than a tint.
  const tint = (amount: number) => (Math.min(accent.c, 0.12) * amount).toFixed(4);
  const o = (lightness: number, amount: number) => `oklch(${lightness} ${tint(amount)} ${h})`;

  const primary = `oklch(${isDark ? 0.78 : 0.5} ${chroma.toFixed(4)} ${h})`;
  const onPrimary = isDark ? `oklch(0.2 ${tint(0.4)} ${h})` : "oklch(0.99 0 0)";

  const surface = {
    background: isDark ? o(0.16, 0.25) : o(0.985, 0.08),
    card: isDark ? o(0.2, 0.3) : o(0.97, 0.12),
    raised: isDark ? o(0.27, 0.4) : o(0.94, 0.2),
    foreground: isDark ? o(0.96, 0.08) : o(0.2, 0.2),
    muted: isDark ? o(0.72, 0.3) : o(0.5, 0.3),
    border: isDark ? "oklch(1 0 0 / 12%)" : o(0.9, 0.2),
  };

  return {
    id: "dynamic",
    name: "Dynamic color",
    isDark,
    previewBg: surface.background,
    previewAccent: primary,
    colors: {
      background: surface.background,
      foreground: surface.foreground,
      card: surface.card,
      "card-foreground": surface.foreground,
      popover: surface.card,
      "popover-foreground": surface.foreground,
      primary,
      "primary-foreground": onPrimary,
      secondary: surface.raised,
      "secondary-foreground": surface.foreground,
      muted: surface.raised,
      "muted-foreground": surface.muted,
      accent: surface.raised,
      "accent-foreground": surface.foreground,
      destructive: isDark ? "oklch(0.704 0.191 22.216)" : "oklch(0.577 0.245 27.325)",
      border: surface.border,
      input: isDark ? "oklch(1 0 0 / 16%)" : o(0.9, 0.2),
      ring: primary,
      sidebar: surface.card,
      "sidebar-foreground": surface.foreground,
      "sidebar-primary": primary,
      "sidebar-primary-foreground": onPrimary,
      "sidebar-accent": surface.raised,
      "sidebar-accent-foreground": surface.foreground,
      "sidebar-border": surface.border,
      "sidebar-ring": primary,
    },
  };
}

/** The presets as the picker shows them: a theme on its own, or a family once
 * with all of its styles. In `PRESET_THEMES` order, a family where its first
 * style is. */
export type ThemeEntry =
  | { kind: "theme"; theme: Theme }
  | { kind: "family"; id: string; name: string; variants: Theme[] };

export function themeEntries(): ThemeEntry[] {
  const entries: ThemeEntry[] = [];
  for (const theme of PRESET_THEMES) {
    if (!theme.family) {
      entries.push({ kind: "theme", theme });
      continue;
    }
    const existing = entries.find((e) => e.kind === "family" && e.id === theme.family!.id);
    if (existing && existing.kind === "family") existing.variants.push(theme);
    else {
      entries.push({
        kind: "family",
        id: theme.family.id,
        name: theme.family.name,
        variants: [theme],
      });
    }
  }
  return entries;
}

export function getPresetById(id: string): Theme | undefined {
  return PRESET_THEMES.find((t) => t.id === id);
}

export const THEME_JSON_SCHEMA_EXAMPLE = JSON.stringify(
  {
    name: "My Theme",
    isDark: true,
    font: "",
    colors: DARK_COLORS,
  },
  null,
  2
);

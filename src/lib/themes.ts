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
];

export const DEFAULT_THEME_ID = "dark";

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

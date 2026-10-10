/**
 * What a creator can send to the Marketplace beyond a single picture: lounge
 * scenes and theme packs.
 *
 * Pure — no Convex imports — because the same rules run in two places. The server
 * runs them when a submission arrives and is the authority; Crystal Studio runs
 * them while a creator edits, so a mistake shows up as a line in the Problems
 * panel rather than as a rejection later. Both call the same functions, so they
 * cannot drift.
 *
 * A *spec* is data. It never contains code, never contains a CSS declaration it
 * could smuggle another declaration through, and every address in it is checked
 * by a caller-supplied function (`assertUrl`) that knows what "on our CDN, in the
 * uploader's own folder" means in that place.
 */

// --- Shared ----------------------------------------------------------------------------

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function num(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

/** Checks one address and returns it, or throws. */
export type UrlCheck = (url: string, role: string) => string;

export interface SpecProblem {
  path: string;
  message: string;
}

// --- Lounge scenes ---------------------------------------------------------------------

/** The animated props a scene can place. Drawn by the client, not shipped. */
export const SCENE_PROP_KINDS = [
  "fire",
  "lamp",
  "neon",
  "discoball",
  "fireflies",
  "snow",
  "steam",
  "candle",
] as const;
export type ScenePropKind = (typeof SCENE_PROP_KINDS)[number];

/** What a scene's background can be: a picture, or a short looping clip. */
export const SCENE_BACKGROUND_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "webm", "mp4"] as const;

export const SCENE_LIMITS = {
  seats: 24,
  props: 24,
  /** Pictures of drawn artwork laid over the room (see `SceneOverlay`). */
  overlay: 40,
  name: 60,
} as const;

/** What an overlay picture can be: a still picture with transparency, never a clip or a page. */
export const SCENE_OVERLAY_EXTENSIONS = ["png", "webp", "gif"] as const;

export interface SceneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SceneSpecProp {
  id: string;
  kind: ScenePropKind;
  /** Where it stands: percent of the picture, feet on this point. */
  x: number;
  y: number;
  /** Width as a percent of the picture's width. */
  size: number;
  /** Anyone in the lounge can click it. */
  interactive: boolean;
  /** Starts lit/on. */
  on: boolean;
}

/**
 * One piece of artwork drawn on the room: a picture placed over the background, below the screen's
 * glow, the props and the people. Studio draws shapes, paths, text and effects to pictures (the same
 * way a decoration's are) and sends them here, so what was drawn in the editor is what the room shows.
 * Where it goes is in percent of the room picture, so it scales with the room.
 */
export interface SceneOverlay {
  url: string;
  /** Top-left corner, percent of the room's width and height. A little past the edge is allowed (a glow reaches). */
  x: number;
  y: number;
  /** Size, percent of the room's width and height. */
  w: number;
  h: number;
  opacity: number;
}

export interface SceneSpec {
  v: 1;
  name: string;
  backgroundUrl: string;
  screen: SceneRect;
  floorTop: number;
  seats: { x: number; y: number }[];
  props: SceneSpecProp[];
  lights: { dimOnShare: boolean; amount: number };
  /** Drawn artwork over the background, bottom first. Absent on scenes made before it existed. */
  overlay: SceneOverlay[];
}

const ID = /^[a-zA-Z0-9_-]{1,32}$/;

/** A scene, rebuilt from whatever was sent: numbers clamped, lists capped, kinds
 * matched against the catalogue, the picture's address checked. */
export function normalizeSceneSpec(input: unknown, assertUrl: UrlCheck): SceneSpec {
  if (!input || typeof input !== "object") throw new Error("That scene is broken.");
  const raw = input as Record<string, unknown>;

  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, SCENE_LIMITS.name) : "";
  if (name.length < 2) throw new Error("A scene needs a name.");

  const backgroundUrl = assertUrl(String(raw.backgroundUrl ?? ""), "scene background");
  // An address with no extension is taken to be a picture (older scenes); one with a
  // different extension is neither, and is refused rather than drawn as a broken image.
  const bgExt = extensionOf(backgroundUrl);
  if (bgExt && !(SCENE_BACKGROUND_EXTENSIONS as readonly string[]).includes(bgExt)) {
    throw new Error("A scene's background has to be a PNG, JPEG, WebP or GIF picture, or a WebM or MP4 clip.");
  }

  const s = (raw.screen ?? {}) as Record<string, unknown>;
  const w = num(s.w, 8, 90, 38);
  const h = num(s.h, 6, 80, 30);
  const screen: SceneRect = {
    w,
    h,
    x: num(s.x, 0, 100 - w, 31),
    y: num(s.y, 0, 100 - h, 10),
  };

  const floorTop = num(raw.floorTop, 20, 85, 58);

  const seats = (Array.isArray(raw.seats) ? raw.seats : [])
    .slice(0, SCENE_LIMITS.seats)
    .map((seat) => {
      const r = (seat ?? {}) as Record<string, unknown>;
      return { x: num(r.x, 0, 100, 50), y: num(r.y, 0, 100, 80) };
    });

  const seen = new Set<string>();
  const props: SceneSpecProp[] = [];
  for (const item of Array.isArray(raw.props) ? raw.props.slice(0, SCENE_LIMITS.props) : []) {
    const r = (item ?? {}) as Record<string, unknown>;
    if (!(SCENE_PROP_KINDS as readonly string[]).includes(String(r.kind))) {
      throw new Error(`"${String(r.kind)}" isn't a prop Crystal can draw.`);
    }
    let id = typeof r.id === "string" && ID.test(r.id) ? r.id : `p${props.length + 1}`;
    if (seen.has(id)) id = `${id}-${props.length}`;
    seen.add(id);
    props.push({
      id,
      kind: r.kind as ScenePropKind,
      x: num(r.x, 0, 100, 50),
      y: num(r.y, 0, 100, 80),
      size: num(r.size, 2, 40, 8),
      interactive: r.interactive === true,
      on: r.on !== false,
    });
  }

  const overlay: SceneOverlay[] = [];
  for (const item of Array.isArray(raw.overlay) ? raw.overlay.slice(0, SCENE_LIMITS.overlay) : []) {
    const r = (item ?? {}) as Record<string, unknown>;
    const url = assertUrl(String(r.url ?? ""), "scene artwork");
    const ext = extensionOf(url);
    if (ext && !(SCENE_OVERLAY_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new Error("Artwork on a scene has to be a PNG, WebP or GIF picture.");
    }
    overlay.push({
      url,
      x: num(r.x, -50, 150, 0),
      y: num(r.y, -50, 150, 0),
      w: num(r.w, 0.1, 200, 10),
      h: num(r.h, 0.1, 200, 10),
      opacity: num(r.opacity, 0.02, 1, 1),
    });
  }

  const l = (raw.lights ?? {}) as Record<string, unknown>;
  return {
    v: 1,
    name,
    backgroundUrl,
    screen,
    floorTop,
    seats,
    props,
    lights: { dimOnShare: l.dimOnShare === true, amount: num(l.amount, 0.2, 0.85, 0.6) },
    overlay,
  };
}

// --- Theme packs -----------------------------------------------------------------------

/** The design tokens a theme may set — the keys of `ThemeColors` in src/lib/themes.ts. */
export const THEME_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
] as const;
export type ThemeToken = (typeof THEME_TOKENS)[number];

/** The sounds a pack can replace — the keys of `UI_SOUNDS` in src/lib/ui-sounds.ts. */
export const PACK_SOUNDS = [
  "callJoin",
  "callLeave",
  "screenShareStart",
  "screenShareStop",
  "viewerJoin",
  "viewerLeave",
  "mute",
  "unmute",
  "deafen",
  "undeafen",
  "cameraOn",
  "cameraOff",
  "message",
  "ring",
  "ringOutgoing",
] as const;
export type PackSound = (typeof PACK_SOUNDS)[number];

export const PACK_LIMITS = {
  name: 60,
  icons: 80,
  family: 40,
} as const;

export const FONT_FORMATS = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" } as const;
export type FontFormat = keyof typeof FONT_FORMATS;

/** One file of a font family: a weight, a style, and where it is. A variable font
 * is one file that covers a range, written with `weightMax`. */
export interface FontFaceSpec {
  url: string;
  format: FontFormat;
  /** 100–900, in hundreds. For a variable font, the lightest it covers. */
  weight: number;
  weightMax?: number;
  style: "normal" | "italic";
}

/** A family's most files: regular, bold and italic of a few weights, with room to spare. */
export const MAX_FONT_FACES = 12;

export interface ThemePackSpec {
  v: 1;
  name: string;
  font?: { family: string; faces: FontFaceSpec[] };
  /**
   * The pack's colours. `isDark` says which scheme `colors` is for. `alt` is an optional second palette for the other
   * scheme: with it the pack follows the person's light/dark choice, wearing whichever palette matches. Without it the
   * pack has one look and forces its scheme on, as every pack did before variants existed. Kept inside `theme` so an app
   * that doesn't know about `alt` reads a variant pack as the single-palette pack it always understood.
   */
  theme?: { isDark: boolean; colors: Partial<Record<ThemeToken, string>>; alt?: { colors: Partial<Record<ThemeToken, string>> } };
  sounds?: Partial<Record<PackSound, string>>;
  icons?: Record<string, string>;
}

/**
 * Which palette a pack wears, given whether the app's own theme is dark. A pack with both palettes follows the app's
 * light/dark setting (`forced: false`: nothing overrides the scheme). A pack with one forces its scheme.
 */
export function pickThemeVariant(
  theme: NonNullable<ThemePackSpec["theme"]>,
  baseIsDark: boolean,
): { isDark: boolean; colors: Partial<Record<ThemeToken, string>>; forced: boolean } {
  if (!theme.alt) return { isDark: theme.isDark, colors: theme.colors, forced: true };
  if (theme.isDark === baseIsDark) return { isDark: theme.isDark, colors: theme.colors, forced: false };
  return { isDark: !theme.isDark, colors: theme.alt.colors, forced: false };
}

/** A palette of known tokens with plain colours, or an error saying which one isn't. */
function normalizeColours(input: unknown): Partial<Record<ThemeToken, string>> {
  const colors: Partial<Record<ThemeToken, string>> = {};
  for (const [token, value] of Object.entries((input ?? {}) as Record<string, unknown>)) {
    if (!(THEME_TOKENS as readonly string[]).includes(token)) throw new Error(`"${token}" isn't a colour a theme can set.`);
    if (typeof value !== "string" || !COLOUR.test(value.trim())) throw new Error(`"${token}" isn't a plain colour.`);
    colors[token as ThemeToken] = value.trim();
  }
  if (Object.keys(colors).length === 0) throw new Error("A theme with no colours isn't a theme.");
  return colors;
}

/** A colour and nothing else: hex, or a colour function over plain numbers. No
 * `url()`, no `;`, no `}` — so a value cannot end its declaration early. */
const COLOUR = /^(?:#[0-9a-fA-F]{3,8}|(?:oklch|oklab|rgba?|hsla?)\([0-9a-zA-Z.,%\s/+-]{1,70}\))$/;

/** The `.ext` of an address, ignoring any query string. */
export function extensionOf(url: string): string {
  const path = url.split(/[?#]/)[0] ?? "";
  return (path.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
}

export function normalizeThemePackSpec(input: unknown, assertUrl: UrlCheck): ThemePackSpec {
  if (!input || typeof input !== "object") throw new Error("That theme pack is broken.");
  const raw = input as Record<string, unknown>;

  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, PACK_LIMITS.name) : "";
  if (name.length < 2) throw new Error("A theme pack needs a name.");
  const out: ThemePackSpec = { v: 1, name };

  if (raw.font) {
    const f = raw.font as Record<string, unknown>;
    const family = String(f.family ?? "").trim();
    if (!/^[A-Za-z0-9 _-]{1,40}$/.test(family)) throw new Error("A font family's name can use letters, numbers, spaces, - and _.");

    // A pack made before families had several files has just `url`: that is one regular face.
    const rawFaces = Array.isArray(f.faces) ? f.faces : f.url ? [{ url: f.url, weight: 400, style: "normal" }] : [];
    if (rawFaces.length === 0) throw new Error("A font family needs at least one font file.");
    if (rawFaces.length > MAX_FONT_FACES) throw new Error(`A font family can have up to ${MAX_FONT_FACES} files.`);

    const seen = new Set<string>();
    const faces: FontFaceSpec[] = rawFaces.map((item) => {
      const r = (item ?? {}) as Record<string, unknown>;
      const url = assertUrl(String(r.url ?? ""), "font");
      const format = extensionOf(url);
      if (!(format in FONT_FORMATS)) throw new Error("A font has to be a WOFF2, WOFF, TTF or OTF file.");
      const weight = Number(r.weight ?? 400);
      const weightMax = r.weightMax === undefined || r.weightMax === null ? undefined : Number(r.weightMax);
      const validWeight = (n: number) => Number.isInteger(n) && n >= 100 && n <= 900 && n % 100 === 0;
      if (!validWeight(weight) || (weightMax !== undefined && (!validWeight(weightMax) || weightMax <= weight))) {
        throw new Error("A font's weight is 100, 200 … 900 (a variable font covers a range, like 100–900).");
      }
      const style = r.style === "italic" ? "italic" : "normal";
      // Two files claiming the same weight and style would fight; the first would win silently.
      const key = `${style}:${weight}:${weightMax ?? ""}`;
      if (seen.has(key)) throw new Error(`Two of the family's files are both ${style} ${weight}${weightMax ? `–${weightMax}` : ""}.`);
      seen.add(key);
      return { url, format: format as FontFormat, weight, weightMax, style };
    });
    out.font = { family, faces };
  }

  if (raw.theme) {
    const t = raw.theme as Record<string, unknown>;
    out.theme = { isDark: t.isDark !== false, colors: normalizeColours(t.colors) };
    // The other scheme's palette, if the pack has one. An empty one is "no variant", not an error: it is what a creator
    // who added a variant and hasn't coloured it yet has, and the pack is still a good single-palette pack.
    const alt = t.alt as Record<string, unknown> | null | undefined;
    if (alt && typeof alt === "object" && Object.keys((alt.colors ?? {}) as object).length > 0) {
      out.theme.alt = { colors: normalizeColours(alt.colors) };
    }
  }

  if (raw.sounds) {
    const sounds: Partial<Record<PackSound, string>> = {};
    for (const [key, value] of Object.entries(raw.sounds as Record<string, unknown>)) {
      if (!(PACK_SOUNDS as readonly string[]).includes(key)) throw new Error(`"${key}" isn't a sound a pack can replace.`);
      const url = assertUrl(String(value ?? ""), "sound");
      if (!["wav", "mp3", "ogg", "m4a"].includes(extensionOf(url))) throw new Error("Sounds can be WAV, MP3, OGG or M4A.");
      sounds[key as PackSound] = url;
    }
    if (Object.keys(sounds).length) out.sounds = sounds;
  }

  if (raw.icons) {
    const icons: Record<string, string> = {};
    const entries = Object.entries(raw.icons as Record<string, unknown>);
    if (entries.length > PACK_LIMITS.icons) throw new Error(`A pack can replace up to ${PACK_LIMITS.icons} icons.`);
    for (const [key, value] of entries) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || key.length > 40) throw new Error(`"${key}" isn't an icon name.`);
      const url = assertUrl(String(value ?? ""), "icon");
      if (extensionOf(url) !== "svg") throw new Error("Icons have to be SVG files.");
      icons[key] = url;
    }
    if (Object.keys(icons).length) out.icons = icons;
  }

  if (!out.font && !out.theme && !out.sounds && !out.icons) throw new Error("A theme pack needs at least a font, theme, sounds or icons.");
  return out;
}

import { normalizeThemePackSpec, PACK_SOUNDS, THEME_TOKENS, type ThemePackSpec } from "../../../convex/lib/creationSpecs";
import type { Problem } from "@/studio/model/compile";
import { MAX_FONT_FACES } from "../../../convex/lib/creationSpecs";
import type { AssetMeta, FontFaceData, ThemePackData } from "@/studio/model/types";

/** The icons Crystal draws most, offered as suggestions. Any lucide name works. */
export const COMMON_ICONS = [
  "video", "video-off", "mic", "mic-off", "headphones", "headphone-off", "monitor-up", "screen-share-off", "music-4", "phone", "phone-off",
  "hash", "volume-2", "settings", "users", "user", "plus", "x", "check", "search", "bell", "bell-off", "smile", "image-plus", "send-horizontal",
  "star", "pin", "lock", "shield", "crown", "gem", "sparkles", "armchair", "tv", "flame", "megaphone", "calendar-days", "rss", "server", "swords",
] as const;

export const SOUND_LABELS: Record<string, string> = {
  callJoin: "Someone joins a call",
  callLeave: "Someone leaves a call",
  screenShareStart: "A screen share starts",
  screenShareStop: "A screen share stops",
  viewerJoin: "Someone starts watching you",
  viewerLeave: "Someone stops watching you",
  mute: "You mute",
  unmute: "You unmute",
  deafen: "You deafen",
  undeafen: "You undeafen",
  cameraOn: "Camera on",
  cameraOff: "Camera off",
  message: "A message arrives",
  ring: "Incoming call",
  ringOutgoing: "Outgoing call",
};

const extOf = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();

/** A font as a family of faces, whichever shape it was saved in. */
export function fontOf(font: ThemePackData["font"]): { family: string; faces: FontFaceData[] } | undefined {
  if (!font) return undefined;
  if (font.faces) return { family: font.family, faces: font.faces };
  if (font.assetId) return { family: font.family, faces: [{ assetId: font.assetId, weight: 400, style: "normal" }] };
  return { family: font.family, faces: [] };
}

export const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extra light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
  800: "Extra bold",
  900: "Black",
};

/**
 * A good first guess at what a font file is, from what it is called —
 * `Inter-SemiBold.woff2`, `Roboto-LightItalic.ttf`, `Inter[wght].woff2` — so adding a
 * whole family is a matter of choosing the files, not describing each one. Only a guess:
 * every face's weight and style can be changed.
 */
export function guessFace(fileName: string): Pick<FontFaceData, "weight" | "weightMax" | "style"> {
  const n = fileName.toLowerCase().replace(/\.[a-z0-9]+$/, "");
  const style = /italic|oblique|-it|_it/.test(n) ? "italic" : "normal";
  if (/variable|\[wght|\[.*wght/.test(n)) return { weight: 100, weightMax: 900, style };
  const table: [RegExp, number][] = [
    [/extra[-_ ]?bold|ultra[-_ ]?bold|heavy|800/, 800],
    [/black|900/, 900],
    [/semi[-_ ]?bold|demi[-_ ]?bold|600/, 600],
    [/extra[-_ ]?light|ultra[-_ ]?light|200/, 200],
    [/thin|hairline|100/, 100],
    [/light|300/, 300],
    [/medium|500/, 500],
    [/bold|700/, 700],
  ];
  const hit = table.find(([re]) => re.test(n));
  return { weight: hit ? hit[1] : 400, style };
}

/** The data as the spec the server rebuilds, with `urlOf` giving each file's address. */
export function themePackSpecInput(data: ThemePackData, name: string, assets: Map<string, AssetMeta>, urlOf: (assetId: string) => string) {
  const input: Record<string, unknown> = { name };
  const font = fontOf(data.font);
  const faces = (font?.faces ?? []).filter((f) => assets.get(f.assetId));
  if (font && faces.length) {
    input.font = { family: font.family, faces: faces.map((f) => ({ url: urlOf(f.assetId), weight: f.weight, weightMax: f.weightMax, style: f.style })) };
  }
  // Only what the server reads: the template note is Studio's own.
  if (data.theme && Object.keys(data.theme.colors).length) {
    const alt = data.theme.alt && Object.keys(data.theme.alt.colors).length ? { colors: data.theme.alt.colors } : undefined;
    input.theme = { isDark: data.theme.isDark, colors: data.theme.colors, ...(alt ? { alt } : {}) };
  }
  const sounds = Object.entries(data.sounds).filter(([, id]) => assets.get(id));
  if (sounds.length) input.sounds = Object.fromEntries(sounds.map(([k, id]) => [k, urlOf(id)]));
  const icons = Object.entries(data.icons).filter(([, id]) => assets.get(id));
  if (icons.length) input.icons = Object.fromEntries(icons.map(([k, id]) => [k, urlOf(id)]));
  return input;
}

/**
 * Check a pack with the server's own validator, against stand-in addresses that
 * end in each file's real extension — so the rules about fonts, sounds and icons
 * being the right kind of file are the same ones that will run on submission.
 */
export function checkThemePack(data: ThemePackData, name: string, assets: Map<string, AssetMeta>): Problem[] {
  const problems: Problem[] = [];
  const urlOf = (id: string) => `https://studio.invalid/${id}.${extOf(assets.get(id)?.name ?? "")}`;
  try {
    normalizeThemePackSpec(themePackSpecInput(data, name, assets, urlOf), (u) => u);
  } catch (e) {
    problems.push({ severity: "error", message: e instanceof Error ? e.message : "That pack isn't valid." });
  }
  for (const [token, value] of Object.entries(data.theme?.colors ?? {})) {
    if (!(THEME_TOKENS as readonly string[]).includes(token)) problems.push({ severity: "error", message: `“${token}” isn't a colour a theme can set.` });
    void value;
  }
  const font = fontOf(data.font);
  if (font) {
    if (font.faces.length === 0) problems.push({ severity: "error", message: "The font family has no files yet." });
    if (font.faces.length > MAX_FONT_FACES) problems.push({ severity: "error", message: `A font family can have up to ${MAX_FONT_FACES} files.` });
    const total = font.faces.reduce((n, f) => n + (assets.get(f.assetId)?.size ?? 0), 0);
    if (total > 6 * 1024 * 1024) problems.push({ severity: "warning", message: `The family is ${(total / 1024 / 1024).toFixed(1)} MB in all — everyone who applies the pack downloads it. WOFF2 files are much smaller.` });
    if (font.faces.length > 0 && !font.faces.some((f) => f.style === "normal" && f.weight <= 400 && (f.weightMax ?? f.weight) >= 400)) {
      problems.push({ severity: "warning", message: "No regular (400, upright) file. Text that isn't bold will fall back to the nearest weight you have." });
    }
    if (font.faces.length > 0 && !font.faces.some((f) => f.weight >= 700 || (f.weightMax ?? 0) >= 700)) {
      problems.push({ severity: "warning", message: "No bold file, so bold text will be a faked, smeared version of the regular one." });
    }
  }
  for (const [key, id] of Object.entries(data.sounds)) {
    const a = assets.get(id);
    if (a && a.size > 2 * 1024 * 1024) problems.push({ severity: "warning", message: `The ${SOUND_LABELS[key] ?? key} sound is large (${(a.size / 1024 / 1024).toFixed(1)} MB). Short clips are best.` });
    if (!(PACK_SOUNDS as readonly string[]).includes(key)) problems.push({ severity: "error", message: `“${key}” isn't a sound a pack can replace.` });
  }
  for (const [key, id] of Object.entries(data.icons)) {
    const a = assets.get(id);
    if (a && a.size > 64 * 1024) problems.push({ severity: "warning", message: `The “${key}” icon is ${(a.size / 1024).toFixed(0)} KB — icons should be small SVGs.` });
  }
  if (data.theme && !data.theme.colors.background) problems.push({ severity: "warning", message: "No background colour is set, so the app's own is used under your other colours." });
  return problems;
}

export type { ThemePackSpec };

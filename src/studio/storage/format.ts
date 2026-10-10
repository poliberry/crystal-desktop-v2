import { parse, stringify } from "smol-toml";

import { SCENE_PROP_KINDS } from "../../../convex/lib/creationSpecs";
import { normalizeMotionSpec, type MotionSpec } from "../../../convex/lib/motion";
import { sanitizeEffects, sanitizeGradient, sanitizeLive, sanitizePoints } from "@/studio/model/fx";
import { cleanBrush } from "@/studio/model/brush";
import { cleanMaterial } from "@/studio/model/material";
import { CODE_KINDS, isCodeKind, type AssetMeta, type BotData, type Doc, type DocGuides, type DocKind, type ExtensionData, type Listing, type Node, type Project, type ProjectKind, type ThemePackData } from "@/studio/model/types";

/** A project before its design file (if it has one) has been read. */
export type ProjectBase = Omit<Project, "doc" | "picture" | "motion" | "themePack" | "pack" | "extension" | "bot">;

/**
 * How a Studio project is written to disk.
 *
 *     ~/Documents/Crystal Studio/<Project name>/
 *         <Project name>.crysproj     the project's settings and its list of files (TOML)
 *         <Project name>.<kind ext>   the design itself (JSON)
 *         assets/                     every picture, font, sound and icon the design uses
 *
 * Pure functions only — no files are touched here — so the format can be tested on its own and the
 * same code reads a project whoever wrote it. Everything read back is treated as untrusted: the
 * files are plain text in the person's own folder, and they may have been edited by hand, copied,
 * half-synced or written by a newer version. A project that can't be read says why; it never
 * crashes the app or yields a design the editor can't draw.
 */

export const FORMAT_VERSION = 1;
export const PROJECT_EXT = "crysproj";
export const ASSETS_DIR = "assets";

/** The extension of the file that holds each kind of design. */
export const DOC_EXT: Record<Exclude<ProjectKind, "extension" | "bot">, string> = {
  themePack: "crystheme",
  decoration: "crysadc",
  sticker: "crysprofs",
  nameplate: "crysnp",
  effect: "cryspfe",
  scene: "crysscene",
  pack: "cryscospck",
};

/** Extensions and bots have no design file: see `CODE_KINDS`. */
const docExtOf = (k: ProjectKind): string | undefined => (isCodeKind(k) ? undefined : DOC_EXT[k]);

const KINDS = [...(Object.keys(DOC_EXT) as ProjectKind[]), ...CODE_KINDS];
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export class ProjectFormatError extends Error {}

const fail = (message: string): never => {
  throw new ProjectFormatError(message);
};

// --- Names ---------------------------------------------------------------------------------

/** Characters a file name can't carry on at least one of the systems this runs on. */
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
/** The same set, for testing a name without the state a global regex carries. */
const HAS_BAD_CHAR = new RegExp(BAD_CHARS.source);
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** A project name as a folder name: readable, and valid on macOS, Windows and Linux. */
export function folderNameFor(name: string): string {
  let n = name.normalize("NFC").replace(BAD_CHARS, "-").replace(/\s+/g, " ").trim();
  n = n.replace(/^\.+/, "").replace(/[. ]+$/, "");
  if (n.length > 80) n = n.slice(0, 80).replace(/[. ]+$/, "");
  if (!n) n = "Untitled";
  if (RESERVED.test(n)) n = `${n}_`;
  return n;
}

/** `base`, or `base 2`, `base 3`… — whichever isn't taken. Compared without case: macOS and Windows don't tell them apart. */
export function uniqueName(base: string, taken: Iterable<string>, suffix: (n: number) => string = (n) => ` ${n}`): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base}${suffix(i)}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}

/** A file's name for the assets folder: the original, made safe, and not already used there. */
export function assetFileName(original: string, taken: Iterable<string>): string {
  const clean = original.normalize("NFC").replace(BAD_CHARS, "-").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  const dot = clean.lastIndexOf(".");
  let stem = dot > 0 ? clean.slice(0, dot) : clean;
  let ext = dot > 0 ? clean.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, "") : "";
  stem = stem.replace(/[. ]+$/, "").slice(0, 100) || "asset";
  if (ext.length > 12) ext = ext.slice(0, 12);
  if (RESERVED.test(stem)) stem = `${stem}_`;
  return withSuffix(stem, ext, taken);
}

/** `logo.png`, then `logo (2).png`, `logo (3).png`… — the number goes before the extension. */
function withSuffix(stem: string, ext: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  const first = `${stem}${ext}`;
  if (!used.has(first.toLowerCase())) return first;
  for (let i = 2; i < 10_000; i++) {
    const c = `${stem} (${i})${ext}`;
    if (!used.has(c.toLowerCase())) return c;
  }
  return `${stem} ${Date.now()}${ext}`;
}

// --- Files ---------------------------------------------------------------------------------

/** An asset as it is on disk: its record, plus where in the project folder its bytes are. */
export interface DiskAsset extends AssetMeta {
  /** Relative to the project folder, with `/`: `assets/logo.png`. */
  file: string;
}

export interface EncodedProject {
  projectFile: string;
  /** The design file's name and text. Absent for extensions and bots, which are code projects. */
  docFile?: string;
  proj: string;
  doc?: string;
}

const PROJ_HEADER = `# Crystal Studio project. Crystal Studio reads and writes this file; edit it by hand with care.
# The design itself is in the file named by \`document\`, and every picture, font, sound and
# icon it uses is in the assets folder and listed below.
`;

function compact<T extends Record<string, unknown>>(o: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

/** The design's own content, for the document file. */
function contentOf(p: Project): Record<string, unknown> {
  switch (p.kind) {
    case "decoration":
    case "sticker":
    case "scene":
      return { doc: p.doc };
    case "themePack":
      return { themePack: p.themePack };
    case "nameplate":
    case "effect":
      return { picture: p.picture ?? null, doc: p.doc ?? null, motion: p.motion ?? null };
    case "pack":
      return { pack: p.pack ?? { projectIds: [] } };
    case "extension":
    case "bot":
      return {}; // code projects keep their settings in the .crysproj, and their code in files
  }
}

export function encodeProject(project: Project, folder: string, assets: DiskAsset[]): EncodedProject {
  const ext = docExtOf(project.kind);
  const docFile = ext ? `${folder}.${ext}` : undefined;
  const projectFile = `${folder}.${PROJECT_EXT}`;
  const toml = stringify(
    compact({
      format: FORMAT_VERSION,
      id: project.id,
      kind: project.kind,
      name: project.name,
      created_at: project.createdAt,
      updated_at: project.updatedAt,
      document: docFile,
      // Rebuilt field by field here as well as on the way in, so nothing that isn't a setting (a
      // token, say, if one were ever attached to the object) can reach a file people copy and commit.
      extension: project.kind === "extension" && project.extension ? extensionToToml(sanitizeExtension(project.extension)) : undefined,
      bot: project.kind === "bot" && project.bot ? botToToml(sanitizeBot(project.bot)) : undefined,
      store: project.store && SUBMISSION_ID.test(project.store.submissionId) ? compact({ submission_id: project.store.submissionId, sku_id: project.store.skuId && SUBMISSION_ID.test(project.store.skuId) ? project.store.skuId : undefined }) : undefined,
      listing: {
        name: project.listing.name,
        description: project.listing.description,
        free: project.listing.free,
        price_usd: project.listing.priceUsd,
      },
      assets: assets.map((a) =>
        compact({ id: a.id, file: a.file, name: a.name, type: a.type, size: a.size, width: a.width, height: a.height, created_at: a.createdAt }),
      ),
    }),
  );
  if (!docFile) return { projectFile, proj: PROJ_HEADER + toml + "\n" };
  const doc = JSON.stringify({ format: FORMAT_VERSION, kind: project.kind, ...contentOf(project) }, null, 2);
  return { projectFile, docFile, proj: PROJ_HEADER + toml + "\n", doc: doc + "\n" };
}

// --- Reading -------------------------------------------------------------------------------

/** A Convex document id: what the server returned for a submission. */
const SUBMISSION_ID = /^[a-z0-9]{10,40}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "bigint" ? Number(v) : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

/** A path from a project file that may only name something inside its own assets folder. */
function assetPath(v: unknown): string {
  const file = str(v);
  const parts = file.split("/");
  if (parts.length !== 2 || parts[0] !== ASSETS_DIR || !parts[1] || parts[1] === "." || parts[1] === ".." || HAS_BAD_CHAR.test(parts[1])) {
    return fail(`An asset points at “${file.slice(0, 80)}”, which isn't inside the assets folder.`);
  }
  return file;
}

/** Studio's own copy of a timeline: pictures are `studio:asset/<id>` and nothing else is an address. */
export function sanitizeMotion(raw: unknown, kind: "nameplate" | "effect"): MotionSpec {
  const studioUrl = (u: string) => {
    if (!/^studio:asset\/[\w-]{1,40}$/.test(u)) throw new Error("A picture in the timeline isn't one of this project's files.");
    return u;
  };
  try {
    return normalizeMotionSpec(isObj(raw) ? { ...raw, kind } : { kind }, studioUrl, { studio: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "The timeline isn't readable.");
  }
}

const NODE_TYPES = new Set(["image", "shape", "text", "path", "screen", "seat", "prop", "floor"]);

/** The design, with anything the editor couldn't draw dropped or filled in. */
export function sanitizeDoc(raw: unknown, kind: DocKind): Doc {
  if (!isObj(raw)) return fail("The design isn't readable.");
  const aw = isObj(raw.artboard) ? num(raw.artboard.w, 0) : 0;
  const ah = isObj(raw.artboard) ? num(raw.artboard.h, 0) : 0;
  if (aw <= 0 || ah <= 0 || aw > 20_000 || ah > 20_000) return fail("The design's size isn't valid.");
  if (!isObj(raw.nodes) || !Array.isArray(raw.order)) return fail("The design has no layers list.");

  const nodes: Record<string, Node> = {};
  for (const [id, n] of Object.entries(raw.nodes)) {
    if (!isObj(n) || n.id !== id || typeof n.type !== "string" || !NODE_TYPES.has(n.type)) continue;
    const geom = { x: num(n.x, NaN), y: num(n.y, NaN), w: num(n.w, NaN), h: num(n.h, NaN) };
    if (Object.values(geom).some((g) => Number.isNaN(g) || Math.abs(g) > 1_000_000)) continue;
    const base = {
      id,
      name: str(n.name, n.type).slice(0, 80),
      ...geom,
      rotation: num(n.rotation, 0),
      opacity: Math.min(1, Math.max(0, num(n.opacity, 1))),
      locked: bool(n.locked, false),
      hidden: bool(n.hidden, false),
    };
    const fx = sanitizeEffects(n.fx);
    const group = typeof n.group === "string" && /^[\w-]{1,32}(\/[\w-]{1,32}){0,7}$/.test(n.group) ? n.group : undefined;
    const withFx = <T extends object>(node: T): T => ({ ...node, ...(fx ? { fx } : {}), ...(group ? { group } : {}) });
    switch (n.type) {
      case "image":
        if (typeof n.assetId !== "string" || !n.assetId) continue;
        nodes[id] = withFx({ ...base, type: "image", assetId: n.assetId, ...(n.role === "background" ? { role: "background" as const } : {}) });
        break;
      case "shape":
        nodes[id] = withFx({
          ...base,
          type: "shape",
          shape: n.shape === "ellipse" ? "ellipse" : "rect",
          fill: str(n.fill, "#8b5cf6"),
          stroke: str(n.stroke, "#ffffff"),
          strokeWidth: Math.max(0, num(n.strokeWidth, 0)),
          radius: Math.max(0, num(n.radius, 0)),
          ...(sanitizeGradient(n.fillGradient) ? { fillGradient: sanitizeGradient(n.fillGradient) } : {}),
          ...(sanitizeGradient(n.strokeGradient) ? { strokeGradient: sanitizeGradient(n.strokeGradient) } : {}),
          ...(cleanMaterial(n.fillMaterial) ? { fillMaterial: cleanMaterial(n.fillMaterial) } : {}),
          ...(cleanMaterial(n.strokeMaterial) ? { strokeMaterial: cleanMaterial(n.strokeMaterial) } : {}),
        });
        break;
      case "path": {
        const points = sanitizePoints(n.points);
        if (!points) continue;
        nodes[id] = withFx({
          ...base,
          type: "path",
          points,
          // A path of several contours is a compound path, every contour closed.
          closed: bool(n.closed, false) || points.some((q) => q.m),
          fill: str(n.fill, "none"),
          stroke: str(n.stroke, "#ffffff"),
          strokeWidth: Math.max(0, Math.min(400, num(n.strokeWidth, 2))),
          cap: n.cap === "butt" || n.cap === "square" ? n.cap : "round",
          join: n.join === "bevel" || n.join === "round" ? n.join : "miter",
          ...(sanitizeGradient(n.fillGradient) ? { fillGradient: sanitizeGradient(n.fillGradient) } : {}),
          ...(sanitizeGradient(n.strokeGradient) ? { strokeGradient: sanitizeGradient(n.strokeGradient) } : {}),
          ...(cleanMaterial(n.fillMaterial) ? { fillMaterial: cleanMaterial(n.fillMaterial) } : {}),
          ...(cleanMaterial(n.strokeMaterial) ? { strokeMaterial: cleanMaterial(n.strokeMaterial) } : {}),
          ...(sanitizeLive(n.live) ? { live: sanitizeLive(n.live) } : {}),
          ...(cleanBrush(n.brush) ? { brush: cleanBrush(n.brush) } : {}),
        });
        break;
      }
      case "text":
        nodes[id] = withFx({
          ...base,
          type: "text",
          text: str(n.text).slice(0, 2000),
          fontSize: Math.max(1, num(n.fontSize, 32)),
          fontWeight: Math.min(900, Math.max(100, num(n.fontWeight, 700))),
          italic: bool(n.italic, false),
          align: n.align === "left" || n.align === "right" ? n.align : "center",
          color: str(n.color, "#ffffff"),
          stroke: str(n.stroke, "#000000"),
          strokeWidth: Math.max(0, num(n.strokeWidth, 0)),
          ...(sanitizeGradient(n.colorGradient) ? { colorGradient: sanitizeGradient(n.colorGradient) } : {}),
          ...(cleanMaterial(n.colorMaterial) ? { colorMaterial: cleanMaterial(n.colorMaterial) } : {}),
        });
        break;
      case "prop":
        if (!(SCENE_PROP_KINDS as readonly string[]).includes(String(n.prop))) continue;
        nodes[id] = { ...base, type: "prop", prop: n.prop as never, interactive: bool(n.interactive, false), on: bool(n.on, true) };
        break;
      case "screen":
      case "seat":
      case "floor":
        nodes[id] = { ...base, type: n.type };
        break;
    }
  }

  // Order lists each surviving node once; anything missing from it goes on top.
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of raw.order) if (typeof id === "string" && nodes[id] && !seen.has(id)) (seen.add(id), order.push(id));
  for (const id of Object.keys(nodes)) if (!seen.has(id)) order.push(id);

  const scene = isObj(raw.scene) ? { dimOnShare: bool(raw.scene.dimOnShare, false), amount: Math.min(1, Math.max(0, num(raw.scene.amount, 0.5))) } : undefined;
  const guides = sanitizeGuides(raw.guides);
  return { v: 1, kind, artboard: { w: aw, h: ah }, nodes, order, ...(scene && kind === "scene" ? { scene } : {}), ...(guides ? { guides } : {}) };
}

/** Ruler guides: finite numbers only, a sane number of them, and nothing at all if there are none. */
const MAX_GUIDES = 200;
function sanitizeGuides(raw: unknown): DocGuides | undefined {
  if (!isObj(raw)) return undefined;
  const axis = (v: unknown): number[] =>
    Array.isArray(v)
      ? [...new Set(v.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 100_000))].slice(0, MAX_GUIDES)
      : [];
  const x = axis(raw.x);
  const y = axis(raw.y);
  return x.length || y.length ? { x, y } : undefined;
}

function sanitizeThemePack(raw: unknown): ThemePackData {
  if (!isObj(raw)) return { sounds: {}, icons: {} };
  const strings = (o: unknown): Record<string, string> =>
    isObj(o) ? Object.fromEntries(Object.entries(o).filter(([k, v]) => typeof v === "string" && k.length <= 64).map(([k, v]) => [k, v as string])) : {};
  const out: ThemePackData = { sounds: strings(raw.sounds), icons: strings(raw.icons) };
  if (isObj(raw.theme)) {
    const template = typeof raw.theme.template === "string" && /^[a-z0-9-]{1,64}$/.test(raw.theme.template) ? raw.theme.template : undefined;
    const altRaw = isObj(raw.theme.alt) ? raw.theme.alt : null;
    const altTemplate = altRaw && typeof altRaw.template === "string" && /^[a-z0-9-]{1,64}$/.test(altRaw.template) ? altRaw.template : undefined;
    out.theme = {
      isDark: bool(raw.theme.isDark, true),
      colors: strings(raw.theme.colors),
      ...(template ? { template } : {}),
      ...(altRaw ? { alt: { colors: strings(altRaw.colors), ...(altTemplate ? { template: altTemplate } : {}) } } : {}),
    };
  }
  if (isObj(raw.font)) {
    const faces = Array.isArray(raw.font.faces)
      ? raw.font.faces
          .filter((f): f is Record<string, unknown> => isObj(f) && typeof f.assetId === "string")
          .slice(0, 24)
          .map((f) => ({
            assetId: f.assetId as string,
            weight: Math.min(900, Math.max(100, Math.round(num(f.weight, 400)))),
            ...(f.weightMax !== undefined ? { weightMax: Math.min(900, Math.max(100, Math.round(num(f.weightMax, 900)))) } : {}),
            style: f.style === "italic" ? ("italic" as const) : ("normal" as const),
          }))
      : undefined;
    out.font = { family: str(raw.font.family).slice(0, 80), ...(faces ? { faces } : {}), ...(typeof raw.font.assetId === "string" ? { assetId: raw.font.assetId } : {}) };
  }
  return out;
}

const strList = (v: unknown, max: number, each = 200): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max).map((x) => x.slice(0, each)) : [];

function sanitizeExtension(raw: unknown): ExtensionData {
  const r = isObj(raw) ? raw : {};
  return {
    slug: str(r.slug).slice(0, 40),
    kind: r.kind === "component" ? "component" : "plugin",
    description: str(r.description).slice(0, 400),
    version: /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(str(r.version)) ? str(r.version) : "1.0.0",
    capabilities: strList(r.capabilities, 8, 40),
    network: strList(r.network, 8, 200),
    panelTitle: str(r.panelTitle).slice(0, 40),
  };
}

const extensionToToml = (e: ExtensionData) => ({ slug: e.slug, kind: e.kind, description: e.description, version: e.version, capabilities: e.capabilities, network: e.network, panel_title: e.panelTitle });
const extensionFromToml = (t: unknown): ExtensionData => {
  const r = isObj(t) ? t : {};
  return sanitizeExtension({ slug: r.slug, kind: r.kind, description: r.description, version: r.version, capabilities: r.capabilities, network: r.network, panelTitle: r.panel_title });
};
const botToToml = (b: BotData) =>
  compact({ description: b.description, visibility: b.visibility, permissions: b.permissions, scopes: b.scopes, commands: b.commands, endpoint_url: b.endpointUrl, redirect_uris: b.redirectUris, bot_id: b.botId, bio: b.bio, avatar_asset: b.avatarAssetId, banner_asset: b.bannerAssetId });
const botFromToml = (t: unknown): BotData => {
  const r = isObj(t) ? t : {};
  return sanitizeBot({ description: r.description, visibility: r.visibility, permissions: r.permissions, scopes: r.scopes, commands: r.commands, endpointUrl: r.endpoint_url, redirectUris: r.redirect_uris, botId: r.bot_id, bio: r.bio, avatarAssetId: r.avatar_asset, bannerAssetId: r.banner_asset });
};

function sanitizeBot(raw: unknown): BotData {
  const r = isObj(raw) ? raw : {};
  const perms = num(r.permissions, 0);
  const commands = Array.isArray(r.commands)
    ? r.commands.filter(isObj).slice(0, 25).map((c) => ({ name: str(c.name).slice(0, 32), description: str(c.description).slice(0, 100) }))
    : [];
  return {
    description: str(r.description).slice(0, 300),
    visibility: r.visibility === "public" ? "public" : "private",
    permissions: Number.isInteger(perms) && perms >= 0 && perms <= 0x7fffffff ? perms : 0,
    scopes: strList(r.scopes, 4, 40),
    commands,
    endpointUrl: str(r.endpointUrl).slice(0, 300),
    redirectUris: strList(r.redirectUris, 5, 500),
    // A bot's id is a Convex id: letters and digits only. Anything else isn't one.
    ...(typeof r.botId === "string" && /^[a-z0-9]{10,40}$/.test(r.botId) ? { botId: r.botId } : {}),
    // The profile: a bio is plain text up to the server's limit; pictures are files of this project, named by id.
    ...(typeof r.bio === "string" ? { bio: r.bio.replace(/\r\n?/g, "\n").slice(0, 190) } : {}),
    ...(typeof r.avatarAssetId === "string" && ID.test(r.avatarAssetId) ? { avatarAssetId: r.avatarAssetId } : {}),
    ...(typeof r.bannerAssetId === "string" && ID.test(r.bannerAssetId) ? { bannerAssetId: r.bannerAssetId } : {}),
    // The token is never read from disk, even if a hand-edited file has one.
  };
}

/**
 * Read a project's TOML. A design is a second file, read separately (`decodeDocument`); a code
 * project has none (`docFile` is undefined) and `project` already carries its settings.
 */
export function decodeProjectFile(text: string): { project: ProjectBase & Pick<Project, "extension" | "bot">; assets: DiskAsset[]; docFile?: string } {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    return fail(`The project file isn't valid TOML (${e instanceof Error ? e.message.split("\n")[0] : "unreadable"}).`);
  }
  if (!isObj(raw)) return fail("The project file is empty.");
  const version = num(raw.format, 0);
  if (version < 1) return fail("The project file has no format version.");
  if (version > FORMAT_VERSION) return fail("This project was made with a newer version of Crystal Studio. Update the app to open it.");
  const id = str(raw.id);
  if (!ID.test(id)) return fail("The project has no valid id.");
  const kind = str(raw.kind) as ProjectKind;
  if (!KINDS.includes(kind)) return fail(`“${str(raw.kind).slice(0, 40)}” isn't a kind of project Studio knows.`);
  const ext = docExtOf(kind);
  // A code project's `document` (if an older version wrote one) is ignored: its code is its files.
  const docFile = ext ? str(raw.document) : undefined;
  if (ext && (!docFile || docFile.includes("/") || docFile.includes("\\") || docFile.startsWith(".") || !docFile.endsWith(`.${ext}`))) {
    return fail(`The project doesn't name a .${ext} file to open.`);
  }
  const listingRaw = isObj(raw.listing) ? raw.listing : {};
  const name = str(raw.name, "Untitled").slice(0, 80) || "Untitled";
  const listing: Listing = {
    name: str(listingRaw.name, name).slice(0, 80),
    description: str(listingRaw.description).slice(0, 2000),
    free: bool(listingRaw.free, false),
    priceUsd: str(listingRaw.price_usd, "1.99").slice(0, 12),
  };
  const now = Date.now();
  const assets: DiskAsset[] = [];
  const seen = new Set<string>();
  for (const a of Array.isArray(raw.assets) ? raw.assets : []) {
    if (!isObj(a)) continue;
    const aid = str(a.id);
    if (!ID.test(aid) || seen.has(aid)) continue;
    seen.add(aid);
    assets.push({
      id: aid,
      projectId: id,
      file: assetPath(a.file),
      name: str(a.name, "asset").slice(0, 200),
      type: str(a.type, "application/octet-stream").slice(0, 100),
      size: Math.max(0, num(a.size, 0)),
      createdAt: num(a.created_at, now),
      ...(typeof a.width === "number" ? { width: a.width } : {}),
      ...(typeof a.height === "number" ? { height: a.height } : {}),
    });
  }
  return {
    project: {
      id,
      kind,
      name,
      createdAt: num(raw.created_at, now),
      updatedAt: num(raw.updated_at, now),
      listing,
      ...(isObj(raw.store) && typeof raw.store.submission_id === "string" && SUBMISSION_ID.test(raw.store.submission_id) ? { store: { submissionId: raw.store.submission_id, ...(typeof raw.store.sku_id === "string" && SUBMISSION_ID.test(raw.store.sku_id) ? { skuId: raw.store.sku_id } : {}) } } : {}),
      ...(kind === "extension" ? { extension: extensionFromToml(raw.extension) } : {}),
      ...(kind === "bot" ? { bot: botFromToml(raw.bot) } : {}),
    },
    assets,
    docFile,
  };
}

/** Read a design file and attach what it holds to the project. */
export function decodeDocument(base: ProjectBase & Pick<Project, "extension" | "bot">, text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("The design file isn't readable — it may have been edited or only partly saved.");
  }
  if (!isObj(raw)) return fail("The design file is empty.");
  if (num(raw.format, 0) > FORMAT_VERSION) return fail("This design was made with a newer version of Crystal Studio. Update the app to open it.");
  if (raw.kind !== base.kind) return fail("The design file is for a different kind of project than the project file says.");
  switch (base.kind) {
    case "decoration":
    case "sticker":
    case "scene":
      return { ...base, doc: sanitizeDoc(raw.doc, base.kind) };
    case "themePack":
      return { ...base, themePack: sanitizeThemePack(raw.themePack) };
    case "nameplate":
    case "effect": {
      const pic = isObj(raw.picture) && typeof raw.picture.assetId === "string" ? { assetId: raw.picture.assetId } : undefined;
      // A design made in the canvas and timeline editors has a document and a timeline; an older one only a picture.
      const doc = isObj(raw.doc) ? sanitizeDoc(raw.doc, base.kind) : undefined;
      const motion = doc ? sanitizeMotion(raw.motion, base.kind) : undefined;
      return { ...base, ...(pic ? { picture: pic } : {}), ...(doc ? { doc } : {}), ...(motion ? { motion } : {}) };
    }
    case "extension":
    case "bot":
      return base as Project; // never has a design file
    case "pack": {
      const ids = isObj(raw.pack) && Array.isArray(raw.pack.projectIds) ? raw.pack.projectIds.filter((i): i is string => typeof i === "string" && ID.test(i)) : [];
      return { ...base, pack: { projectIds: [...new Set(ids)] } };
    }
  }
}

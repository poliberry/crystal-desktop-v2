/**
 * KLIPY (GIFs, clips and stickers): the parts of the integration that are plain data.
 *
 * Pure — no Convex or browser imports — so the same code runs in the picker, in the favourites
 * resolver and in tests. KLIPY's integration rules shape everything here:
 *
 *  - API requests come from the person's own client, never through our servers, so this file holds
 *    no network code (see src/lib/klipy.ts for that).
 *  - Media is loaded straight from the addresses KLIPY returns. We never copy it, rewrite it or
 *    re-host it, so a sent GIF is a message attachment that *points at* KLIPY, and the only thing
 *    our database keeps for a favourite is its kind and slug.
 *  - Results are shown in the order KLIPY returned them.
 */

export type KlipyKind = "gif" | "clip" | "sticker";

export const KLIPY_KINDS: readonly KlipyKind[] = ["gif", "clip", "sticker"];

/** The path segment each kind lives under: `/api/v1/{app_key}/{segment}/search`. */
export const KLIPY_SEGMENT: Record<KlipyKind, string> = { gif: "gifs", clip: "clips", sticker: "stickers" };

export const KLIPY_LABEL: Record<KlipyKind, string> = { gif: "GIFs", clip: "Clips", sticker: "Stickers" };

/** The most favourites one person can keep. */
export const MAX_KLIPY_FAVOURITES = 500;

/** Prefixed to a sticker's file name, so a message can tell a sticker from a GIF and show it smaller. */
export const KLIPY_STICKER_PREFIX = "sticker-";

/** `static.klipy.com`, `static1.klipy.com`, `static2.klipy.com` (and the `.co` mirror its own pages use). */
const MEDIA_HOST = /^static\d*\.klipy\.(?:com|co)$/i;

/** An address KLIPY serves media from: https and nothing else, on one of its static hosts. */
export function isKlipyMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && MEDIA_HOST.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** A slug as KLIPY writes them, safe to keep and to send back in a comma-separated list. */
export function isValidKlipySlug(slug: unknown): slug is string {
  return typeof slug === "string" && /^[^\s,/?#\\]{1,200}$/.test(slug);
}

export const isKlipyKind = (kind: unknown): kind is KlipyKind => kind === "gif" || kind === "clip" || kind === "sticker";

export interface KlipyMedia {
  url: string;
  width: number;
  height: number;
}

export interface KlipyItem {
  kind: KlipyKind;
  slug: string;
  title: string;
  /** What the grid shows: a small animated picture. */
  preview: KlipyMedia;
  /** What a message carries. */
  send: { url: string; fileName: string; fileType: string; fileSize: number };
  /** A tiny JPEG as a data address, painted behind the preview while it loads. */
  blur?: string;
}

type Format = "webp" | "gif" | "png" | "jpg" | "mp4" | "webm";

const MIME: Record<Format, string> = {
  webp: "image/webp",
  gif: "image/gif",
  png: "image/png",
  jpg: "image/jpeg",
  mp4: "video/mp4",
  webm: "video/webm",
};

/** [size, format] in the order they are preferred. Animated formats first for the grid. */
type Pick = readonly (readonly [size: "xs" | "sm" | "md" | "hd", format: Format])[];

const GRID_PICK: Pick = [
  ["sm", "webp"], ["sm", "gif"], ["md", "webp"], ["md", "gif"], ["xs", "webp"], ["xs", "gif"], ["hd", "webp"], ["hd", "gif"],
];
/** md WebP: animated, a fraction of the GIF's weight (about 1 MB against 2 MB), and keeps a sticker's transparency. */
const SEND_PICK: Record<"gif" | "sticker", Pick> = {
  gif: [["md", "webp"], ["md", "gif"], ["hd", "webp"], ["hd", "gif"], ["sm", "webp"], ["sm", "gif"]],
  sticker: [["md", "webp"], ["md", "png"], ["md", "gif"], ["hd", "webp"], ["hd", "png"], ["hd", "gif"], ["sm", "webp"], ["sm", "gif"]],
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const positive = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** One `{url, width, height, size}` object, if it is well formed and on KLIPY's own hosts. */
function mediaOf(raw: unknown): (KlipyMedia & { size: number }) | null {
  if (!isObj(raw) || typeof raw.url !== "string" || !isKlipyMediaUrl(raw.url)) return null;
  const width = positive(raw.width);
  const height = positive(raw.height);
  if (!width || !height) return null;
  return { url: raw.url, width, height, size: positive(raw.size) ?? 0 };
}

function firstOf(file: Record<string, unknown>, pick: Pick): ((KlipyMedia & { size: number }) & { format: Format }) | null {
  for (const [size, format] of pick) {
    const bySize = file[size];
    if (!isObj(bySize)) continue;
    const media = mediaOf(bySize[format]);
    if (media) return { ...media, format };
  }
  return null;
}

const BLUR = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function fileNameFor(kind: KlipyKind, slug: string, format: Format): string {
  const safe = slug.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || kind;
  return `${kind === "sticker" ? KLIPY_STICKER_PREFIX : ""}${safe}.${format}`;
}

/** A GIF or sticker object: `file` is size → format → media. */
function sizedItem(kind: "gif" | "sticker", raw: Record<string, unknown>): KlipyItem | null {
  if (!isObj(raw.file) || !isValidKlipySlug(raw.slug)) return null;
  const preview = firstOf(raw.file, GRID_PICK);
  const send = firstOf(raw.file, SEND_PICK[kind]);
  if (!preview || !send) return null;
  return {
    kind,
    slug: raw.slug,
    title: typeof raw.title === "string" ? raw.title.slice(0, 200) : "",
    preview: { url: preview.url, width: preview.width, height: preview.height },
    send: { url: send.url, fileName: fileNameFor(kind, raw.slug, send.format), fileType: MIME[send.format], fileSize: send.size },
    ...(typeof raw.blur_preview === "string" && raw.blur_preview.length < 8000 && BLUR.test(raw.blur_preview) ? { blur: raw.blur_preview } : {}),
  };
}

/** A clip object: `file` is format → address, with the sizes in `file_meta`. */
function clipItem(raw: Record<string, unknown>): KlipyItem | null {
  if (!isObj(raw.file) || !isValidKlipySlug(raw.slug)) return null;
  const meta = isObj(raw.file_meta) ? raw.file_meta : {};
  const at = (format: Format): KlipyMedia | null => {
    const url = raw.file && isObj(raw.file) ? raw.file[format] : undefined;
    const dims = meta[format];
    if (typeof url !== "string" || !isKlipyMediaUrl(url) || !isObj(dims)) return null;
    const width = positive(dims.width);
    const height = positive(dims.height);
    return width && height ? { url, width, height } : null;
  };
  const preview = at("webp") ?? at("gif");
  const mp4 = at("mp4");
  const send = mp4 ? { media: mp4, format: "mp4" as const } : at("webp") ? { media: at("webp")!, format: "webp" as const } : at("gif") ? { media: at("gif")!, format: "gif" as const } : null;
  if (!preview || !send) return null;
  return {
    kind: "clip",
    slug: raw.slug,
    title: typeof raw.title === "string" ? raw.title.slice(0, 200) : "",
    preview,
    send: { url: send.media.url, fileName: fileNameFor("clip", raw.slug, send.format), fileType: MIME[send.format], fileSize: 0 },
    ...(typeof raw.blur_preview === "string" && raw.blur_preview.length < 8000 && BLUR.test(raw.blur_preview) ? { blur: raw.blur_preview } : {}),
  };
}

/** One item of any kind, or null if it is missing something a message would need. */
export function normalizeKlipyItem(kind: KlipyKind, raw: unknown): KlipyItem | null {
  if (!isObj(raw)) return null;
  return kind === "clip" ? clipItem(raw) : sizedItem(kind, raw);
}

/**
 * A search, trending or items response, in KLIPY's order.
 *
 * `{ result, data: { data: [...], current_page, per_page, has_next } }`. Items that can't be shown
 * are skipped rather than failing the page. An items response may put the array directly under
 * `data`, so both are read.
 */
export function normalizeKlipyPage(kind: KlipyKind, json: unknown): { items: KlipyItem[]; hasNext: boolean } {
  const body = isObj(json) ? json.data : undefined;
  const list = Array.isArray(body) ? body : isObj(body) && Array.isArray(body.data) ? body.data : [];
  const items: KlipyItem[] = [];
  for (const raw of list) {
    const item = normalizeKlipyItem(kind, raw);
    if (item) items.push(item);
  }
  return { items, hasNext: isObj(body) && body.has_next === true };
}

/** Appends a page, dropping anything already shown (a result can reappear on the next page). The existing order is kept. */
export function mergeKlipyPages(existing: KlipyItem[], incoming: KlipyItem[]): KlipyItem[] {
  const seen = new Set(existing.map((i) => `${i.kind}:${i.slug}`));
  const merged = existing.slice();
  for (const item of incoming) {
    const key = `${item.kind}:${item.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

/** The attachment a message carries for an item: a link to KLIPY's own file, nothing uploaded. */
export function klipyAttachment(item: KlipyItem): { cdnUrl: string; fileName: string; fileType: string; fileSize: number } {
  return { cdnUrl: item.send.url, fileName: item.send.fileName, fileType: item.send.fileType, fileSize: item.send.fileSize };
}

/**
 * Whether a message's attachment may be accepted as sent. One that was uploaded (a storage id or an R2 key) is checked
 * where it is uploaded. One that is only an address — which is what a KLIPY GIF is — is accepted only if the address is
 * KLIPY's own, so a message can't be made to load an arbitrary third-party URL into everyone's chat.
 */
export function isAcceptableAttachmentSource(a: { storageId?: unknown; cdnKey?: unknown; cdnUrl?: unknown }): boolean {
  if (a.storageId || a.cdnKey) return true;
  return typeof a.cdnUrl === "string" && isKlipyMediaUrl(a.cdnUrl);
}

/** Whether an attachment is a KLIPY sticker, which a message shows small and without a frame. */
export function isKlipyStickerAttachment(fileName: string, url: string | null | undefined): boolean {
  return fileName.startsWith(KLIPY_STICKER_PREFIX) && isKlipyMediaUrl(url);
}

/**
 * Deals items into columns, each to whichever is shortest so far — a masonry layout that doesn't move
 * what is already placed when another page is added (CSS columns would rebalance every item).
 * `ratio` is an item's height over its width.
 */
export function balanceColumns<T>(items: readonly T[], columns: number, ratio: (item: T) => number): T[][] {
  const out: T[][] = Array.from({ length: Math.max(1, columns) }, () => []);
  const heights = out.map(() => 0);
  for (const item of items) {
    let shortest = 0;
    for (let c = 1; c < heights.length; c++) if (heights[c]! < heights[shortest]!) shortest = c;
    out[shortest]!.push(item);
    const r = ratio(item);
    heights[shortest]! += Number.isFinite(r) && r > 0 ? r : 1;
  }
  return out;
}

export function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

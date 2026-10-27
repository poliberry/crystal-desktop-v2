import { MOTION_LIMITS, emptyMotion, newMotionId, normalizeMotionSpec, type Clip, type MotionKind } from "../../../convex/lib/motion";
import { LIBRARY_FOLDER, LIBRARY_VERSION, type EffectCatalogEntry } from "../../../convex/lib/effectLibrary";

/**
 * Studio's end of the effect library: fetching the catalogue and single effects from the CDN (they are published there by
 * `effectLibraryPublish:publish`) and turning what arrives into clips that are safe to put on a timeline.
 *
 * What comes back over the network is not trusted. A catalogue is read field by field; an effect's clips go through the same
 * `normalizeMotionSpec` that guards a published design, with every picture address refused (a library effect is generators and
 * keyframes only), and the result is given new ids so the same effect can be added twice. A response that is the wrong shape,
 * too big or for another version of the format is an error with a sentence, never a half-added effect.
 */

const MAX_BYTES = 120 * 1024;

export interface LibraryCatalog {
  effects: EffectCatalogEntry[];
}

export class LibraryError extends Error {}

/** Where the library is, from the CDN's address; null when this build has none. */
export const libraryBase = (cdn: string | null | undefined): string | null => (cdn ? `${cdn.replace(/\/$/, "")}/${LIBRARY_FOLDER}` : null);

async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { credentials: "omit", cache: "no-cache" });
  } catch {
    throw new LibraryError("Couldn't reach the library. Check your connection and try again.");
  }
  if (res.status === 404) throw new LibraryError("The effect library hasn't been published yet.");
  if (!res.ok) throw new LibraryError(`The library didn't answer (HTTP ${res.status}).`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new LibraryError("That file is larger than a library file should be, so it was ignored.");
  try {
    return JSON.parse(text);
  } catch {
    throw new LibraryError("The library sent something that isn't readable.");
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const KINDS: MotionKind[] = ["effect", "nameplate"];

export function parseCatalog(raw: unknown): LibraryCatalog {
  if (!isObj(raw) || !Array.isArray(raw.effects)) throw new LibraryError("The library's list is damaged.");
  if (raw.version !== LIBRARY_VERSION) throw new LibraryError("This library is for a different version of Studio. Update Studio to use it.");
  const effects: EffectCatalogEntry[] = [];
  for (const e of raw.effects.slice(0, 500)) {
    if (!isObj(e) || typeof e.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id) || typeof e.name !== "string") continue;
    const kinds = (Array.isArray(e.kinds) ? e.kinds : []).filter((k): k is MotionKind => KINDS.includes(k as MotionKind));
    if (!kinds.length) continue;
    effects.push({
      id: e.id,
      name: e.name.slice(0, 60),
      group: typeof e.group === "string" ? e.group.slice(0, 40) : "Other",
      description: typeof e.description === "string" ? e.description.slice(0, 200) : "",
      kinds,
      colors: (Array.isArray(e.colors) ? e.colors : []).filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)).slice(0, 6),
      clips: typeof e.clips === "number" ? e.clips : 1,
    });
  }
  return { effects };
}

export async function fetchCatalog(base: string, fetchImpl: typeof fetch = fetch): Promise<LibraryCatalog> {
  return parseCatalog(await getJson(`${base}/index.json`, fetchImpl));
}

/**
 * The clips of one library effect for a design of `kind`, checked and with fresh ids. `room` is how many more clips the design
 * can take; an effect that wouldn't fit is refused whole rather than added in part.
 */
export async function fetchEffectClips(base: string, id: string, kind: MotionKind, room: number, fetchImpl: typeof fetch = fetch): Promise<{ name: string; clips: Clip[]; duration: number; intro: number }> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) throw new LibraryError("That isn't an effect in the library.");
  const raw = await getJson(`${base}/${id}.json`, fetchImpl);
  if (!isObj(raw) || !isObj(raw.variants) || raw.id !== id) throw new LibraryError("That effect's file is damaged.");
  const clips = (raw.variants as Record<string, unknown>)[kind];
  if (!Array.isArray(clips) || clips.length === 0) throw new LibraryError(`That effect isn't made for a ${kind === "effect" ? "profile effect" : "nameplate"}.`);
  if (clips.length > room) throw new LibraryError(`It needs ${clips.length} clip${clips.length === 1 ? "" : "s"} and this design has room for ${Math.max(0, room)} (the limit is ${MOTION_LIMITS.clips}).`);
  const duration = typeof raw.duration === "number" ? Math.min(MOTION_LIMITS.duration, Math.max(0.5, raw.duration)) : 4;
  // Seconds before the loop. An effect published before intros existed has none, and loops as a whole.
  const intro = typeof raw.intro === "number" && Number.isFinite(raw.intro) ? Math.round(Math.min(duration / 3, Math.max(0, raw.intro)) * 1000) / 1000 : 0;
  let checked;
  try {
    checked = normalizeMotionSpec({ ...emptyMotion(kind), duration, clips }, (url) => {
      throw new Error(`a picture (${url.slice(0, 60)})`);
    });
  } catch (e) {
    throw new LibraryError(`That effect isn't valid: ${e instanceof Error ? e.message : "unreadable"}.`);
  }
  if (checked.clips.length !== clips.length) throw new LibraryError("That effect has something Studio can't use, so it wasn't added.");
  return { name: typeof raw.name === "string" ? raw.name.slice(0, 60) : id, duration, intro, clips: checked.clips.map((c) => ({ ...c, id: newMotionId() })) };
}

// --- Keeping effects on the device ---------------------------------------------------------------------------------------------

const STORE = "crystal-studio:effect:";
const storage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** Whether an effect has been downloaded to this device, so it works with no network. */
export const isDownloaded = (id: string): boolean => !!storage()?.getItem(`${STORE}${id}`);

export function downloadedIds(): Set<string> {
  const s = storage();
  const out = new Set<string>();
  if (!s) return out;
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k?.startsWith(STORE)) out.add(k.slice(STORE.length));
  }
  return out;
}

export function removeDownload(id: string): void {
  storage()?.removeItem(`${STORE}${id}`);
}

/** The cached text of an effect: only ever what a successful, checked download stored. */
const cachedText = (id: string): string | null => storage()?.getItem(`${STORE}${id}`) ?? null;

/**
 * A `fetch` that answers a library effect from the device when it was downloaded, and goes to the network for everything else
 * (the catalogue is always fresh). What it serves is read back through the same checks as a fresh download.
 */
export function withDownloads(real: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const m = /\/([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/.exec(url);
    const text = m && m[1] !== "index" ? cachedText(m[1]) : null;
    return text !== null ? new Response(text, { status: 200, headers: { "Content-Type": "application/json" } }) : real(input, init);
  }) as typeof fetch;
}

/**
 * Download one effect to this device. It is fetched and checked for every kind of design it fits before anything is stored, so
 * only an effect that will add cleanly is kept.
 */
export async function downloadEffect(base: string, entry: EffectCatalogEntry, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${base}/${entry.id}.json`, { credentials: "omit", cache: "no-cache" }).catch(() => null);
  if (!res || !res.ok) throw new LibraryError(res ? `The library didn't answer (HTTP ${res.status}).` : "Couldn't reach the library. Check your connection and try again.");
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new LibraryError("That file is larger than a library file should be, so it was ignored.");
  // Read back through the real path, from this exact text, once per kind it fits.
  const local: typeof fetch = (async () => new Response(text, { status: 200 })) as typeof fetch;
  for (const kind of entry.kinds) await fetchEffectClips(base, entry.id, kind, MOTION_LIMITS.clips, local);
  const s = storage();
  if (!s) throw new LibraryError("This device won't keep downloads (storage is unavailable).");
  try {
    s.setItem(`${STORE}${entry.id}`, text);
  } catch {
    throw new LibraryError("There's no room to keep it. Remove some downloaded effects and try again.");
  }
}

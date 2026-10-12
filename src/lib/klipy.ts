import {
  chunk,
  KLIPY_SEGMENT,
  normalizeKlipyPage,
  type KlipyItem,
  type KlipyKind,
} from "../../convex/lib/klipy";

/**
 * Talking to KLIPY, from the person's own machine.
 *
 * KLIPY's integration rules require this: API requests and media loads come from the end user's client, not from a server
 * of ours acting as a proxy, and nothing is re-hosted. So this is plain `fetch` in the renderer, and the key is a
 * `NEXT_PUBLIC_` one — KLIPY puts it in the request path (`/api/v1/{app_key}/…`) because it is meant to ship in clients.
 * Everything that interprets what comes back is in convex/lib/klipy.ts, where it is tested.
 */

const API = "https://api.klipy.com/api/v1";

/** Where the key is read: baked into the build, like the CDN's address. */
const KEY = process.env.NEXT_PUBLIC_KLIPY_API_KEY || "";

/** Whether this build has a KLIPY key. Without one the picker opens to a notice saying so, rather than to an empty grid. */
export const klipyConfigured = (): boolean => KEY.length > 0;

export const KLIPY_PAGE_SIZE = 24;

/** Failing in a way that has something useful to say to a person. */
export class KlipyError extends Error {}

/** KLIPY wants a user identifier that stays the same for the same person, and not their account. A random one per install does. */
function customerId(): string {
  const storageKey = "crystal:klipy-customer";
  try {
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const made = crypto.randomUUID();
    localStorage.setItem(storageKey, made);
    return made;
  } catch {
    return "anonymous";
  }
}

/** The two-letter country in the app's language setting (`en-AU` → `au`), which KLIPY uses to rank for the region. */
function locale(): string | undefined {
  try {
    const region = navigator.language.split("-")[1];
    return region && /^[A-Za-z]{2}$/.test(region) ? region.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

async function call(path: string, params: Record<string, string | number | undefined>, init?: RequestInit): Promise<unknown> {
  if (!KEY) throw new KlipyError("KLIPY isn't set up in this build.");
  const url = new URL(`${API}/${encodeURIComponent(KEY)}/${path}`);
  for (const [name, value] of Object.entries(params)) if (value !== undefined && value !== "") url.searchParams.set(name, String(value));
  let response: Response;
  try {
    response = await fetch(url, { credentials: "omit", ...init });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new KlipyError("Couldn't reach KLIPY. Check your connection.");
  }
  if (response.status === 429) throw new KlipyError("KLIPY is busy right now. Try again in a moment.");
  if (response.status === 401 || response.status === 403) throw new KlipyError("KLIPY turned this request down.");
  if (!response.ok) throw new KlipyError("KLIPY had a problem. Try again in a moment.");
  try {
    return await response.json();
  } catch {
    throw new KlipyError("KLIPY sent something unreadable.");
  }
}

/**
 * One page of what's trending, or of a search when there is a query. Results are returned in KLIPY's order, as its rules
 * require. `content_filter=medium` is KLIPY's own parameter for a mixed audience; finer control is in KLIPY's partner panel.
 */
export async function fetchKlipyPage(
  kind: KlipyKind,
  query: string,
  page: number,
  signal?: AbortSignal,
): Promise<{ items: KlipyItem[]; hasNext: boolean }> {
  const q = query.trim();
  const json = await call(
    `${KLIPY_SEGMENT[kind]}/${q ? "search" : "trending"}`,
    { page, per_page: KLIPY_PAGE_SIZE, q: q || undefined, customer_id: customerId(), locale: locale(), content_filter: "medium" },
    { signal },
  );
  return normalizeKlipyPage(kind, json);
}

/** Items by slug, in the order asked for. Slugs KLIPY no longer has are simply missing from the result. */
export async function fetchKlipyItems(kind: KlipyKind, slugs: string[], signal?: AbortSignal): Promise<KlipyItem[]> {
  if (slugs.length === 0) return [];
  const found = new Map<string, KlipyItem>();
  // The slugs go in the query string, so a long list is several requests.
  for (const group of chunk(slugs, 40)) {
    const json = await call(`${KLIPY_SEGMENT[kind]}/items`, { slugs: group.join(",") }, { signal });
    for (const item of normalizeKlipyPage(kind, json).items) found.set(item.slug, item);
  }
  return slugs.flatMap((slug) => {
    const item = found.get(slug);
    return item ? [item] : [];
  });
}

/** Tells KLIPY something was sent, which is how it learns what people like. Fire and forget: a failure costs nothing. */
export function shareKlipyItem(item: Pick<KlipyItem, "kind" | "slug">, query: string): void {
  if (!KEY) return;
  const url = `${API}/${encodeURIComponent(KEY)}/${KLIPY_SEGMENT[item.kind]}/share/${encodeURIComponent(item.slug)}`;
  void fetch(url, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer_id: customerId(), q: query.trim() }),
    keepalive: true,
  }).catch(() => {});
}

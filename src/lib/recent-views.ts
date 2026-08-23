/**
 * The last few things the user actually opened, newest first.
 *
 * This exists so the preloader can spend its budget where it pays off. A user
 * in twenty servers has hundreds of channels; subscribing to every one of
 * their message histories at once costs more than it saves, while the handful
 * of places someone moves between during a session is both small and highly
 * predictable. Recorded by `TabsProvider` (every tab activation, including
 * back/forward) and read by `DataPreloader`.
 *
 * Persisted so it survives a restart — the first thing you open after
 * launching is usually the last thing you were looking at.
 */

export type RecentView =
  | { type: "dm"; conversationId: string }
  | { type: "channel"; communityId: string; channelId: string };

const STORAGE_KEY = "crystal:recent-views";
/** Deliberately more than anyone flicks between in a session, and still far
 * fewer than a busy account's channel count. */
const MAX_ENTRIES = 20;

const listeners = new Set<() => void>();
let cache: RecentView[] | null = null;

function parse(raw: string | null): RecentView[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as RecentView[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is RecentView =>
        !!v &&
        ((v.type === "dm" && typeof v.conversationId === "string") ||
          (v.type === "channel" &&
            typeof v.communityId === "string" &&
            typeof v.channelId === "string"))
    );
  } catch {
    return [];
  }
}

export function keyOf(view: RecentView): string {
  return view.type === "dm" ? `dm:${view.conversationId}` : `channel:${view.channelId}`;
}

export function readRecentViews(): RecentView[] {
  if (typeof window === "undefined") return [];
  if (!cache) cache = parse(window.localStorage.getItem(STORAGE_KEY));
  return cache;
}

/** Move a view to the front of the list. A no-op when it's already there, so
 * re-rendering never churns storage or wakes subscribers. */
export function recordRecentView(view: RecentView): void {
  if (typeof window === "undefined") return;
  const current = readRecentViews();
  const key = keyOf(view);
  if (current.length > 0 && keyOf(current[0]) === key) return;

  cache = [view, ...current.filter((v) => keyOf(v) !== key)].slice(0, MAX_ENTRIES);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore quota/availability errors — the list is only an optimisation */
  }
  for (const listener of listeners) listener();
}

export function subscribeRecentViews(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRecentViewsSnapshot(): RecentView[] {
  return readRecentViews();
}

const EMPTY: RecentView[] = [];

/** Server snapshot for `useSyncExternalStore` — nothing is "recent" during
 * prerender, and the identity has to be stable. */
export function getServerSnapshot(): RecentView[] {
  return EMPTY;
}

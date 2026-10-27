import { useSyncExternalStore } from "react";

/**
 * `unicode-emoji-json`'s `data-by-emoji.json` (verified against the shipped
 * file, not assumed) is a `Record<string, EmojiData>` keyed by the emoji
 * character itself:
 *
 *   { "😀": { name, slug, group, emoji_version, unicode_version,
 *             skin_tone_support, skin_tone_support_unicode_version? }, ... }
 *
 * Slugs are lowercase ASCII letters, digits, and underscores only (verified
 * by scanning every slug in the dataset — no hyphens/pluses like some other
 * emoji-shortcode conventions use).
 *
 * ## Loaded on demand
 *
 * The file is about 390 KB of JSON. It used to be a static import, which put it in the chunk every launch has to download,
 * parse and evaluate before the app can show anything — and then built three lookup structures from all ~1900 entries at
 * module scope, on that same startup path. It is now its own chunk, fetched after the app is up (`warmSystemEmoji`, called
 * from the root providers) or the first time something needs it.
 *
 * The functions below keep their synchronous shape, because they are called while rendering: until the data has arrived
 * they answer "nothing" (`undefined`, `[]`, a plain smiley). Anything that shows their output re-renders when it lands, by
 * calling `useSystemEmojiReady()`. A `:thumbs_up:` in a message is plain text for the moment before, and the emoji after.
 */
interface EmojiData {
  name: string;
  slug: string;
  group: string;
  emoji_version: string;
  unicode_version: string;
  skin_tone_support: boolean;
  skin_tone_support_unicode_version?: string;
}

interface Loaded {
  byChar: Record<string, EmojiData>;
  bySlug: Map<string, string>;
  /** Slugs sorted once for fast, deterministic prefix search. */
  sortedSlugs: string[];
  groups: SystemEmojiGroup[];
  smileys: string[];
}

let loaded: Loaded | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function build(byChar: Record<string, EmojiData>): Loaded {
  const bySlug = new Map<string, string>();
  const sortedSlugs: string[] = [];
  const byGroup = new Map<string, SystemEmoji[]>();
  for (const [char, data] of Object.entries(byChar)) {
    bySlug.set(data.slug, char);
    sortedSlugs.push(data.slug);
    const bucket = byGroup.get(data.group) ?? [];
    bucket.push({ emoji: char, slug: data.slug, name: data.name });
    byGroup.set(data.group, bucket);
  }
  sortedSlugs.sort();
  // The dataset's own group order is the conventional picker ordering (Smileys first, Flags last), so no manual sort.
  const groups = [...byGroup.entries()].map(([group, emojis]) => ({ group, emojis }));
  const smileys = (groups.find((g) => g.group === "Smileys & Emotion")?.emojis ?? []).map((e) => e.emoji);
  return { byChar, bySlug, sortedSlugs, groups, smileys };
}

/** Starts fetching the emoji data if it isn't already, and resolves when it is in. Safe to call as often as you like. */
export function loadSystemEmoji(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (!loading) {
    loading = import("unicode-emoji-json/data-by-emoji.json")
      .then((module) => {
        loaded = build((module.default ?? module) as Record<string, EmojiData>);
        for (const listener of [...listeners]) listener();
      })
      .catch(() => {
        // Offline with the chunk not cached, say. Allow a later attempt rather than staying empty for the whole session.
        loading = null;
      });
  }
  return loading;
}

/**
 * Starts the load once the app has had its first look at the screen: when the browser is idle, or after a couple of seconds
 * at most. Early enough that the data is there before anyone has typed `:` or scrolled to a message that uses it.
 */
export function warmSystemEmoji(): () => void {
  if (loaded || loading) return () => {};
  const start = () => void loadSystemEmoji();
  if ("requestIdleCallback" in window) {
    const handle = window.requestIdleCallback(start, { timeout: 2500 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = setTimeout(start, 1500);
  return () => clearTimeout(handle);
}

/** `true` once the emoji data is available. Re-renders the caller at the moment that changes. Also starts the load if
 * nothing has, so a screen that needs emoji doesn't depend on the warm-up having run. */
export function useSystemEmojiReady(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      if (!loaded) void loadSystemEmoji();
      return () => {
        listeners.delete(listener);
      };
    },
    () => loaded !== null,
    () => false
  );
}

/** Reverse lookup: slug (e.g. "thumbs_up") -> emoji character, for
 * `:shortcode:` resolution. Case-insensitive. */
export function findSystemEmojiBySlug(slug: string): string | undefined {
  return loaded?.bySlug.get(slug.toLowerCase());
}

/** Prefix search for autocomplete — up to `limit` `{ slug, emoji }` matches,
 * sorted by slug. Case-insensitive. */
export function searchSystemEmoji(
  prefix: string,
  limit = 8
): { slug: string; emoji: string }[] {
  const needle = prefix.toLowerCase();
  if (!needle || !loaded) return [];
  const results: { slug: string; emoji: string }[] = [];
  for (const slug of loaded.sortedSlugs) {
    if (slug.startsWith(needle)) {
      const emoji = loaded.bySlug.get(slug);
      if (emoji) results.push({ slug, emoji });
      if (results.length >= limit) break;
    }
  }
  return results;
}

/** Reverse lookup: emoji character -> shortcode slug, for showing users what
 * to type (`:sob:`) in the picker's tooltips. */
export function findSlugByEmoji(emoji: string): string | undefined {
  return loaded?.byChar[emoji]?.slug;
}

export interface SystemEmoji {
  emoji: string;
  slug: string;
  name: string;
}

export interface SystemEmojiGroup {
  group: string;
  emojis: SystemEmoji[];
}

const NO_GROUPS: SystemEmojiGroup[] = [];

/**
 * Every emoji bucketed by its Unicode group, in the dataset's own order. Empty until the data has loaded (see
 * `useSystemEmojiReady`). The same array every time once it has: the picker renders all ~1900 of these, and a new one on
 * each render would have it rebuild them.
 */
export function getSystemEmojiGroups(): SystemEmojiGroup[] {
  return loaded?.groups ?? NO_GROUPS;
}

/** A random smiley/emotion emoji, for playful UI flourishes. A plain
 * slightly-smiling face if the data isn't in yet, or the group isn't there. */
export function randomSmiley(): string {
  const smileys = loaded?.smileys ?? [];
  return smileys[Math.floor(Math.random() * smileys.length)] ?? "🙂";
}

/** Substring search across slug and name, for the picker's search box. */
export function filterSystemEmoji(query: string, limit = 120): SystemEmoji[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: SystemEmoji[] = [];
  for (const { emojis } of getSystemEmojiGroups()) {
    for (const emoji of emojis) {
      if (emoji.slug.includes(needle) || emoji.name.toLowerCase().includes(needle)) {
        results.push(emoji);
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
}

import emojiByChar from "unicode-emoji-json/data-by-emoji.json";

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

const EMOJI_BY_CHAR = emojiByChar as Record<string, EmojiData>;

// Reverse lookup: slug -> emoji character. Built once at module scope.
const EMOJI_BY_SLUG = new Map<string, string>();
// Slugs sorted once for fast, deterministic prefix search.
const SORTED_SLUGS: string[] = [];

for (const [char, data] of Object.entries(EMOJI_BY_CHAR)) {
  EMOJI_BY_SLUG.set(data.slug, char);
  SORTED_SLUGS.push(data.slug);
}
SORTED_SLUGS.sort();

/** Reverse lookup: slug (e.g. "thumbs_up") -> emoji character, for
 * `:shortcode:` resolution. Case-insensitive. */
export function findSystemEmojiBySlug(slug: string): string | undefined {
  return EMOJI_BY_SLUG.get(slug.toLowerCase());
}

/** Prefix search for autocomplete — up to `limit` `{ slug, emoji }` matches,
 * sorted by slug. Case-insensitive. */
export function searchSystemEmoji(
  prefix: string,
  limit = 8
): { slug: string; emoji: string }[] {
  const needle = prefix.toLowerCase();
  if (!needle) return [];
  const results: { slug: string; emoji: string }[] = [];
  for (const slug of SORTED_SLUGS) {
    if (slug.startsWith(needle)) {
      const emoji = EMOJI_BY_SLUG.get(slug);
      if (emoji) results.push({ slug, emoji });
      if (results.length >= limit) break;
    }
  }
  return results;
}

/** Reverse lookup: emoji character -> shortcode slug, for showing users what
 * to type (`:sob:`) in the picker's tooltips. */
export function findSlugByEmoji(emoji: string): string | undefined {
  return EMOJI_BY_CHAR[emoji]?.slug;
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

/**
 * Every emoji bucketed by its Unicode group, in the dataset's own order —
 * which is the conventional picker ordering (Smileys first, Flags last), so
 * no manual sort is needed.
 *
 * Built once at module scope: the picker renders all ~1900 of these, and
 * re-grouping on every open would be wasted work.
 */
export const SYSTEM_EMOJI_GROUPS: SystemEmojiGroup[] = (() => {
  const byGroup = new Map<string, SystemEmoji[]>();
  for (const [emoji, data] of Object.entries(EMOJI_BY_CHAR)) {
    const bucket = byGroup.get(data.group) ?? [];
    bucket.push({ emoji, slug: data.slug, name: data.name });
    byGroup.set(data.group, bucket);
  }
  return [...byGroup.entries()].map(([group, emojis]) => ({ group, emojis }));
})();

/** Substring search across slug and name, for the picker's search box. */
export function filterSystemEmoji(query: string, limit = 120): SystemEmoji[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: SystemEmoji[] = [];
  for (const { emojis } of SYSTEM_EMOJI_GROUPS) {
    for (const emoji of emojis) {
      if (emoji.slug.includes(needle) || emoji.name.toLowerCase().includes(needle)) {
        results.push(emoji);
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
}

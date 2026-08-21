export interface ServerEmoji {
  id: string;
  name: string;
  imageUrl: string;
}

/** Reusable empty map so callers that never have server emoji (DMs) don't
 * allocate a new Map every render. */
export const EMPTY_EMOJI_MAP = new Map<string, ServerEmoji>();

/**
 * `<:name:id>` — the custom-emoji encoding convex/schema.ts documents for
 * `communityEmojis` (`id` is the emoji's Convex document id). Mirrors
 * crystal-mobile's src/components/chat/message-list.tsx CUSTOM_EMOJI_RE —
 * keep both in sync if this format ever changes.
 */
export const CUSTOM_EMOJI_RE_EXACT = /^<:([a-zA-Z0-9_]+):([a-zA-Z0-9]+)>$/;
export const CUSTOM_EMOJI_RE_GLOBAL = /<:([a-zA-Z0-9_]+):([a-zA-Z0-9]+)>/g;

export function parseCustomEmoji(raw: string): { name: string; id: string } | null {
  const match = raw.match(CUSTOM_EMOJI_RE_EXACT);
  return match ? { name: match[1]!, id: match[2]! } : null;
}

export function formatCustomEmoji(emoji: Pick<ServerEmoji, "name" | "id">): string {
  return `<:${emoji.name}:${emoji.id}>`;
}

/** URL scheme used to smuggle a custom-emoji id through markdown's `image`
 * AST node (see `substituteEmojiShortcodes` below and MessageContent's `img`
 * override) — markdown doesn't validate URL schemes, so this parses as a
 * normal image node without needing a raw-HTML/rehype-raw plugin. */
export const CUSTOM_EMOJI_IMAGE_SCHEME = "customemoji:";

/** `:slug:` shortcode — matches the character set unicode-emoji-json's slugs
 * actually use (verified: lowercase letters, digits, underscores only). */
export const SYSTEM_EMOJI_SHORTCODE_RE = /:([a-z0-9_]{2,64}):/g;

/**
 * Pre-processes raw message text before handing it to ReactMarkdown:
 *  1. `<:name:id>` custom-emoji tags become `![name](customemoji:id)` —
 *     a fake-scheme markdown image that flows through the existing `img`
 *     component override.
 *  2. `:slug:` shortcodes that resolve via `findSystemEmojiBySlug` become
 *     the literal emoji character.
 *
 * This is what makes `:name:` work even if a user types the full shortcode
 * and hits send without ever touching the composer's autocomplete dropdown
 * — the composer's autocomplete is just a convenience, not the only path.
 * Renderer-side conversion also means it works retroactively for messages
 * that already contain typed-out shortcodes.
 */
/** Matches an in-progress `:partial` shortcode immediately before the
 * cursor, e.g. while typing `:thum` — used to drive the composer's
 * `:name:` autocomplete dropdown. Intentionally more permissive than
 * `SYSTEM_EMOJI_SHORTCODE_RE` (allows `+`/`-` and uppercase) since it also
 * needs to match while a custom-emoji name is still being typed and the
 * closing `:` hasn't been typed yet. */
const IN_PROGRESS_SHORTCODE_RE = /:([a-zA-Z0-9_+-]{1,64})$/;

/** Given the textarea's full value and cursor position, returns the
 * in-progress shortcode being typed (if any) — its start/end offsets in
 * `value` (end is always the cursor position, since the match is anchored
 * immediately before it) and the partial text typed so far (without the
 * leading `:`). */
export function matchInProgressShortcode(
  value: string,
  cursorPos: number
): { start: number; end: number; query: string } | null {
  const before = value.slice(0, cursorPos);
  const match = before.match(IN_PROGRESS_SHORTCODE_RE);
  if (!match) return null;
  return { start: cursorPos - match[0].length, end: cursorPos, query: match[1]! };
}

export function substituteEmojiShortcodes(
  text: string,
  findSystemEmojiBySlug: (slug: string) => string | undefined
): string {
  const withCustomEmoji = text.replace(
    CUSTOM_EMOJI_RE_GLOBAL,
    (_match, name: string, id: string) => `![${name}](${CUSTOM_EMOJI_IMAGE_SCHEME}${id})`
  );
  return withCustomEmoji.replace(SYSTEM_EMOJI_SHORTCODE_RE, (match, slug: string) => {
    const emoji = findSystemEmojiBySlug(slug);
    return emoji ?? match;
  });
}

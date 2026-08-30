"use client";

import { useAccessibleEmojis } from "@/hooks/use-accessible-emojis";
import { TAG_OR_SHORTCODE_RE, type ServerEmoji } from "@/lib/custom-emoji";
import { findSystemEmojiBySlug } from "@/lib/system-emoji";
import { cn } from "@/lib/utils";

/**
 * One line of message text, as it should look outside a message list — the DM
 * sidebar's last line, the inbox, anywhere a conversation is summarised.
 *
 * These places were printing the stored text verbatim, which is not what
 * anybody wrote: a custom emoji is stored as `<:jeff:r17464nt3a7nb7x…>`, so a
 * sidebar row that had one in it showed a paragraph of identifier. The full
 * renderer is not the answer either — it is markdown, block layout, embeds and
 * mention resolution, none of which belong on a line that has to stay one line.
 *
 * So this is the middle: emoji become pictures, everything else stays text.
 */

/** A preview never gets taller than its line. Emoji are sized to the text
 * rather than to a fixed pixel so this works in the sidebar's `text-xs` and
 * the inbox's `text-xs` alike. */
const EMOJI_CLASS = "inline-block h-[1.15em] w-auto align-[-0.2em]";

export function MessagePreview({
  text,
  /** Rendered before the text, and never separated from it by the truncation —
   * the paperclip on a message that carried a file. */
  prefix,
  className,
}: {
  text: string;
  prefix?: string;
  className?: string;
}) {
  const { byId, byName } = useAccessibleEmojis();

  return (
    <span className={cn("truncate", className)}>
      {prefix ? `${prefix} ` : null}
      {segments(text, byId, byName).map((segment, index) =>
        segment.kind === "emoji" ? (
          <img
            // Index is a fine key: this list is rebuilt whole whenever the text
            // changes, and nothing in it holds state.
            key={index}
            src={segment.url}
            alt={`:${segment.name}:`}
            // The name, for an emoji from a server this reader has since left —
            // the tag still resolves to nothing, and `:jeff:` is a better
            // answer than a broken image.
            title={`:${segment.name}:`}
            className={EMOJI_CLASS}
            draggable={false}
          />
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </span>
  );
}

type Segment =
  | { kind: "text"; text: string }
  | { kind: "emoji"; url?: string; name: string };

/**
 * Split the text into runs of plain text and emoji.
 *
 * Both spellings, because both reach here. A message carries the full
 * `<:name:id>` tag, and that is what the DM sidebar prints — but a
 * notification body has already been through `renderMentionsAsText` on the
 * server, which flattens the tag to `:name:` so a push notification on a phone
 * has something readable to show. The inbox reads those, so a bare shortcode
 * has to resolve too.
 *
 * A `:shortcode:` that turns out to be a *system* emoji is substituted in
 * place rather than split out — it resolves to a character, and a character is
 * text.
 */
function segments(
  text: string,
  byId: Map<string, ServerEmoji>,
  byName: Map<string, ServerEmoji>,
): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  let pending = "";

  /** Text accumulates until an emoji interrupts it, so `:a::b:` between two
   * words stays one run rather than three. */
  const flush = () => {
    if (pending) out.push({ kind: "text", text: pending });
    pending = "";
  };

  // A fresh regex per call: the exported one is module-level and `lastIndex`
  // is state.
  const pattern = new RegExp(TAG_OR_SHORTCODE_RE.source, "g");
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const [raw, tagName, tagId, shortcode] = match;
    pending += text.slice(last, match.index);
    last = match.index + raw.length;

    if (tagName && tagId) {
      flush();
      out.push({ kind: "emoji", name: tagName, url: byId.get(tagId)?.imageUrl });
      continue;
    }

    const custom = shortcode ? byName.get(shortcode) : undefined;
    if (custom) {
      flush();
      out.push({ kind: "emoji", name: custom.name, url: custom.imageUrl });
      continue;
    }
    // Not a custom one: a system emoji if it is anything, and the shortcode
    // itself if it is not.
    pending += (shortcode && findSystemEmojiBySlug(shortcode)) || raw;
  }

  pending += text.slice(last);
  flush();
  return out;
}

"use client";

import { Smile, X } from "lucide-react";
import { useState } from "react";

import { ReactionPickerContent } from "@/components/home/reaction-picker-content";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAccessibleEmojis } from "@/hooks/use-accessible-emojis";
import { formatCustomEmoji, parseCustomEmoji } from "@/lib/custom-emoji";
import { cn } from "@/lib/utils";

/**
 * One stored emoji, drawn.
 *
 * "Stored" is either a Unicode character or the `<:name:id>` tag the rest of
 * the app uses for custom emoji (see src/lib/custom-emoji.ts) — this is the
 * non-markdown counterpart to MessageContent's `img` override, for the places
 * that hold a single emoji in a field rather than inside a message body.
 *
 * A tag whose emoji has since been deleted, or that belongs to a server the
 * viewer isn't in, falls back to the placeholder rather than a broken image.
 */
export function EmojiGlyph({
  value,
  className,
  fallback = "🔊",
}: {
  value: string | undefined;
  className?: string;
  fallback?: string;
}) {
  const { byId } = useAccessibleEmojis();
  const custom = value ? parseCustomEmoji(value) : null;

  if (custom) {
    const emoji = byId.get(custom.id);
    if (emoji) {
      // eslint-disable-next-line @next/next/no-img-element
      return (
        <img
          src={emoji.imageUrl}
          alt={`:${emoji.name}:`}
          className={cn("size-[1em] shrink-0 object-contain", className)}
        />
      );
    }
    return <span className={className}>{fallback}</span>;
  }

  return <span className={className}>{value || fallback}</span>;
}

/**
 * Pick an emoji from the app's own picker, rather than typing one.
 *
 * The soundboard used to take its emoji as a four-character text input, which
 * meant reaching for the OS emoji panel and hoping — and it silently accepted
 * anything, including four letters. Going through `ReactionPickerContent` also
 * means custom server emoji become available everywhere this is used, since
 * that picker already offers every emoji the user can reach.
 */
export function EmojiSelect({
  value,
  onChange,
  placeholder = "Click to select",
  className,
}: {
  /** Unicode character or `<:name:id>`; empty for nothing chosen. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-transparent px-3 text-sm transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {value ? (
              <EmojiGlyph value={value} className="text-base leading-none" fallback="🔊" />
            ) : (
              <Smile className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className={cn("truncate", !value && "text-muted-foreground")}>
              {value ? "Change" : placeholder}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <ReactionPickerContent
            onSelect={(text, custom) => {
              // Custom emoji are stored as the `<:name:id>` tag, not the
              // `:name:` shortcode the composer wants — a name lookup would
              // need the viewer to share a server with whoever chose it.
              onChange(custom ? formatCustomEmoji(custom) : text);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>

      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear emoji"
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

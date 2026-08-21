"use client";

import { useQuery } from "convex/react";
import { EmojiPicker } from "frimousse";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { formatCustomEmoji } from "@/lib/custom-emoji";

/** The emoji-picker body shared by the message hover toolbar's react button
 * and the message context menu's "React" submenu. When `communityId` is
 * provided (channel messages only — DMs have no community, so custom emoji
 * are channel-only), shows the community's custom emoji in a section above
 * the regular Unicode picker. */
export function ReactionPickerContent({
  communityId,
  onSelect,
}: {
  communityId?: Id<"communities">;
  onSelect: (emoji: string) => void;
}) {
  const serverEmojis = useQuery(
    api.communityEmojis.list,
    communityId ? { communityId } : "skip"
  );

  return (
    <div className="flex h-80 w-72 flex-col bg-popover">
      {serverEmojis && serverEmojis.length > 0 && (
        <div className="shrink-0 border-b p-2">
          <p className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">Server emojis</p>
          <div className="flex flex-wrap gap-1">
            {serverEmojis.map((emoji) => (
              <button
                key={emoji.id}
                type="button"
                title={`:${emoji.name}:`}
                onClick={() => onSelect(formatCustomEmoji(emoji))}
                className="flex size-8 items-center justify-center rounded-md hover:bg-accent"
              >
                <img src={emoji.imageUrl} alt={emoji.name} className="size-6 object-contain" />
              </button>
            ))}
          </div>
        </div>
      )}

      <EmojiPicker.Root
        className="isolate flex min-h-0 flex-1 flex-col bg-popover"
        onEmojiSelect={({ emoji }) => onSelect(emoji)}
      >
        <EmojiPicker.Search className="z-10 mx-2 mt-2 rounded-md border bg-background px-2 py-1 text-sm outline-none" />
        <EmojiPicker.Viewport className="relative flex-1 outline-none">
          <EmojiPicker.Loading className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Loading…
          </EmojiPicker.Loading>
          <EmojiPicker.Empty className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            No emoji found.
          </EmojiPicker.Empty>
          <EmojiPicker.List className="pb-2" />
        </EmojiPicker.Viewport>
      </EmojiPicker.Root>
    </div>
  );
}

"use client";

import { EmojiPicker } from "frimousse";

/** The emoji-picker body shared by the message hover toolbar's react button
 * and the message context menu's "React" submenu. */
export function ReactionPickerContent({ onSelect }: { onSelect: (emoji: string) => void }) {
  return (
    <EmojiPicker.Root
      className="isolate flex h-80 w-72 flex-col bg-popover"
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
  );
}

"use client";

import { Sticker as StickerIcon } from "lucide-react";

/**
 * A community sticker as a message: drawn on its own at about 160px with no frame, the way a KLIPY
 * sticker is (see `MessageAttachment`). A sticker whose community deleted it has no picture left,
 * so it shows a quiet placeholder instead of a broken image.
 */
export function MessageSticker({ sticker }: { sticker: { id: string; name: string; imageUrl: string | null } }) {
  if (!sticker.imageUrl) {
    return (
      <div className="mt-1 flex size-40 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted-foreground">
        <StickerIcon className="size-6" />
        Deleted sticker
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={sticker.imageUrl} alt={sticker.name} title={sticker.name} className="mt-1 block size-40 object-contain" loading="lazy" decoding="async" draggable={false} />
  );
}

"use client";

import { LOUNGE_STICKERS } from "../../../convex/lib/loungeStickers";
import { CustomEmojiImage } from "@/components/custom-emoji-image";
import { cn } from "@/lib/utils";

/**
 * A sticker, drawn from its id: a coloured label with a thick white edge, like
 * a die-cut vinyl one. Drawn rather than shipped as pictures so there is nothing
 * to download and every size is sharp.
 */
export function StickerArt({ id, className }: { id: string; className?: string }) {
  const sticker = LOUNGE_STICKERS.find((s) => s.id === id);
  if (!sticker) return null;
  const long = sticker.label.length > 5;
  return (
    <svg viewBox="0 0 120 80" className={cn("drop-shadow-[0_3px_5px_rgba(0,0,0,0.45)]", className)} aria-label={sticker.label} role="img">
      <rect x="3" y="3" width="114" height="74" rx="22" fill="#fff" />
      <rect x="9" y="9" width="102" height="62" rx="17" fill={`hsl(${sticker.hue} 82% 52%)`} />
      <rect x="9" y="9" width="102" height="28" rx="17" fill="#fff" opacity="0.16" />
      <text
        x="60"
        y="52"
        textAnchor="middle"
        fontSize={long ? 24 : 32}
        fontWeight="900"
        fill="#fff"
        stroke={`hsl(${sticker.hue} 70% 28%)`}
        strokeWidth="1"
        paintOrder="stroke"
        style={{ fontFamily: "ui-rounded, 'Arial Rounded MT Bold', system-ui, sans-serif", letterSpacing: "0.5px" }}
      >
        {sticker.label}
      </text>
    </svg>
  );
}

/** A sticker as it was sent: a built-in one, or a server's custom emoji at
 * sticker size. */
export function Sticker({
  sticker,
  className,
}: {
  sticker: { source: "builtin" | "emoji"; id: string; imageUrl?: string };
  className?: string;
}) {
  if (sticker.source === "builtin") return <StickerArt id={sticker.id} className={className} />;
  if (!sticker.imageUrl) return null;
  return (
    <span className={cn("inline-block rounded-2xl bg-white p-1.5 shadow-lg shadow-black/40", className)}>
      <CustomEmojiImage src={sticker.imageUrl} name="sticker" className="size-full object-contain" />
    </span>
  );
}

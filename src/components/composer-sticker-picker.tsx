"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Lock, Search, X } from "lucide-react";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { GLASS_BASE, GLASS_DARK } from "@/components/sidebar/glass";
import { Input } from "@/components/ui/input";
import { useSmoothScroll } from "@/hooks/use-smooth-scroll";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";

/** The attribute on the button that opens it, so pressing that button to close it isn't also read as pressing outside. */
export const STICKER_TRIGGER_ATTRIBUTE = "data-sticker-trigger";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };

export interface PickedSticker {
  id: Id<"communityStickers">;
  name: string;
  imageUrl: string;
  communityId: Id<"communities">;
}

/**
 * The composer's community sticker picker: a card that grows out of the composer's top-right corner, the same
 * shape and motion as the emoji and GIF pickers beside it (see `ComposerEmojiPicker`). Render it inside the same
 * `relative` box.
 *
 * Lists every sticker from every server you are in, this one first. Another server's are shown dimmed and can't be
 * chosen unless `canUseExternal` is true (the Use External Stickers permission, which the server checks again when
 * the message is sent). Choosing one sends it, so the caller closes the picker.
 */
export function ComposerStickerPicker({
  open,
  onClose,
  onSelect,
  communityId,
  canUseExternal,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (sticker: PickedSticker) => void;
  communityId: Id<"communities">;
  canUseExternal: boolean;
}) {
  const card = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useSmoothScroll(scroller);
  const [text, setText] = useState("");

  // Only asked for while open: the set spans every server, and most of the time nobody is looking at it.
  const groups = useQuery(api.communityStickers.listAccessible, open ? {} : "skip");
  const permissions = useQuery(api.roles.myPermissions, open ? { communityId } : "skip") ?? 0;
  const canCreate = hasPermission(permissions, PERMISSIONS.MANAGE_EMOJIS) || hasPermission(permissions, PERMISSIONS.CREATE_EXPRESSIONS);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target || card.current?.contains(target) || target.closest(`[${STICKER_TRIGGER_ATTRIBUTE}]`)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  // This server's first, the rest as the query ordered them; a search narrows every group and drops the empty ones.
  const shown = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return [...(groups ?? [])]
      .sort((a, b) => Number(b.communityId === communityId) - Number(a.communityId === communityId))
      .map((g) => ({ ...g, stickers: needle ? g.stickers.filter((s) => s.name.includes(needle)) : g.stickers }))
      .filter((g) => g.stickers.length > 0);
  }, [groups, communityId, text]);

  const hasHere = (groups ?? []).some((g) => g.communityId === communityId);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={card}
          key="sticker-picker"
          role="dialog"
          aria-label="Stickers"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={SPRING}
          className={cn(GLASS_BASE, GLASS_DARK, "absolute right-0 bottom-full z-30 rounded-b-none border-b-0", "shadow-[0_-10px_16px_-8px_rgb(0_0_0/0.3)]")}
        >
          <div className="flex h-[26rem] w-[26rem] max-w-[calc(100vw-2rem)] flex-col">
            <div className="relative shrink-0 p-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search stickers" className="h-8 pl-7 pr-7 text-sm" autoFocus />
              {text && (
                <button type="button" onClick={() => setText("")} aria-label="Clear search" className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            <div ref={scroller} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-2">
              {shown.map((group) => {
                const external = group.communityId !== communityId;
                const locked = external && !canUseExternal;
                return (
                  <section key={group.communityId} className="mb-3">
                    <header className="sticky top-0 z-10 flex items-center gap-1.5 px-1 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur-md">
                      {group.communityImageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={group.communityImageUrl} alt="" className="size-4 rounded-sm object-cover" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{group.communityName}</span>
                    </header>
                    {locked && (
                      <p className="mb-1 flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
                        <Lock className="size-3 shrink-0" />
                        Needs Use External Stickers permission here
                      </p>
                    )}
                    <div className="grid grid-cols-4 gap-1.5">
                      {group.stickers.map((sticker) => (
                        <button
                          key={sticker.id}
                          type="button"
                          disabled={locked}
                          onClick={() => onSelect({ id: sticker.id, name: sticker.name, imageUrl: sticker.imageUrl, communityId: group.communityId })}
                          title={locked ? `${sticker.name} (needs Use External Stickers)` : sticker.name}
                          aria-label={locked ? `${sticker.name}, needs Use External Stickers permission` : `Send ${sticker.name}`}
                          className={cn(
                            "flex aspect-square items-center justify-center rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            locked ? "cursor-not-allowed opacity-40 grayscale" : "cursor-pointer transition-colors hover:bg-accent",
                          )}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={sticker.imageUrl} alt={sticker.name} loading="lazy" decoding="async" draggable={false} className="size-full object-contain" />
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}

              {groups === undefined && <p className="px-4 py-10 text-center text-sm text-muted-foreground">Loading stickers…</p>}

              {groups !== undefined && shown.length === 0 && text.trim() && (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing found for “{text.trim()}”.</p>
              )}

              {groups !== undefined && shown.length === 0 && !text.trim() && (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No stickers in your servers yet.
                  {canCreate ? " Add some in Server Settings > Emojis." : " Ask someone who manages this server to add some."}
                </p>
              )}

              {groups !== undefined && !hasHere && shown.length > 0 && !text.trim() && (
                <p className="px-2 pb-2 text-center text-xs text-muted-foreground">
                  This server has no stickers yet.{canCreate ? " Add some in Server Settings > Emojis." : ""}
                </p>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

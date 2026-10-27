"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";

import { ReactionPickerContent } from "@/components/home/reaction-picker-content";
import { GLASS_BASE, GLASS_DARK } from "@/components/sidebar/glass";
import { cn } from "@/lib/utils";

/** The attribute on the button that opens it, so pressing that button to close
 * it isn't also read as pressing outside. */
export const EMOJI_TRIGGER_ATTRIBUTE = "data-emoji-trigger";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };

/**
 * The composer's emoji picker, as a small card that grows out of the composer's
 * top-right corner — standing directly on it, above the emoji button — rather
 * than a popover floating over the page.
 *
 * The same surface as the composer itself and the call card (`GLASS_DARK`), and
 * the same motion as the user card's device pickers: a spring on the height,
 * from nothing, with the content revealed as it opens. Anchored to the bottom
 * so it grows upward away from the composer.
 *
 * Render it inside a `relative` box that wraps exactly the composer's input box, so
 * "on top of it" means flush against it. It is open until it is
 * closed — picking an emoji doesn't close it, so several can go in at once —
 * and closes on Escape or on a press anywhere outside it and its button.
 */
export function ComposerEmojiPicker({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (text: string) => void;
}) {
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (card.current?.contains(target)) return;
      if (target.closest(`[${EMOJI_TRIGGER_ATTRIBUTE}]`)) return;
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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={card}
          key="emoji-picker"
          role="dialog"
          aria-label="Emoji"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={SPRING}
          // No gap and no bottom edge: it stands on the composer, flush with its
          // right side, and the composer squares off the corner they share.
          className={cn(
            GLASS_BASE,
            GLASS_DARK,
            "absolute right-0 bottom-full z-30 rounded-b-none border-b-0",
            // The card's usual shadow falls downward, onto the composer it is
            // standing on. This one is lifted and pulled in at the sides, so it
            // only shows above and beside the card.
            "shadow-[0_-10px_16px_-8px_rgb(0_0_0/0.3)]",
          )}
        >
          <ReactionPickerContent glass onSelect={onSelect} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

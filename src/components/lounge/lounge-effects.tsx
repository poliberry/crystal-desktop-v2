"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Megaphone } from "lucide-react";

import { Sticker } from "@/components/lounge/sticker-art";
import { CustomEmojiImage } from "@/components/custom-emoji-image";
import { useAccessibleEmojis } from "@/hooks/use-accessible-emojis";
import { parseCustomEmoji } from "@/lib/custom-emoji";
import { cn } from "@/lib/utils";

/** Something somebody just said, on its way to being forgotten. */
export interface LoungeEvent {
  id: string;
  authorId: string;
  kind: "text" | "image" | "emoji" | "sticker";
  text?: string;
  emoji?: string;
  imageUrl?: string;
  sticker?: { source: "builtin" | "emoji"; id: string; imageUrl?: string };
  at: number;
}

/** How long each kind stays on screen. */
export const EVENT_TTL: Record<LoungeEvent["kind"], number> = {
  text: 7000,
  image: 8000,
  emoji: 3800,
  sticker: 6500,
};

/** An emoji, unicode or a server's custom one. */
export function EmojiToken({ value, className }: { value: string; className?: string }) {
  const { byId } = useAccessibleEmojis();
  const custom = parseCustomEmoji(value);
  if (!custom) return <span className={className}>{value}</span>;
  const emoji = byId.get(custom.id);
  return emoji ? (
    <CustomEmojiImage src={emoji.imageUrl} name={emoji.name} className={cn("inline-block object-contain", className)} />
  ) : (
    <span className={className}>:{custom.name}:</span>
  );
}

/** A stable pseudo-random number in [-1, 1] from an id, so every screen shows
 * the same sticker at the same angle. */
function jitter(id: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  return ((h % 2000) / 1000) - 1;
}

/**
 * Everything that happens around one avatar when its owner speaks.
 *
 *   - text and pictures come up as speech bubbles, stack, and drift away;
 *   - an emoji floats up out of them and fades;
 *   - a sticker is slapped on to the avatar itself, and peels off after a while.
 *
 * Absolutely positioned against the avatar, so it moves with them.
 */
export function AvatarEffects({ events }: { events: LoungeEvent[] }) {
  const bubbles = events.filter((e) => e.kind === "text" || e.kind === "image").slice(-3);
  const emojis = events.filter((e) => e.kind === "emoji");
  const stickers = events.filter((e) => e.kind === "sticker").slice(-2);

  return (
    <>
      {/* Bubbles stack upward, newest nearest the avatar. */}
      <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 flex w-[20cqw] -translate-x-1/2 flex-col-reverse items-center gap-1">
        <AnimatePresence initial={false}>
          {bubbles
            .slice()
            .reverse()
            .map((e, i) => (
              <motion.div
                key={e.id}
                layout
                initial={{ opacity: 0, y: 14, scale: 0.7 }}
                animate={{ opacity: 1 - i * 0.18, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -22, scale: 0.9, transition: { duration: 0.6 } }}
                transition={{ type: "spring", stiffness: 520, damping: 28 }}
                className="relative max-w-full rounded-2xl rounded-bl-md border border-white/20 bg-neutral-900/85 px-3 py-1.5 text-center text-[1.15cqw] leading-snug font-medium break-words text-white shadow-lg [font-size:clamp(10px,0.95cqw,14px)]"
              >
                {e.kind === "image" && e.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.imageUrl} alt="" className="max-h-[8cqw] max-w-full rounded-lg object-cover" draggable={false} />
                ) : (
                  <span className="line-clamp-4">{e.text}</span>
                )}
              </motion.div>
            ))}
        </AnimatePresence>
      </div>

      {/* Emoji float up and out. Each one drifts a little to its own side. */}
      <AnimatePresence>
        {emojis.map((e) => {
          const drift = jitter(e.id, 7) * 5;
          return (
            <motion.div
              key={e.id}
              className="pointer-events-none absolute bottom-[85%] left-1/2 z-40 leading-none select-none [font-size:clamp(20px,2.4cqw,34px)]"
              initial={{ opacity: 0, y: 10, x: `calc(-50% + ${drift * 0.2}cqw)`, scale: 0.4 }}
              animate={{
                opacity: [0, 1, 1, 0],
                y: [10, -20, -70, -130],
                x: [`calc(-50% + ${drift * 0.2}cqw)`, `calc(-50% + ${drift * 0.7}cqw)`, `calc(-50% + ${drift * 0.2}cqw)`, `calc(-50% + ${drift}cqw)`],
                scale: [0.4, 1.15, 1, 0.9],
                rotate: [0, jitter(e.id, 3) * 12, jitter(e.id, 5) * -10, 0],
              }}
              transition={{ duration: EVENT_TTL.emoji / 1000, ease: "easeOut", times: [0, 0.18, 0.7, 1] }}
            >
              <EmojiToken value={e.emoji ?? ""} className="size-[1em] align-middle" />
            </motion.div>
          );
        })}
      </AnimatePresence>

      {/* Stickers get slapped on. */}
      <AnimatePresence>
        {stickers.map((e, i) =>
          e.sticker ? (
            <motion.div
              key={e.id}
              className="pointer-events-none absolute top-1/2 left-1/2 z-40 w-[88%]"
              style={{ x: `calc(-50% + ${jitter(e.id, 11) * 8 + i * 6}%)`, y: `calc(-50% + ${jitter(e.id, 13) * 8 - i * 8}%)` }}
              initial={{ opacity: 0, scale: 2.6, rotate: jitter(e.id, 17) * 40 - 18 }}
              animate={{ opacity: 1, scale: 1, rotate: jitter(e.id, 19) * 14 }}
              exit={{ opacity: 0, scale: 0.85, y: "-40%", rotate: jitter(e.id, 23) * 24, transition: { duration: 0.5 } }}
              transition={{ type: "spring", stiffness: 700, damping: 17, mass: 0.7 }}
            >
              <Sticker sticker={e.sticker} className="size-full" />
              {/* The slap: a ring that flashes out from the point of impact. */}
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-3xl border-2 border-white/70"
                initial={{ opacity: 0.9, scale: 1 }}
                animate={{ opacity: 0, scale: 1.5 }}
                transition={{ duration: 0.45, delay: 0.08 }}
              />
            </motion.div>
          ) : null,
        )}
      </AnimatePresence>
    </>
  );
}

/** A megaphone beside someone while their soundboard clip plays: it shakes with
 * the sound and sends rings outward. */
export function Megaphones({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="pointer-events-none absolute top-[8%] left-[88%] z-40 text-amber-300"
          initial={{ opacity: 0, scale: 0.3, rotate: -40, x: -10 }}
          animate={{ opacity: 1, scale: 1, rotate: 0, x: 0 }}
          exit={{ opacity: 0, scale: 0.4, rotate: 30 }}
          transition={{ type: "spring", stiffness: 560, damping: 20 }}
        >
          <motion.div
            animate={{ rotate: [-6, 6, -6], scale: [1, 1.12, 1] }}
            transition={{ duration: 0.28, repeat: Infinity, ease: "easeInOut" }}
          >
            <Megaphone className="size-[2.4cqw] min-h-5 min-w-5 drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]" fill="currentColor" strokeWidth={1.6} />
          </motion.div>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              aria-hidden
              className="absolute top-1/2 left-full size-[1.8cqw] min-h-3 min-w-3 -translate-y-1/2 rounded-full border-2 border-amber-300/80"
              style={{ animation: `lounge-wave 0.9s ease-out ${i * 0.28}s infinite` }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

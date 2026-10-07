"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAccessibility } from "@/components/accessibility-provider";
import { EmojiGlyph } from "@/components/home/emoji-select";
import { onSoundboardEmoji } from "@/lib/soundboard";

/**
 * The emoji of a soundboard clip, played out over the tile of whoever pressed
 * it — for everyone in the call, since each client draws it from the same
 * packet that makes the sound.
 *
 * Each press picks one of three effects at random, so a run of them doesn't
 * look like one animation on a loop:
 *
 *  - **drop**     one big emoji falls from the top, hits the bottom, squashes,
 *                 and bursts into a spray of small ones;
 *  - **explode**  a burst from a point in the tile, thrown out and pulled down;
 *  - **wave**     a line of them raining down across the whole width, one after
 *                 another.
 *
 * It lives in a layer that clips to the tile, so nothing ever leaves it, and
 * takes no clicks. Sizes come from the tile's own size when the press arrives, so
 * the same effect is right on a thumbnail and on a focused tile.
 */

type Effect = "drop" | "explode" | "wave";
const EFFECTS: Effect[] = ["drop", "explode", "wave"];

/** One thing moving: where it starts, where it goes through, and when. All in
 * pixels of the tile, since that is what the animation is measured in. */
interface Particle {
  id: number;
  size: number;
  delay: number;
  duration: number;
  /** Keyframes, as offsets from the particle's start. */
  x: number[];
  y: number[];
  rotate: number[];
  scale: number[];
  opacity: number[];
  /** Where in the tile it starts. */
  left: number;
  top: number;
  /** Fractions of `duration` the keyframes land on. */
  times?: number[];
  ease?: "linear" | "easeIn" | "easeOut" | "easeInOut";
}

interface Burst {
  id: number;
  emoji: string;
  /** `<:name:id>` rather than a unicode character. */
  custom: boolean;
  particles: Particle[];
  /** When the last particle finishes, in ms from now. */
  endsIn: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)]!;

let nextId = 1;

/** The spray that comes out of a landing or an explosion, from `(cx, cy)`. */
function spray(
  count: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
  base: number,
  delay: number,
  spread: number,
): Particle[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 + rand(-0.3, 0.3);
    const power = rand(0.5, 1) * spread;
    const dx = Math.cos(angle) * power;
    // Thrown upward-biased, then gravity takes it to the floor.
    const dy = Math.sin(angle) * power * 0.8 - spread * 0.25;
    const floor = Math.max(0, h - cy - base * 0.2);
    return {
      id: nextId++,
      size: base * rand(0.55, 1),
      delay: delay + rand(0, 0.06),
      duration: rand(0.9, 1.3),
      left: cx,
      top: cy,
      x: [0, dx * 0.7, dx],
      y: [0, dy, Math.min(floor, Math.max(dy, 0) + h * rand(0.15, 0.4))],
      rotate: [0, rand(-200, 200), rand(-360, 360)],
      scale: [0.3, 1, 0.7],
      opacity: [0, 1, 0],
      times: [0, 0.35, 1],
      ease: "easeOut",
    } satisfies Particle;
  });
}

/** Build one burst for a tile of `w`×`h`. */
function makeBurst(emoji: string, w: number, h: number): Burst {
  const effect = pick(EFFECTS);
  // The size every effect is measured against: a fifth of the shorter side,
  // within what is still readable and what doesn't swamp a thumbnail.
  const unit = Math.max(22, Math.min(72, Math.min(w, h) * 0.2));
  const particles: Particle[] = [];

  if (effect === "drop") {
    const big = unit * 1.7;
    const x = rand(w * 0.25, w * 0.75);
    const landing = Math.max(h - big * 1.15, big);
    particles.push({
      id: nextId++,
      size: big,
      delay: 0,
      duration: 0.95,
      left: x - big / 2,
      top: 0,
      x: [0, 0, 0, 0],
      // Falls from above the edge, lands, squashes into the floor, then is gone.
      y: [-big * 1.4, landing, landing - big * 0.35, landing],
      scale: [1, 1, 1.05, 0],
      rotate: [rand(-25, 25), rand(-10, 10), 0, 0],
      opacity: [1, 1, 1, 0],
      times: [0, 0.5, 0.62, 1],
      ease: "easeIn",
    });
    particles.push(...spray(10, x, landing + big / 2, w, h, unit * 0.8, 0.5, Math.min(w, h) * 0.45));
  } else if (effect === "explode") {
    const cx = rand(w * 0.3, w * 0.7);
    const cy = rand(h * 0.35, h * 0.6);
    particles.push(...spray(14, cx, cy, w, h, unit, 0, Math.min(w, h) * 0.55));
  } else {
    const count = Math.max(8, Math.min(16, Math.round(w / (unit * 0.9))));
    for (let i = 0; i < count; i++) {
      const size = unit * rand(0.65, 1.1);
      const x = (i + rand(0.2, 0.8)) * (w / count);
      const sway = rand(-18, 18);
      particles.push({
        id: nextId++,
        size,
        // A wave: each starts a little after the one beside it.
        delay: i * 0.06 + rand(0, 0.05),
        duration: rand(0.95, 1.25),
        left: x - size / 2,
        top: 0,
        x: [0, sway, -sway * 0.4],
        y: [-size * 1.3, h * 0.55, h + size],
        rotate: [rand(-30, 30), rand(-60, 60), rand(-120, 120)],
        scale: [1, 1, 0.9],
        opacity: [0, 1, 1],
        times: [0, 0.55, 1],
        ease: "easeIn",
      });
    }
  }

  const endsIn = Math.max(...particles.map((p) => (p.delay + p.duration) * 1000)) + 80;
  return { id: nextId++, emoji, custom: emoji.startsWith("<"), particles, endsIn };
}

/** At most this many effects at once on one tile: somebody leaning on the button
 * should get a busy tile, not a frozen one. */
const MAX_BURSTS = 3;

/**
 * The layer itself. Put it inside a tile that clips (`overflow-hidden`) and is
 * `relative`; `identity` is the participant it belongs to.
 */
export function SoundboardBurst({ identity }: { identity: string }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [bursts, setBursts] = useState<Burst[]>([]);
  // The app's own "Reduce motion" setting as well as the system's: this is the
  // kind of decoration that setting exists to turn off.
  const { reducedMotion } = useAccessibility();

  const finish = useCallback((id: number) => {
    setBursts((current) => current.filter((burst) => burst.id !== id));
  }, []);

  useEffect(
    () =>
      onSoundboardEmoji((who, emoji) => {
        if (who !== identity) return;
        if (reducedMotion || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
          if (process.env.NODE_ENV !== "production") {
            console.debug("[soundboard] emoji effect skipped: reduced motion is on");
          }
          return;
        }
        const box = layerRef.current?.getBoundingClientRect();
        // A tile that isn't on screen has nothing to draw into.
        if (!box || box.width < 40 || box.height < 40) {
          if (process.env.NODE_ENV !== "production") {
            console.debug("[soundboard] emoji effect skipped: tile too small", box?.width, box?.height);
          }
          return;
        }
        const burst = makeBurst(emoji, box.width, box.height);
        setBursts((current) => [...current.slice(-(MAX_BURSTS - 1)), burst]);
        // Removed on a timer rather than on the last particle's callback: a
        // burst that is replaced by a newer one would otherwise never report
        // finishing, and be left behind.
        window.setTimeout(() => finish(burst.id), burst.endsIn);
      }),
    [identity, finish, reducedMotion],
  );

  return (
    <div
      ref={layerRef}
      aria-hidden
      // Above the avatar and the video, below the name tag — it is a thing
      // happening in the tile, not a label on it.
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden select-none"
    >
      {bursts.map((burst) =>
        burst.particles.map((particle) => (
          <motion.span
            key={particle.id}
            className="absolute leading-none"
            style={{
              left: particle.left,
              top: particle.top,
              fontSize: particle.size,
              width: particle.size,
              height: particle.size,
              willChange: "transform, opacity",
            }}
            initial={{
              x: particle.x[0],
              y: particle.y[0],
              rotate: particle.rotate[0],
              scale: particle.scale[0],
              opacity: 0,
            }}
            animate={{
              x: particle.x,
              y: particle.y,
              rotate: particle.rotate,
              scale: particle.scale,
              opacity: particle.opacity,
            }}
            transition={{
              duration: particle.duration,
              delay: particle.delay,
              times: particle.times,
              ease: particle.ease ?? "easeOut",
            }}
          >
            {/* Only a custom server emoji needs looking up — and that is a query
                per glyph, which a burst of twenty should not run for a plain one. */}
            {burst.custom ? (
              <EmojiGlyph value={burst.emoji} className="block text-[1em] leading-none" />
            ) : (
              <span className="block text-[1em] leading-none">{burst.emoji}</span>
            )}
          </motion.span>
        )),
      )}
    </div>
  );
}

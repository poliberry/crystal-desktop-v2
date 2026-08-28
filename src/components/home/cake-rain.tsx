"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo } from "react";

import { useAccessibility } from "@/components/accessibility-provider";
import { scatter } from "@/lib/celebration";

/** Cakes on screen at once. Enough to read as a shower, few enough that the
 * conversation underneath is still usable while it happens. */
const COUNT = 26;

/** How long the whole thing runs before it takes itself off screen. Covers the
 * slowest cake's fall plus its start delay. */
const RUN_MS = 7000;

interface Cake {
  id: number;
  /** Viewport percentage across. */
  left: number;
  size: number;
  delay: number;
  duration: number;
  drift: number;
  spin: number;
}

function makeCakes(): Cake[] {
  return Array.from({ length: COUNT }, (_, i) => ({
    id: i,
    left: scatter(i, 2) * 100,
    size: 20 + scatter(i, 3) * 22,
    delay: scatter(i, 4) * 2.2,
    duration: 3.6 + scatter(i, 5) * 2.4,
    drift: (scatter(i, 6) - 0.5) * 180,
    spin: (scatter(i, 7) - 0.5) * 540,
  }));
}

/**
 * Cakes falling down the whole window, for a birthday wish being sent.
 *
 * The counterpart to the gift overlay's confetti, which rises: this one falls,
 * and unlike the celebration it's a one-shot with no dialog and nothing to
 * dismiss — it plays over whatever the two people were doing and gets out of
 * the way. Both ends of the conversation mount it off the same message, so the
 * wish and the reaction to it happen at the same moment for both of them.
 *
 * Nothing is rendered when the user has asked for reduced motion; `onDone` is
 * still called, so the parent's "a wish is playing" state doesn't stick.
 */
export function CakeRain({ onDone }: { onDone: () => void }) {
  const { reducedMotion } = useAccessibility();
  const cakes = useMemo(makeCakes, []);

  useEffect(() => {
    const timer = setTimeout(onDone, reducedMotion ? 0 : RUN_MS);
    return () => clearTimeout(timer);
  }, [onDone, reducedMotion]);

  if (reducedMotion) return null;

  return (
    <div
      aria-hidden
      // Above the app, below nothing it needs to block: the layer takes no
      // pointer events at all, so a message can still be sent mid-shower.
      className="pointer-events-none fixed inset-0 z-100 overflow-hidden"
    >
      {cakes.map((cake) => (
        <motion.span
          key={cake.id}
          className="absolute top-0 block leading-none select-none"
          style={{ left: `${cake.left}%`, fontSize: cake.size }}
          initial={{ y: "-15vh", opacity: 0 }}
          animate={{
            y: "115vh",
            x: cake.drift,
            rotate: cake.spin,
            opacity: [0, 1, 1, 0],
          }}
          transition={{
            duration: cake.duration,
            delay: cake.delay,
            ease: "linear",
            // Fades in as it clears the top edge and out before it lands,
            // rather than blinking out of existence at the bottom.
            opacity: {
              duration: cake.duration,
              delay: cake.delay,
              times: [0, 0.1, 0.85, 1],
            },
          }}
        >
          🎂
        </motion.span>
      ))}
    </div>
  );
}

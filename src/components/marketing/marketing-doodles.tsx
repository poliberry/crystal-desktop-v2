import styles from "./marketing-page.module.css";

/*
 * Hand-drawn marks for the landing page: a scribbled underline, arrows, a ring
 * and a sparkle. Plain SVG strokes with `pathLength="1"` so the shared `draw`
 * animation can pen them in whatever their real length is. All decorative, so
 * all `aria-hidden`.
 */

type DoodleProps = { className?: string; animate?: boolean };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function Underline({ className, animate = true }: DoodleProps) {
  return (
    <svg viewBox="0 0 300 24" aria-hidden className={className} preserveAspectRatio="none">
      <path
        {...stroke}
        strokeWidth={5}
        pathLength={1}
        className={animate ? styles.draw : undefined}
        d="M4 16c38-7 81-11 128-9 39 2 75 7 108 4 18-2 36-5 56-9M30 20c52-5 109-6 170-2"
      />
    </svg>
  );
}

export function ArrowCurl({ className, animate = true }: DoodleProps) {
  return (
    <svg viewBox="0 0 120 90" aria-hidden className={className}>
      <path
        {...stroke}
        strokeWidth={3}
        pathLength={1}
        className={animate ? styles.draw : undefined}
        d="M6 10c22-6 50 0 58 20 6 15-6 28-17 22-12-7 0-27 18-27 22 0 40 22 46 50m0 0-14-8m14 8 6-15"
      />
    </svg>
  );
}

/** Leaves from the bottom left, swings up and lands pointing straight up. */
export function ArrowUp({ className, animate = true }: DoodleProps) {
  return (
    <svg viewBox="0 0 60 90" aria-hidden className={className}>
      <path
        {...stroke}
        strokeWidth={3}
        pathLength={1}
        className={animate ? styles.draw : undefined}
        d="M6 84c20-4 32-20 33-42 .5-12-1.5-24-3-36m0 0-10 11m10-11 9 12"
      />
    </svg>
  );
}

export function ArrowDown({ className, animate = true }: DoodleProps) {
  return (
    <svg viewBox="0 0 60 110" aria-hidden className={className}>
      <path
        {...stroke}
        strokeWidth={3}
        pathLength={1}
        className={animate ? styles.draw : undefined}
        d="M40 4C14 24 10 58 30 100m0 0-14-10m14 10 8-15"
      />
    </svg>
  );
}

export function Ring({ className, animate = true }: DoodleProps) {
  return (
    <svg viewBox="0 0 200 80" aria-hidden className={className} preserveAspectRatio="none">
      <path
        {...stroke}
        strokeWidth={3}
        pathLength={1}
        className={animate ? styles.draw : undefined}
        d="M118 8C64 2 10 14 6 38c-4 26 60 38 112 34 48-4 80-18 76-38C190 14 140 4 84 10"
      />
    </svg>
  );
}

export function Sparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path fill="currentColor" d="M12 1c.6 5.3 2.7 8.4 11 11-8.3 2.6-10.4 5.7-11 11-.6-5.3-2.7-8.4-11-11 8.3-2.6 10.4-5.7 11-11Z" />
    </svg>
  );
}

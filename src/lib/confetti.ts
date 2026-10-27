import { CONFETTI_COLOURS } from "@/lib/celebration";

/**
 * Throws confetti across the window and cleans up after itself.
 *
 * Imperative and attached to the document, not to a component, because the
 * moments that want it (finishing the create-community flow) are also moments
 * that navigate away: a component's confetti would be unmounted partway down.
 * Each piece is a plain element animated with the Web Animations API, so no
 * stylesheet is needed and nothing is left running once the last one lands.
 */
export function launchConfetti({ count = 140, duration = 3600 } = {}): void {
  if (typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "9999",
  });
  document.body.appendChild(layer);

  const width = window.innerWidth;
  const height = window.innerHeight;
  const animations: Animation[] = [];

  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div");
    const size = 6 + Math.random() * 8;
    const round = Math.random() < 0.3;
    Object.assign(piece.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: `${size}px`,
      height: round ? `${size}px` : `${size * 0.45}px`,
      borderRadius: round ? "50%" : "2px",
      background: CONFETTI_COLOURS[Math.floor(Math.random() * CONFETTI_COLOURS.length)],
      willChange: "transform, opacity",
    });
    layer.appendChild(piece);

    // Fired up from the bottom corners in two bursts that fan out and fall.
    const fromLeft = i % 2 === 0;
    const startX = fromLeft ? width * 0.1 : width * 0.9;
    const startY = height * 0.95;
    const spread = (Math.random() - 0.5) * width * 0.7;
    const peakX = startX + (fromLeft ? 1 : -1) * Math.random() * width * 0.35 + spread * 0.3;
    const peakY = height * (0.15 + Math.random() * 0.4);
    const endX = peakX + (Math.random() - 0.5) * 220;
    const endY = height + 40;
    const spin = (Math.random() - 0.5) * 1440;

    animations.push(
      piece.animate(
        [
          { transform: `translate(${startX}px, ${startY}px) rotate(0deg)`, opacity: 1 },
          {
            transform: `translate(${peakX}px, ${peakY}px) rotate(${spin / 2}deg)`,
            opacity: 1,
            offset: 0.4,
            easing: "cubic-bezier(0.3, 0, 0.9, 0.6)",
          },
          { transform: `translate(${endX}px, ${endY}px) rotate(${spin}deg)`, opacity: 0.9 },
        ],
        {
          duration: duration * (0.75 + Math.random() * 0.5),
          delay: Math.random() * 250,
          easing: "cubic-bezier(0.1, 0.7, 0.4, 1)",
          fill: "forwards",
        },
      ),
    );
  }

  Promise.allSettled(animations.map((a) => a.finished)).then(() => layer.remove());
  // A backstop, for a tab that was hidden while it ran.
  window.setTimeout(() => layer.remove(), duration * 2);
}

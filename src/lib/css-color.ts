let probe: CanvasRenderingContext2D | null = null;

function ctx2d(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  probe ??= (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    return c.getContext("2d", { willReadFrequently: true });
  })();
  return probe;
}

/**
 * Any CSS colour (`oklch()`, `hsl()`, a name…) as `#rrggbb`, or null if it isn't one. Drawn on a
 * one-pixel canvas and read back, so whatever the browser can parse works — which is what native
 * colour pickers and Monaco's themes need, as neither understands anything but hex.
 *
 * A translucent colour (`oklch(1 0 0 / 10%)`, as the app's borders are) has no single hex value of
 * its own, so it is laid over `over` first — the colour it will actually sit on — and the result
 * is what you'd see. Without `over` it's laid over black.
 */
export function cssToHex(value: string, over = "#000"): string | null {
  const c = ctx2d();
  if (!c) return null;
  c.clearRect(0, 0, 1, 1);
  c.fillStyle = "#000";
  c.fillStyle = over;
  c.fillRect(0, 0, 1, 1);
  const before = c.fillStyle;
  c.fillStyle = "#010203"; // a value no real colour here will equal, to tell "invalid" from "same as before"
  c.fillStyle = value;
  if (c.fillStyle === "#010203" && !/^#010203$/i.test(value.trim())) return null;
  void before;
  c.fillRect(0, 0, 1, 1);
  const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

const parse = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const toHex = (rgb: number[]) => `#${rgb.map((n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0")).join("")}`;

/** `t` of the way from `a` to `b` (both `#rrggbb`). */
export function mixHex(a: string, b: string, t: number): string {
  const [x, y] = [parse(a), parse(b)];
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

/** `#rrggbb` with an opacity from 0 to 1, as `#rrggbbaa`. */
export const withAlpha = (hex: string, alpha: number) => `${hex}${Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, "0")}`;

/** Perceived brightness, 0 (black) to 1 (white), for deciding whether a colour is "dark". */
export function luminance(hex: string): number {
  const [r, g, b] = parse(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Black or white, whichever reads on `hex`. */
export const readableOn = (hex: string) => (luminance(hex) > 0.4 ? "#000000" : "#ffffff");

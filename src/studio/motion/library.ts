import {
  defaultParticles, defaultTransform, newClip, type Clip, type ClipFx, type ClipFxType, type Ease, type Source, type TextAnim, type Transition, type TransitionKind,
} from "../../../convex/lib/motion";

/**
 * What the browser offers: generators, titles, effects and transitions, as plain data. Choosing one adds a clip (or an
 * effect, or a transition) with these settings; nothing here runs. Every preset is checked against the server's rules
 * in the tests, so none of them can be something that is refused on submission.
 */

export interface Preset<T> {
  id: string;
  label: string;
  group: string;
  make: (stage: { w: number; h: number }) => T;
}

const P = (over: Partial<ReturnType<typeof defaultParticles>>) => ({ type: "particles" as const, ...defaultParticles(), ...over });

type ClipMaker = { source: Source; name: string; duration?: number; transform?: Partial<Clip["transform"]>; blend?: Clip["blend"]; fx?: ClipFx[]; loop?: boolean };

export const GENERATORS: Preset<ClipMaker>[] = [
  // Shapes
  { id: "rect", label: "Rectangle", group: "Shapes", make: () => ({ name: "Rectangle", source: { type: "shape", shape: "rect", w: 200, h: 120, fill: "#8b5cf6", stroke: "#ffffff", strokeWidth: 0, radius: 16, points: 5, inner: 0.5 } }) },
  { id: "ellipse", label: "Circle", group: "Shapes", make: () => ({ name: "Circle", source: { type: "shape", shape: "ellipse", w: 160, h: 160, fill: "#22d3ee", stroke: "#ffffff", strokeWidth: 0, radius: 0, points: 5, inner: 0.5 } }) },
  { id: "star", label: "Star", group: "Shapes", make: () => ({ name: "Star", source: { type: "shape", shape: "star", w: 160, h: 160, fill: "#fbbf24", stroke: "#ffffff", strokeWidth: 0, radius: 0, points: 5, inner: 0.5 } }) },
  { id: "heart", label: "Heart", group: "Shapes", make: () => ({ name: "Heart", source: { type: "shape", shape: "heart", w: 160, h: 150, fill: "#f43f5e", stroke: "#ffffff", strokeWidth: 0, radius: 0, points: 5, inner: 0.5 } }) },
  { id: "ring", label: "Ring", group: "Shapes", make: () => ({ name: "Ring", source: { type: "shape", shape: "ring", w: 200, h: 200, fill: "#ffffff", stroke: "#ffffff", strokeWidth: 10, radius: 0, points: 5, inner: 0.5 } }) },
  { id: "line", label: "Line", group: "Shapes", make: () => ({ name: "Line", source: { type: "shape", shape: "line", w: 300, h: 6, fill: "#ffffff", stroke: "#ffffff", strokeWidth: 6, radius: 0, points: 5, inner: 0.5 } }) },
  { id: "triangle", label: "Triangle", group: "Shapes", make: () => ({ name: "Triangle", source: { type: "shape", shape: "triangle", w: 160, h: 140, fill: "#34d399", stroke: "#ffffff", strokeWidth: 0, radius: 0, points: 5, inner: 0.5 } }) },
  // Backgrounds
  { id: "solid", label: "Solid colour", group: "Backgrounds", make: (s) => ({ name: "Solid", source: { type: "solid", w: s.w, h: s.h, color: "#1e1b4b" } }) },
  { id: "linear", label: "Gradient", group: "Backgrounds", make: (s) => ({ name: "Gradient", source: { type: "gradient", w: s.w, h: s.h, kind: "linear", angle: 90, stops: [{ o: 0, c: "#8b5cf6" }, { o: 1, c: "#22d3ee" }] } }) },
  { id: "radial", label: "Radial glow", group: "Backgrounds", make: (s) => ({ name: "Radial glow", source: { type: "gradient", w: s.w, h: s.h, kind: "radial", angle: 0, stops: [{ o: 0, c: "#fde68a" }, { o: 1, c: "#fde68a00" }] }, blend: "add" }) },
  { id: "aurora", label: "Aurora", group: "Backgrounds", make: (s) => ({ name: "Aurora", source: { type: "noise", w: s.w, h: s.h, scale: 220, speed: 0.25, color: "#5eead4", contrast: 0.6, seed: 7 }, blend: "screen" }) },
  { id: "smoke", label: "Smoke", group: "Backgrounds", make: (s) => ({ name: "Smoke", source: { type: "noise", w: s.w, h: s.h, scale: 160, speed: 0.4, color: "#cbd5e1", contrast: 0.5, seed: 3 } }) },
  // Light
  { id: "shimmer", label: "Shimmer", group: "Light", make: (s) => ({ name: "Shimmer", source: { type: "shimmer", w: s.w, h: s.h, angle: 20, width: 0.22, period: 2.4, color: "#ffffff", seed: 1 }, blend: "add" }) },
  { id: "rays", label: "Light rays", group: "Light", make: () => ({ name: "Light rays", source: { type: "rays", r: 320, count: 14, color: "#fde68a", spin: 18, softness: 0.6 }, blend: "add" }) },
  // Particles
  { id: "sparkles", label: "Sparkles", group: "Particles", make: (s) => ({ name: "Sparkles", source: P({ shape: "spark", w: s.w, h: s.h, count: 48, life: 1.8, speed: 8, spread: 360, size: 14, sizeEnd: 0, colors: ["#ffffff", "#fde68a", "#a5f3fc"], fadeIn: 0.3, fadeOut: 0.5, seed: 3 }), blend: "add" }) },
  { id: "hearts", label: "Floating hearts", group: "Particles", make: (s) => ({ name: "Hearts", source: P({ shape: "heart", w: s.w * 0.7, h: 20, count: 24, life: 3.2, speed: 90, angle: -90, spread: 30, size: 22, sizeEnd: 0.4, colors: ["#fb7185", "#f43f5e", "#fda4af"], drift: 16, seed: 5 }), transform: { y: s.h * 0.3 } }) },
  { id: "snow", label: "Snow", group: "Particles", make: (s) => ({ name: "Snow", source: P({ shape: "dot", w: s.w, h: 10, count: 90, life: 6, speed: 60, angle: 90, spread: 16, size: 6, sizeJitter: 0.7, sizeEnd: 1, colors: ["#ffffff", "#e0f2fe"], drift: 24, fadeIn: 0.1, fadeOut: 0.2, seed: 9 }), transform: { y: -s.h / 2 } }) },
  { id: "embers", label: "Embers", group: "Particles", make: (s) => ({ name: "Embers", source: P({ shape: "dot", w: s.w * 0.8, h: 10, count: 60, life: 2.6, speed: 110, angle: -90, spread: 40, size: 6, sizeEnd: 0, colors: ["#fb923c", "#f97316", "#fde047"], drift: 20, seed: 11 }), blend: "add", transform: { y: s.h * 0.4 } }) },
  { id: "confetti", label: "Confetti burst", group: "Particles", make: () => ({ name: "Confetti", source: P({ shape: "square", w: 1, h: 1, mode: "burst", count: 90, life: 3, speed: 380, speedJitter: 0.6, angle: -90, spread: 120, gravity: 520, size: 12, sizeEnd: 1, spin: 540, colors: ["#f43f5e", "#fbbf24", "#34d399", "#60a5fa", "#a78bfa"], fadeIn: 0, fadeOut: 0.25, seed: 13 }), transform: { y: 160 }, loop: true }) },
  { id: "bubbles", label: "Bubbles", group: "Particles", make: (s) => ({ name: "Bubbles", source: P({ shape: "ring", w: s.w * 0.7, h: 10, count: 22, life: 4, speed: 50, angle: -90, spread: 20, size: 26, sizeJitter: 0.6, sizeEnd: 1.3, colors: ["#bae6fd", "#ffffff"], drift: 14, fadeIn: 0.2, fadeOut: 0.4, seed: 15 }), transform: { y: s.h * 0.35 } }) },
  { id: "fireflies", label: "Fireflies", group: "Particles", make: (s) => ({ name: "Fireflies", source: P({ shape: "dot", w: s.w, h: s.h, count: 26, life: 4, speed: 12, spread: 360, size: 7, sizeEnd: 0.6, colors: ["#fde047", "#bef264"], drift: 28, fadeIn: 0.4, fadeOut: 0.4, seed: 17 }), blend: "add" }) },
  { id: "stars", label: "Starfield", group: "Particles", make: (s) => ({ name: "Starfield", source: P({ shape: "star", w: s.w, h: s.h, count: 40, life: 2.4, speed: 0, size: 12, sizeEnd: 0, colors: ["#fef9c3", "#ffffff"], fadeIn: 0.4, fadeOut: 0.5, spin: 40, seed: 19 }), blend: "add" }) },
];

export const GENERATOR_GROUPS = [...new Set(GENERATORS.map((g) => g.group))];

/** A new clip from a generator preset, at `start`, `duration` seconds long. */
export function clipFromGenerator(g: Preset<ClipMaker>, stage: { w: number; h: number }, start: number, duration: number, track = 0): Clip {
  const m = g.make(stage);
  return newClip(m.source, {
    name: m.name,
    start,
    duration: Math.max(0.1, duration),
    track,
    blend: m.blend,
    fx: m.fx,
    loop: m.loop ?? true,
    transform: { ...defaultTransform(), ...(m.transform ?? {}) },
  });
}

// --- Titles ------------------------------------------------------------------------------------------------------

export const TITLES: { id: string; label: string; text: string; anim: TextAnim; size: number; weight: number; color: string; stroke: string; strokeWidth: number; stagger: number }[] = [
  { id: "plain", label: "Plain", text: "Title", anim: "none", size: 56, weight: 700, color: "#ffffff", stroke: "#000000", strokeWidth: 0, stagger: 0.05 },
  { id: "fade", label: "Fade in", text: "Title", anim: "fade", size: 56, weight: 700, color: "#ffffff", stroke: "#000000", strokeWidth: 0, stagger: 0.07 },
  { id: "type", label: "Typewriter", text: "Typing…", anim: "typewriter", size: 52, weight: 600, color: "#a7f3d0", stroke: "#000000", strokeWidth: 0, stagger: 0.09 },
  { id: "slide", label: "Slide up", text: "Title", anim: "slideUp", size: 60, weight: 800, color: "#ffffff", stroke: "#312e81", strokeWidth: 2, stagger: 0.06 },
  { id: "pop", label: "Pop", text: "POP!", anim: "pop", size: 72, weight: 900, color: "#fde047", stroke: "#7c2d12", strokeWidth: 4, stagger: 0.08 },
  { id: "wave", label: "Wave", text: "Hello", anim: "wave", size: 64, weight: 800, color: "#7dd3fc", stroke: "#0c4a6e", strokeWidth: 3, stagger: 0.05 },
  { id: "bounce", label: "Bounce", text: "Boing", anim: "bounce", size: 64, weight: 800, color: "#f9a8d4", stroke: "#831843", strokeWidth: 3, stagger: 0.07 },
  { id: "shimmer", label: "Shimmer", text: "Glow", anim: "shimmer", size: 60, weight: 700, color: "#fef3c7", stroke: "#78350f", strokeWidth: 2, stagger: 0.06 },
];

export function clipFromTitle(t: (typeof TITLES)[number], start: number, duration: number, track = 0): Clip {
  return newClip(
    { type: "text", text: t.text, size: t.size, weight: t.weight, italic: false, color: t.color, stroke: t.stroke, strokeWidth: t.strokeWidth, anim: t.anim, stagger: t.stagger, align: "center" },
    { name: t.label === "Plain" ? "Title" : `Title — ${t.label}`, start, duration: Math.max(0.1, duration), track, loop: true },
  );
}

// --- Effects --------------------------------------------------------------------------------------------------------

export const EFFECTS: { id: string; label: string; group: string; type: ClipFxType; make: () => ClipFx }[] = [
  { id: "glow", label: "Glow", group: "Light", type: "glow", make: () => ({ type: "glow", color: "#a78bfa", blur: 18, strength: 1.5 }) },
  { id: "neon", label: "Neon", group: "Light", type: "glow", make: () => ({ type: "glow", color: "#22d3ee", blur: 24, strength: 3 }) },
  { id: "blur", label: "Blur", group: "Blur", type: "blur", make: () => ({ type: "blur", amount: 6 }) },
  { id: "shadow", label: "Drop shadow", group: "Light", type: "shadow", make: () => ({ type: "shadow", color: "#000000", x: 0, y: 8, blur: 14, opacity: 0.5 }) },
  { id: "tint", label: "Tint", group: "Colour", type: "tint", make: () => ({ type: "tint", color: "#fb7185", amount: 0.5 }) },
  { id: "hue", label: "Hue shift", group: "Colour", type: "adjust", make: () => ({ type: "adjust", hue: 90, saturation: 1, brightness: 1, contrast: 1 }) },
  { id: "bw", label: "Black & white", group: "Colour", type: "adjust", make: () => ({ type: "adjust", hue: 0, saturation: 0, brightness: 1, contrast: 1 }) },
  { id: "vivid", label: "Vivid", group: "Colour", type: "adjust", make: () => ({ type: "adjust", hue: 0, saturation: 1.6, brightness: 1.05, contrast: 1.15 }) },
];
export const EFFECT_GROUPS = [...new Set(EFFECTS.map((e) => e.group))];

// --- Transitions -------------------------------------------------------------------------------------------------------

export const TRANSITIONS: { id: TransitionKind; label: string; directional: boolean }[] = [
  { id: "fade", label: "Fade", directional: false },
  { id: "slide", label: "Slide", directional: true },
  { id: "zoom", label: "Zoom", directional: false },
  { id: "pop", label: "Pop", directional: false },
  { id: "blur", label: "Blur", directional: false },
  { id: "wipe", label: "Wipe", directional: true },
  { id: "flash", label: "Flash", directional: false },
  { id: "spin", label: "Spin", directional: false },
];

export const newTransition = (type: TransitionKind, d = 0.5, dir: Transition["dir"] = "left", e: Ease = "out"): Transition => ({ type, d, dir, e });

/** Clip colours in the timeline, by what the clip is. */
export const CLIP_COLOUR: Record<Source["type"], string> = {
  image: "#3b82f6",
  layer: "#6366f1",
  shape: "#a855f7",
  text: "#14b8a6",
  solid: "#64748b",
  gradient: "#ec4899",
  noise: "#0ea5e9",
  shimmer: "#eab308",
  rays: "#f59e0b",
  particles: "#22c55e",
  compound: "#8b5cf6",
  adjust: "#f97316",
};

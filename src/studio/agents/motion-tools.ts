import {
  BLEND_MODES,
  EASE_PRESETS,
  MIN_IDLE,
  MOTION_LIMITS,
  allClips,
  defaultTransform,
  introLength,
  newClip,
  normalizeMotionSpec,
  particlesAt,
  sampleClips,
  type Clip,
  type ClipFx,
  type Ease,
  type MotionSpec,
  type Prop,
  type Source,
} from "../../../convex/lib/motion";
import { EFFECTS, GENERATORS, TITLES, TRANSITIONS, clipFromGenerator, clipFromTitle, newTransition } from "@/studio/motion/library";
import { DEFAULT_LENGTH, EFFECT_GROUPS as LIBRARY_GROUPS, EFFECT_LIBRARY, buildEffect, effectById, introFor } from "../../../convex/lib/effectLibrary";

const r3m = (n: number) => Math.round(n * 1000) / 1000;
import { SCENE_LIMITS, SCENE_PROP_KINDS } from "../../../convex/lib/creationSpecs";
import { addNode, makeImage, makeSceneObject, makeShape, makeShapePath, makeText, newId, removeNodes } from "@/studio/model/doc";
import { isLayerClip, syncLayers } from "@/studio/model/motion-doc";
import { sanitizeDoc } from "@/studio/storage/format";
import type { Doc, DocKind, Node } from "@/studio/model/types";

/**
 * What an AI agent can do to a design through Studio's MCP server: draw artwork on the canvas, and build and move
 * the animation of a nameplate or profile effect. Pure functions over a design in memory: the server reads the file, calls
 * `runDesignTool`, and writes the result back, so everything here is testable without a disk or an agent.
 *
 * Nothing an agent sends is trusted. Every edit ends by running the design through the same rebuilders the app and the
 * store's server use (`normalizeMotionSpec` and `sanitizeDoc`), so what is written is what would be accepted on submission,
 * and anything those had to correct is reported back so the agent learns the rule instead of assuming its value stuck.
 * Bundled into the kit by scripts/build-agent-kit.mjs.
 */

export type Args = Record<string, unknown>;

export interface Design {
  kind: DocKind;
  doc: Doc;
  /** Only nameplates and profile effects have a timeline. */
  motion?: MotionSpec;
}

export interface ToolContext {
  /** The project's own files, by id, with their size when known: what an `image` can refer to. */
  assets: Map<string, { w?: number; h?: number }>;
}

export interface ToolOutput {
  text: string;
  /** Present when the design changed, and is to be written back. */
  design?: Design;
}

// --- Reading arguments --------------------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const fail = (m: string): never => {
  throw new Error(m);
};
const needStr = (a: Args, k: string): string => (typeof a[k] === "string" && (a[k] as string).trim() ? (a[k] as string).trim() : fail(`"${k}" is required, and must be text.`));
const optStr = (a: Args, k: string): string | undefined => (a[k] === undefined || a[k] === null ? undefined : typeof a[k] === "string" ? (a[k] as string) : fail(`"${k}" must be text.`));
const optNum = (a: Args, k: string): number | undefined => (a[k] === undefined || a[k] === null ? undefined : typeof a[k] === "number" && Number.isFinite(a[k]) ? (a[k] as number) : fail(`"${k}" must be a number.`));
const optBool = (a: Args, k: string): boolean | undefined => (a[k] === undefined || a[k] === null ? undefined : typeof a[k] === "boolean" ? (a[k] as boolean) : fail(`"${k}" must be true or false.`));
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const hex = (v: unknown, k: string): string => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : fail(`"${k}" must be a hex colour like #ff8800 (or #ff880080 with transparency).`));
const optColor = (a: Args, k: string): string | undefined => (a[k] === undefined || a[k] === null ? undefined : hex(a[k], k));
const optColors = (a: Args, k: string): string[] | undefined => {
  if (a[k] === undefined || a[k] === null) return undefined;
  if (!Array.isArray(a[k]) || (a[k] as unknown[]).length === 0) return fail(`"${k}" must be a list of hex colours.`);
  return (a[k] as unknown[]).slice(0, 6).map((c) => hex(c, k));
};
const oneOf = <T extends string>(v: unknown, list: readonly T[], k: string): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fail(`"${k}" must be one of: ${list.join(", ")}.`));

// --- Keeping what is written valid ----------------------------------------------------------------------------------------

/** Studio's own copy of a design names pictures `studio:asset/<id>` and nothing else. */
const studioUrl = (u: string) => (/^studio:asset\/[\w-]{1,40}$/.test(u) ? u : fail("A picture on the timeline has to be one of this project's files."));

const clone = <T>(v: T): T => structuredClone(v);

/** Where two values differ, as short sentences. A value that was there and was changed or dropped; new defaults aren't news. */
function diff(before: unknown, after: unknown, path: string, out: string[]): void {
  if (out.length >= 8) return;
  if (typeof before === "number" && typeof after === "number") {
    if (Math.abs(before - after) > 1e-6) out.push(`${path}: ${before} became ${after}`);
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) out.push(`${path}: ${before.length} items became ${after.length}`);
    for (let i = 0; i < Math.min(before.length, after.length); i++) diff(before[i], after[i], `${path}[${i}]`, out);
    return;
  }
  if (isObj(before) && isObj(after)) {
    for (const k of Object.keys(before)) {
      if (before[k] === undefined) continue;
      if (after[k] === undefined) out.push(`${path}.${k}: dropped`);
      else diff(before[k], after[k], `${path}.${k}`, out);
    }
    return;
  }
  if (before !== after && typeof before !== "undefined") out.push(`${path}: ${JSON.stringify(before)} became ${JSON.stringify(after)}`);
}

/** The design as the app and the store would read it: every value clamped or matched, the timeline in step with the artwork. */
function settle(d: Design): { design: Design; adjusted: string[] } {
  const adjusted: string[] = [];
  let doc: Doc;
  try {
    doc = sanitizeDoc(d.doc, d.kind);
  } catch (e) {
    return fail(`That would leave the artwork unreadable: ${e instanceof Error ? e.message : String(e)}`);
  }
  diff(d.doc.nodes, doc.nodes, "artwork", adjusted);
  let motion: MotionSpec | undefined;
  if (d.motion) {
    try {
      motion = normalizeMotionSpec({ ...d.motion, kind: d.kind }, studioUrl, { studio: true });
    } catch (e) {
      return fail(`The store would refuse that: ${e instanceof Error ? e.message : String(e)}`);
    }
    diff(d.motion.clips, motion.clips, "timeline", adjusted);
    if (d.motion.duration !== motion.duration) adjusted.push(`duration: ${d.motion.duration} became ${motion.duration}`);
    motion = syncLayers(motion, doc);
  }
  return { design: { kind: d.kind, doc, ...(motion ? { motion } : {}) }, adjusted };
}

function commit(d: Design, said: string): ToolOutput {
  const { design, adjusted } = settle(d);
  const note = adjusted.length ? `\n\nStudio's rules changed ${adjusted.length === 8 ? "at least " : ""}${adjusted.length} value${adjusted.length === 1 ? "" : "s"} from what you sent:\n- ${adjusted.join("\n- ")}` : "";
  return { design, text: `${said}${note}` };
}

const needMotion = (d: Design): MotionSpec => d.motion ?? fail(`A ${d.kind} has no timeline. Only nameplates and profile effects are animated; use add_node / set_node to draw on its canvas.`);

// --- Clips -----------------------------------------------------------------------------------------------------------------

function mapClips(clips: Clip[], id: string, fn: (c: Clip) => Clip | null): { clips: Clip[]; found: boolean } {
  let found = false;
  const walk = (list: Clip[]): Clip[] => {
    const out: Clip[] = [];
    for (const c of list) {
      if (c.id === id) {
        found = true;
        const r = fn(c);
        if (r) out.push(r);
      } else out.push(c.source.type === "compound" ? { ...c, source: { ...c.source, clips: walk(c.source.clips) } } : c);
    }
    return out;
  };
  const next = walk(clips);
  return { clips: next, found };
}

const findClip = (m: MotionSpec, id: string): Clip => allClips(m.clips).find((c) => c.id === id) ?? fail(`There is no clip "${id}". describe_design lists them.`);

function edit(d: Design, clipId: string, fn: (c: Clip) => Clip | null): Design {
  const m = needMotion(d);
  const r = mapClips(m.clips, clipId, fn);
  if (!r.found) fail(`There is no clip "${clipId}". describe_design lists them.`);
  return { ...d, motion: { ...m, clips: r.clips } };
}

const topTrack = (m: MotionSpec) => Math.min(31, m.clips.length ? Math.max(...m.clips.map((c) => c.track)) + 1 : 0);

function addTop(d: Design, clip: Clip): Design {
  const m = needMotion(d);
  if (allClips(m.clips).length >= MOTION_LIMITS.clips) fail(`A design has at most ${MOTION_LIMITS.clips} clips.`);
  return { ...d, motion: { ...m, clips: [...m.clips, clip] } };
}

/** Colours applied the way each kind of source uses them. */
function recolour(src: Source, colors: string[]): Source {
  const c0 = colors[0];
  switch (src.type) {
    case "particles":
      return { ...src, colors };
    case "shape":
      return { ...src, fill: c0, stroke: src.shape === "ring" || src.shape === "line" ? c0 : src.stroke };
    case "solid":
    case "noise":
    case "rays":
    case "text":
      return { ...src, color: c0 };
    case "shimmer":
      return { ...src, color: c0 };
    case "gradient":
      return colors.length < 2 ? src : { ...src, stops: colors.map((c, i) => ({ o: colors.length === 1 ? 0 : i / (colors.length - 1), c })) };
    default:
      return src;
  }
}

function summary(c: Clip): string {
  const s = c.source;
  const what =
    s.type === "particles" ? `particles (${s.shape}, ${s.count}, ${s.mode})` :
    s.type === "shape" ? `shape ${s.shape}` :
    s.type === "text" ? `text "${s.text}"` :
    s.type === "layer" ? `canvas layer ${s.nodeId}` :
    s.type === "image" ? "picture" :
    s.type === "compound" ? `compound (${s.clips.length} clips)` :
    s.type;
  const moving = (["x", "y", "scaleX", "scaleY", "rotation", "opacity"] as const).filter((k) => typeof c.transform[k] === "object").map((k) => `${k}(${(c.transform[k] as { k: unknown[] }).k.length} keys)`);
  const fx = c.fx.length ? ` fx:${c.fx.map((f) => f.type).join("+")}` : "";
  const tr = `${c.transitionIn ? ` in:${c.transitionIn.type}` : ""}${c.transitionOut ? ` out:${c.transitionOut.type}` : ""}`;
  return `${c.id}  "${c.name}"  track ${c.track}  ${c.start}s +${c.duration}s  ${what}${c.on ? "" : "  [off]"}${c.blend !== "normal" ? `  blend:${c.blend}` : ""}${moving.length ? `  animated: ${moving.join(", ")}` : ""}${fx}${tr}`;
}

// --- Nodes --------------------------------------------------------------------------------------------------------------------

const COMMON_KEYS = ["name", "x", "y", "w", "h", "rotation", "opacity", "hidden", "locked"] as const;
const PAINT_KEYS: Record<string, string[]> = {
  shape: ["fill", "stroke", "strokeWidth", "radius", "fillGradient", "strokeGradient"],
  path: ["fill", "stroke", "strokeWidth", "fillGradient", "strokeGradient"],
  text: ["text", "fontSize", "fontWeight", "italic", "align", "color", "stroke", "strokeWidth", "colorGradient"],
  image: [],
};

function gradientArg(v: unknown, k: string): unknown {
  if (!isObj(v) || !Array.isArray(v.stops) || v.stops.length < 2) return fail(`"${k}" must be { type: "linear"|"radial", angle, stops: [{ offset: 0-1, color }, …] } with at least two stops.`);
  return {
    type: v.type === "radial" ? "radial" : "linear",
    angle: typeof v.angle === "number" ? v.angle : 90,
    stops: (v.stops as unknown[]).map((s) => (isObj(s) && typeof s.offset === "number" ? { offset: s.offset, color: hex(s.color, `${k}.stops.color`) } : fail(`Each stop in "${k}" needs a number "offset" and a hex "color".`))),
  };
}

function nodeOf(d: Design, id: string): Node {
  return d.doc.nodes[id] ?? fail(`There is no layer "${id}". describe_design lists them.`);
}

// --- The tools --------------------------------------------------------------------------------------------------------------------

type Handler = (a: Args, d: Design, ctx: ToolContext) => ToolOutput;

const ids = <T extends { id: string }>(l: readonly T[]) => l.map((x) => x.id);
const EFFECT_IDS = ids(EFFECTS);
const FX_TYPES = ["blur", "glow", "shadow", "adjust", "tint"] as const;
const PROPS = ["x", "y", "scaleX", "scaleY", "rotation", "opacity"] as const;

const handlers: Record<string, Handler> = {
  describe_design(_a, d) {
    const lines = [`${d.kind}, artboard ${d.doc.artboard.w} × ${d.doc.artboard.h}`];
    lines.push("", `Canvas layers (bottom first):`);
    for (const id of d.doc.order) {
      const n = d.doc.nodes[id];
      if (!n) continue;
      lines.push(`  ${n.id}  ${n.type} "${n.name}"  at ${Math.round(n.x)},${Math.round(n.y)}  ${Math.round(n.w)} × ${Math.round(n.h)}${n.hidden ? "  [hidden]" : ""}`);
    }
    if (!d.doc.order.length) lines.push("  (none)");
    if (d.motion) {
      const m = d.motion;
      lines.push("", `Timeline: stage ${m.stage.w} × ${m.stage.h}, ${m.duration}s, ${m.loop.mode === "loop" ? "loops" : `plays once, rests ${m.loop.rest}s`}. Stage origin for x/y offsets is its centre.`);
      const all = allClips(m.clips);
      lines.push(`Clips (${all.length} of at most ${MOTION_LIMITS.clips}):`);
      for (const c of [...m.clips].sort((a, b) => a.track - b.track)) lines.push(`  ${summary(c)}`);
      if (!m.clips.length) lines.push("  (none)");
    }
    return { text: lines.join("\n") };
  },

  list_presets() {
    const group = (g: string) => GENERATORS.filter((x) => x.group === g).map((x) => `${x.id} (${x.label})`).join(", ");
    const groups = [...new Set(GENERATORS.map((g) => g.group))];
    return {
      text: [
        "Generators (add_effect preset):",
        ...groups.map((g) => `  ${g}: ${group(g)}`),
        "",
        "",
        `Library effects (add_effect preset; several clips each, in the colours given or their own): ${LIBRARY_GROUPS.map((g) => `${g}: ${EFFECT_LIBRARY.filter((e) => e.group === g).map((e) => e.id).join(", ")}`).join(" | ")}`,
        "",
        `Titles (add_title preset): ${TITLES.map((t) => `${t.id} (${t.label})`).join(", ")}`,
        `Clip effects (add_clip_fx effect): ${EFFECT_IDS.join(", ")}`,
        `Transitions (set_transition kind): ${TRANSITIONS.map((t) => t.id).join(", ")}`,
        `Easing: ${EASE_PRESETS.join(", ")}, or a cubic Bézier [x1, y1, x2, y2]`,
        `Blend modes: ${BLEND_MODES.join(", ")}`,
        "",
        `Limits: ${MOTION_LIMITS.clips} clips, ${MOTION_LIMITS.duration}s, ${MOTION_LIMITS.keys} keyframes per property, ${MOTION_LIMITS.fx} effects per clip, ${MOTION_LIMITS.particles} particles per emitter.`,
      ].join("\n"),
    };
  },

  add_effect(a, d) {
    const m = needMotion(d);
    const preset = needStr(a, "preset");
    const start = optNum(a, "start") ?? 0;
    // Crystal's effect library: several clips each, built for this design's stage and length.
    const lib = effectById(preset);
    if (lib && !GENERATORS.some((x) => x.id === preset)) {
      if (!lib.kinds.includes(d.kind as "effect" | "nameplate")) fail(`${lib.name} isn't made for a ${d.kind}.`);
      // Into a design with nothing in it the effect sets the design's shape: its length (unless one is given) and an intro
      // that plays once before the loop. Into one that has something, it takes the design's own length and its intro, if
      // it has one, so what is added loops on the same beat as what is there.
      const fresh = m.clips.length === 0 && start === 0;
      const length = Math.max(0.5, optNum(a, "duration") ?? (fresh ? DEFAULT_LENGTH : m.duration - start));
      const own = introLength(m);
      const built = buildEffect(lib, { kind: d.kind as "effect" | "nameplate", duration: length, intro: own > 0 ? own : undefined, colors: optColors(a, "colors"), intensity: optNum(a, "amount"), seed: optNum(a, "seed") });
      if (fresh) {
        const from = introFor(Math.min(MOTION_LIMITS.duration, length), lib.intro ?? 0);
        d = { ...d, motion: { ...m, duration: Math.min(MOTION_LIMITS.duration, length), loop: { mode: "loop", rest: m.loop.rest, ...(from > 0 ? { from } : {}) } } };
      }
      const x0 = optNum(a, "x");
      const y0 = optNum(a, "y");
      const k0 = optNum(a, "scale");
      const lane = Math.round(optNum(a, "track") ?? topTrack(m));
      let next = d;
      const made = built.map((clip, i) => {
        // Each clip keeps its own start inside the effect (some begin part-way through the intro), shifted to where it is placed.
        const at = r3m(Math.max(0, start) + clip.start);
        const moved = { ...clip, start: at, duration: r3m(Math.max(0.05, Math.min(clip.duration, (d.motion?.duration ?? m.duration) - at))), track: Math.min(31, lane + i) };
        if (a.blend !== undefined) moved.blend = oneOf(a.blend, BLEND_MODES, "blend");
        if (x0 !== undefined || y0 !== undefined || k0 !== undefined) {
          const t = moved.transform;
          // Offsets and scale apply to keyframed values too: every key is shifted or multiplied, so a moving effect moves as a whole.
          const shift = (p: Prop, by: number): Prop => (typeof p === "number" ? p + by : { k: p.k.map((key) => ({ ...key, v: key.v + by })) });
          const times = (p: Prop, by: number): Prop => (typeof p === "number" ? p * by : { k: p.k.map((key) => ({ ...key, v: key.v * by })) });
          moved.transform = { ...t, ...(x0 !== undefined ? { x: shift(t.x, x0) } : {}), ...(y0 !== undefined ? { y: shift(t.y, y0) } : {}), ...(k0 !== undefined ? { scaleX: times(t.scaleX, k0), scaleY: times(t.scaleY, k0) } : {}) };
        }
        return moved;
      });
      for (const clip of made) next = addTop(next, clip);
      const out = commit(next, "");
      return { design: out.design, text: `Added ${lib.name} (${made.length} clip${made.length === 1 ? "" : "s"}: ${made.map((c) => c.id).join(", ")}).${out.text}` };
    }
    const g = GENERATORS.find((x) => x.id === preset) ?? fail(`There is no generator or library effect "${preset}". list_presets shows them: ${[...ids(GENERATORS), ...EFFECT_LIBRARY.map((e) => e.id)].join(", ")}.`);
    const duration = optNum(a, "duration") ?? Math.max(0.1, m.duration - start);
    const clip = clipFromGenerator(g, m.stage, Math.max(0, start), duration, Math.round(optNum(a, "track") ?? topTrack(m)));
    const colors = optColors(a, "colors");
    if (colors) clip.source = recolour(clip.source, colors);
    const amount = optNum(a, "amount");
    if (amount !== undefined && clip.source.type === "particles") clip.source = { ...clip.source, count: Math.max(1, Math.round(clip.source.count * amount)) };
    const x = optNum(a, "x");
    const y = optNum(a, "y");
    const scale = optNum(a, "scale");
    clip.transform = { ...clip.transform, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}), ...(scale !== undefined ? { scaleX: scale, scaleY: scale } : {}) };
    if (a.blend !== undefined) clip.blend = oneOf(a.blend, BLEND_MODES, "blend");
    const name = optStr(a, "name");
    if (name) clip.name = name;
    const out = commit(addTop(d, clip), "");
    const made = out.design!.motion!.clips.find((c) => c.id === clip.id);
    return { design: out.design, text: `Added ${g.label} as clip ${clip.id}${made ? `:\n  ${summary(made)}` : ""}${out.text}` };
  },

  add_title(a, d) {
    const m = needMotion(d);
    const t = TITLES.find((x) => x.id === (optStr(a, "preset") ?? "plain")) ?? fail(`There is no title style "${a.preset}". Styles: ${ids(TITLES).join(", ")}.`);
    const start = optNum(a, "start") ?? 0;
    const clip = clipFromTitle({ ...t, text: optStr(a, "text") ?? t.text, color: optColor(a, "color") ?? t.color, size: optNum(a, "size") ?? t.size }, Math.max(0, start), optNum(a, "duration") ?? Math.max(0.1, m.duration - start), Math.round(optNum(a, "track") ?? topTrack(m)));
    clip.transform = { ...clip.transform, x: optNum(a, "x") ?? 0, y: optNum(a, "y") ?? 0 };
    const out = commit(addTop(d, clip), "");
    return { design: out.design, text: `Added a title as clip ${clip.id}.${out.text}` };
  },

  add_clip(a, d, ctx) {
    const m = needMotion(d);
    if (!isObj(a.source)) fail('"source" is required: an object with a "type" (shape, text, solid, gradient, noise, shimmer, rays, particles, image, compound, adjust). list_presets and sdk docs show their fields.');
    let source = clone(a.source) as Record<string, unknown>;
    if (source.type === "layer") fail("Canvas layers get their clips automatically. Draw with add_node and the clip appears; don't add one by hand.");
    if (source.type === "image") {
      const assetId = needStr(source, "assetId");
      const meta = ctx.assets.get(assetId) ?? fail(`"${assetId}" isn't one of this project's files. Ask the person to import it in Studio first.`);
      source = { type: "image", url: `studio:asset/${assetId}`, w: typeof source.w === "number" ? source.w : (meta.w ?? 100), h: typeof source.h === "number" ? source.h : (meta.h ?? 100), ox: typeof source.ox === "number" ? source.ox : 0, oy: typeof source.oy === "number" ? source.oy : 0 };
    }
    const tf = isObj(a.transform) ? a.transform : {};
    const clip = newClip(source as unknown as Source, {
      name: optStr(a, "name") ?? "Clip",
      start: optNum(a, "start") ?? 0,
      duration: optNum(a, "duration") ?? Math.min(2, m.duration),
      track: Math.round(optNum(a, "track") ?? topTrack(m)),
      loop: optBool(a, "loop") ?? true,
      blend: a.blend === undefined ? "normal" : oneOf(a.blend, BLEND_MODES, "blend"),
      transform: { ...defaultTransform(), ...(tf as object) } as Clip["transform"],
      fx: Array.isArray(a.fx) ? (clone(a.fx) as ClipFx[]) : [],
    });
    const out = commit(addTop(d, clip), "");
    const made = out.design!.motion!.clips.find((c) => c.id === clip.id);
    return { design: out.design, text: `Added clip ${clip.id}${made ? `:\n  ${summary(made)}` : ""}${out.text}` };
  },

  animate(a, d) {
    const id = needStr(a, "clipId");
    const prop = oneOf(a.property, PROPS, "property");
    const keys = a.keys;
    if (!Array.isArray(keys) || keys.length < 1) fail('"keys" is required: [{ t: seconds from the clip\'s start, v: value, e?: easing }, …].');
    if ((keys as unknown[]).length > MOTION_LIMITS.keys) fail(`A property can have at most ${MOTION_LIMITS.keys} keyframes.`);
    const k = (keys as unknown[]).map((x, i) => {
      if (!isObj(x) || typeof x.t !== "number" || typeof x.v !== "number") return fail(`Keyframe ${i + 1} needs a number "t" and a number "v".`);
      const e: Ease = x.e === undefined ? "inOut" : Array.isArray(x.e) ? (x.e as Ease) : oneOf(x.e, EASE_PRESETS, `keys[${i}].e`);
      return { t: x.t, v: x.v, e };
    });
    const next = edit(d, id, (c) => ({ ...c, transform: { ...c.transform, [prop]: { k } } }));
    return commit(next, `Animated ${prop} on ${id} with ${k.length} keyframe${k.length === 1 ? "" : "s"}. Times are seconds from the clip's start; x and y are offsets from where the clip rests, in stage units.`);
  },

  move_clip(a, d) {
    const id = needStr(a, "clipId");
    const m = needMotion(d);
    const clip = findClip(m, id);
    const x = optNum(a, "x");
    const y = optNum(a, "y");
    const from = isObj(a.from) ? a.from : undefined;
    const to = isObj(a.to) ? a.to : undefined;
    if ((from && !to) || (to && !from)) fail('Give both "from" and "to" ({ x, y }) to move a clip across the screen.');
    const over = optNum(a, "over") ?? clip.duration;
    const e: Ease = a.ease === undefined ? "inOut" : Array.isArray(a.ease) ? (a.ease as Ease) : oneOf(a.ease, EASE_PRESETS, "ease");
    const delay = optNum(a, "delay") ?? 0;
    const next = edit(d, id, (c) => {
      const tf = { ...c.transform };
      if (from && to) {
        for (const ax of ["x", "y"] as const) {
          const f = typeof from[ax] === "number" ? (from[ax] as number) : 0;
          const t = typeof to[ax] === "number" ? (to[ax] as number) : 0;
          tf[ax] = f === t ? f : { k: [{ t: delay, v: f, e }, { t: delay + over, v: t, e }] };
        }
      } else {
        if (x !== undefined) tf.x = x;
        if (y !== undefined) tf.y = y;
      }
      return { ...c, start: optNum(a, "start") ?? c.start, track: a.track === undefined ? c.track : Math.round(optNum(a, "track") as number), transform: tf };
    });
    return commit(next, from && to ? `Moved ${id} from (${from.x ?? 0}, ${from.y ?? 0}) to (${to.x ?? 0}, ${to.y ?? 0}) over ${over}s.` : `Updated ${id}'s position and timing.`);
  },

  set_clip(a, d) {
    const id = needStr(a, "clipId");
    const patch = isObj(a.patch) ? a.patch : fail('"patch" is required: an object of the fields to change.');
    const allowed = ["name", "on", "track", "start", "duration", "in", "speed", "reverse", "loop", "blend", "transform", "source", "mask"];
    const bad = Object.keys(patch).filter((k) => !allowed.includes(k));
    if (bad.length) fail(`These can't be set: ${bad.join(", ")}. Allowed: ${allowed.join(", ")}. (Effects and transitions have their own tools.)`);
    if ("blend" in patch) oneOf(patch.blend, BLEND_MODES, "blend");
    const next = edit(d, id, (c) => {
      const merged: Clip = { ...c, ...(clone(patch) as object) } as Clip;
      if (isObj(patch.transform)) merged.transform = { ...c.transform, ...(clone(patch.transform) as object) } as Clip["transform"];
      if (isObj(patch.source)) {
        if (patch.source.type !== undefined && patch.source.type !== c.source.type) fail("A clip's source type can't change; remove it and add a new one.");
        merged.source = { ...c.source, ...(clone(patch.source) as object) } as Source;
      }
      if (patch.mask === null) delete merged.mask;
      return merged;
    });
    return commit(next, `Updated ${id}: ${Object.keys(patch).join(", ")}.`);
  },

  add_clip_fx(a, d) {
    const id = needStr(a, "clipId");
    let fx: ClipFx;
    if (typeof a.effect === "string") {
      const e = EFFECTS.find((x) => x.id === a.effect) ?? fail(`There is no effect "${a.effect}". Presets: ${EFFECT_IDS.join(", ")}; or give an object with a "type" of ${FX_TYPES.join(", ")}.`);
      fx = { ...e.make(), ...(isObj(a.params) ? (clone(a.params) as object) : {}) } as ClipFx;
    } else if (isObj(a.effect)) {
      oneOf(a.effect.type, FX_TYPES, "effect.type");
      fx = clone(a.effect) as unknown as ClipFx;
    } else return fail(`"effect" is required: a preset name (${EFFECT_IDS.join(", ")}) or an object with a "type".`);
    if (findClip(needMotion(d), id).fx.length >= MOTION_LIMITS.fx) fail(`A clip can have at most ${MOTION_LIMITS.fx} effects.`);
    return commit(edit(d, id, (c) => ({ ...c, fx: [...c.fx, fx] })), `Added a ${fx.type} effect to ${id}.`);
  },

  set_transition(a, d) {
    const id = needStr(a, "clipId");
    const which = oneOf(a.which, ["in", "out"] as const, "which");
    const kind = needStr(a, "kind");
    const key = which === "in" ? "transitionIn" : "transitionOut";
    if (kind === "none") return commit(edit(d, id, (c) => ({ ...c, [key]: undefined })), `Removed ${id}'s ${which} transition.`);
    const tk = TRANSITIONS.find((t) => t.id === kind) ?? fail(`There is no transition "${kind}". Kinds: ${ids(TRANSITIONS).join(", ")}, or "none".`);
    const dir = a.dir === undefined ? "left" : oneOf(a.dir, ["left", "right", "up", "down"] as const, "dir");
    const e: Ease = a.ease === undefined ? "out" : Array.isArray(a.ease) ? (a.ease as Ease) : oneOf(a.ease, EASE_PRESETS, "ease");
    const tr = newTransition(tk.id, optNum(a, "duration") ?? 0.5, dir, e);
    return commit(edit(d, id, (c) => ({ ...c, [key]: tr })), `Set ${id}'s ${which} transition to ${kind} (${tr.d}s).`);
  },

  remove_clip(a, d) {
    const id = needStr(a, "clipId");
    const m = needMotion(d);
    const clip = findClip(m, id);
    let next = edit(d, id, () => null);
    let said = `Removed ${id}.`;
    // A canvas layer's clip comes back by itself while the layer is visible; hiding the layer is how it stays off the timeline.
    if (isLayerClip(clip)) {
      const node = next.doc.nodes[clip.source.nodeId];
      if (node) {
        next = { ...next, doc: { ...next.doc, nodes: { ...next.doc.nodes, [node.id]: { ...node, hidden: true } } } };
        said += ` It drew canvas layer "${node.name}", which is now hidden so the clip doesn't return. Use set_node to show it again, or remove_node to delete it.`;
      }
    }
    return commit(next, said);
  },

  set_timeline(a, d) {
    const m = needMotion(d);
    const mode = a.loopMode === undefined ? m.loop.mode : oneOf(a.loopMode, ["loop", "once"] as const, "loopMode");
    const duration = optNum(a, "duration") ?? m.duration;
    // The intro: what plays once before the loop. 0 turns it off; left out keeps what the design has.
    const asked = optNum(a, "loopFrom");
    const from = mode === "loop" ? Math.max(0, Math.min(asked ?? (m.loop.from ?? 0), Math.max(0, duration - MIN_IDLE))) : 0;
    const next: MotionSpec = { ...m, duration, loop: { mode, rest: optNum(a, "rest") ?? m.loop.rest, ...(from > 0 ? { from } : {}) } };
    return commit({ ...d, motion: next }, `Timeline: ${next.duration}s, ${mode === "loop" ? (from > 0 ? `an intro of ${from}s, then the last ${Math.round((duration - from) * 1000) / 1000}s loops` : "loops") : `plays once then rests ${next.loop.rest}s`}.`);
  },

  add_node(a, d, ctx) {
    const type = oneOf(a.type, ["rect", "ellipse", "star", "polygon", "text", "image"] as const, "type");
    const { w: aw, h: ah } = d.doc.artboard;
    const w = optNum(a, "w") ?? Math.round(aw / 4);
    const h = optNum(a, "h") ?? Math.round(ah / 4);
    const x = optNum(a, "x") ?? Math.round((aw - w) / 2);
    const y = optNum(a, "y") ?? Math.round((ah - h) / 2);
    let node: Node;
    if (type === "rect" || type === "ellipse") node = makeShape(type, x, y, w, h);
    else if (type === "star") node = makeShapePath({ kind: "star", points: Math.round(optNum(a, "points") ?? 5), inner: optNum(a, "inner") ?? 0.5 }, { x, y, w, h });
    else if (type === "polygon") node = makeShapePath({ kind: "polygon", sides: Math.round(optNum(a, "sides") ?? 6) }, { x, y, w, h });
    else if (type === "text") node = { ...makeText(x, y, needStr(a, "text")), w: optNum(a, "w") ?? 240, h: optNum(a, "h") ?? 64 };
    else {
      const assetId = needStr(a, "assetId");
      if (!ctx.assets.has(assetId)) fail(`"${assetId}" isn't one of this project's files. Ask the person to import it in Studio first.`);
      node = makeImage(assetId, optStr(a, "name") ?? "Picture", x, y, w, h);
    }
    const next: Record<string, unknown> = { ...node };
    for (const k of ["name", "rotation", "opacity", "fill", "stroke", "strokeWidth", "radius", "fontSize", "fontWeight", "italic", "align", "color"]) {
      if (a[k] === undefined || a[k] === null) continue;
      if (k === "fill" || k === "stroke" || k === "color") next[k] = a[k] === "none" ? "none" : hex(a[k], k);
      else next[k] = a[k];
    }
    for (const k of ["fillGradient", "strokeGradient", "colorGradient"]) if (a[k] !== undefined) next[k] = gradientArg(a[k], k);
    const added = addNode(d.doc, next as unknown as Node);
    const out = commit({ ...d, doc: added }, "");
    return { design: out.design, text: `Added ${type} as layer ${next.id}.${d.motion ? " It is on the timeline as a layer clip (describe_design shows its clip)." : ""}${out.text}` };
  },

  set_node(a, d, ctx) {
    const id = needStr(a, "nodeId");
    const node = nodeOf(d, id);
    const patch = isObj(a.patch) ? a.patch : fail('"patch" is required: an object of the fields to change.');
    const allowed = [...COMMON_KEYS, ...(PAINT_KEYS[node.type] ?? []), ...(node.type === "image" ? ["assetId"] : [])];
    const bad = Object.keys(patch).filter((k) => !allowed.includes(k));
    if (bad.length) fail(`A ${node.type} layer can't have these set: ${bad.join(", ")}. Allowed: ${allowed.join(", ")}.`);
    const next: Record<string, unknown> = { ...node };
    for (const [k, v] of Object.entries(patch)) {
      if (k === "fill" || k === "stroke" || k === "color") next[k] = v === "none" ? "none" : hex(v, k);
      else if (k.endsWith("Gradient")) {
        if (v === null) delete next[k];
        else next[k] = gradientArg(v, k);
      } else if (k === "assetId") {
        if (typeof v !== "string" || !ctx.assets.has(v)) fail(`"${String(v)}" isn't one of this project's files.`);
        next[k] = v;
      } else next[k] = v;
    }
    return commit({ ...d, doc: { ...d.doc, nodes: { ...d.doc.nodes, [id]: next as unknown as Node } } }, `Updated layer ${id}: ${Object.keys(patch).join(", ")}.`);
  },

  remove_node(a, d) {
    const id = needStr(a, "nodeId");
    nodeOf(d, id);
    return commit({ ...d, doc: removeNodes(d.doc, [id]) }, `Removed layer ${id}${d.motion ? " and its clip" : ""}.`);
  },

  add_scene_object(a, d) {
    if (d.kind !== "scene") fail("Seats, props, screens and floors belong to lounge scenes.");
    const type = oneOf(a.type, ["screen", "seat", "floor", "prop"] as const, "type");
    const { w: aw, h: ah } = d.doc.artboard;
    const at = { x: optNum(a, "x"), y: optNum(a, "y") };
    const nodes = Object.values(d.doc.nodes);
    if (type === "seat" && nodes.filter((n) => n.type === "seat").length >= SCENE_LIMITS.seats) fail(`A scene has at most ${SCENE_LIMITS.seats} seats.`);
    if (type === "prop" && nodes.filter((n) => n.type === "prop").length >= SCENE_LIMITS.props) fail(`A scene has at most ${SCENE_LIMITS.props} props.`);
    if ((type === "screen" || type === "floor") && nodes.some((n) => n.type === type)) fail(`The scene already has a ${type}. Move it with set_node instead.`);
    let node: Node;
    if (type === "prop") {
      const prop = oneOf(a.prop, SCENE_PROP_KINDS, "prop");
      const size = Math.round(aw * 0.06);
      node = { id: newId(), name: prop[0].toUpperCase() + prop.slice(1), type: "prop", prop, interactive: optBool(a, "interactive") ?? false, on: true, x: at.x ?? Math.round(aw / 2 - size / 2), y: at.y ?? Math.round(ah * 0.7 - size), w: size, h: size, rotation: 0, opacity: 1, locked: false, hidden: false };
    } else {
      node = makeSceneObject(type, d.doc.artboard, at.x !== undefined && at.y !== undefined ? { x: at.x, y: at.y } : undefined);
      if (type !== "seat" && (at.x !== undefined || at.y !== undefined)) node = { ...node, x: at.x ?? node.x, y: at.y ?? node.y };
    }
    const w = optNum(a, "w");
    const h = optNum(a, "h");
    if (w !== undefined || h !== undefined) node = { ...node, w: w ?? node.w, h: h ?? node.h };
    const out = commit({ ...d, doc: addNode(d.doc, node) }, "");
    return { design: out.design, text: `Added ${type} as ${node.id}. For a seat, x/y is where the person's feet go.${out.text}` };
  },

  set_scene_dim(a, d) {
    if (d.kind !== "scene") fail("Only lounge scenes dim while a stream plays.");
    const scene = { dimOnShare: optBool(a, "dimOnShare") ?? d.doc.scene?.dimOnShare ?? false, amount: optNum(a, "amount") ?? d.doc.scene?.amount ?? 0.5 };
    return commit({ ...d, doc: { ...d.doc, scene } }, `The room ${scene.dimOnShare ? `dims by ${Math.round(scene.amount * 100)}%` : "doesn't dim"} while a stream plays.`);
  },

  sample_design(a, d) {
    const m = needMotion(d);
    const t = Math.min(Math.max(optNum(a, "t") ?? 0, 0), m.duration - 1e-4);
    const rows = sampleClips(m.clips, t, m.stage).map((r) => {
      const s = r.clip.source;
      const parts = [`${r.clip.id} "${r.clip.name}"`, `at (${+r.x.toFixed(1)}, ${+r.y.toFixed(1)})`, `scale ${+r.sx.toFixed(2)}×${+r.sy.toFixed(2)}`, `rotation ${+r.rotation.toFixed(1)}°`, `opacity ${+r.opacity.toFixed(2)}`];
      if (s.type === "particles") parts.push(`${particlesAt(s, r.src).length} particles alive`);
      if (r.fx.length) parts.push(`fx ${r.fx.map((f) => f.type).join("+")}`);
      return `  ${parts.join(", ")}`;
    });
    return { text: `At ${+t.toFixed(3)}s of ${m.duration}s (stage origin is its centre; y grows downwards):\n${rows.length ? rows.join("\n") : "  nothing is on screen"}` };
  },
};

/** Tools that change the design, as opposed to describing it. */
export const WRITE_TOOLS = new Set(Object.keys(handlers).filter((n) => !["describe_design", "list_presets", "sample_design"].includes(n)));
export const designToolNames = (): string[] => Object.keys(handlers);

export function runDesignTool(name: string, args: Args, design: Design, ctx: ToolContext): ToolOutput {
  const h = handlers[name];
  if (!h) return fail(`Unknown tool: ${name}`);
  // Edit a copy: a failed edit leaves the caller's design exactly as it was.
  return h(isObj(args) ? args : {}, clone(design), ctx);
}

// --- What the server tells the agent about them ------------------------------------------------------------------------------------

const num = (description: string) => ({ type: "number", description });
const str = (description: string) => ({ type: "string", description });
const colour = str("A hex colour, #rgb, #rrggbb or #rrggbbaa.");
const ease = { description: `An easing name (${EASE_PRESETS.join(", ")}) or a cubic Bézier [x1, y1, x2, y2].` };

export const DESIGN_TOOLS: { name: string; description: string; inputSchema: Record<string, unknown> }[] = [
  { name: "describe_design", description: "The design as it is now: its canvas layers (ids, positions) and, for a nameplate or profile effect, its timeline clips. Call this before editing, and after, to see the result.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "list_presets", description: "Every generator, title style, clip effect, transition, easing and blend mode you can ask for, and the limits.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "sample_design", description: "Where everything is at one moment of the animation: each clip's position, scale, rotation, opacity and particle count. Use it to check that something really moves the way you meant.", inputSchema: { type: "object", properties: { t: num("Seconds into the timeline.") }, required: ["t"], additionalProperties: false } },
  {
    name: "add_effect",
    description: "Add a ready-made animated effect to a nameplate or profile effect: 89 to choose from, such as sparkles, snowfall, embers, confetti, cherry blossoms, aurora, nebula, lightning, ripples, glitch, neon frame (list_presets shows all). It becomes a few clips, drawn live and cheap to play, in the colours you give.",
    inputSchema: { type: "object", properties: { preset: str("A generator id from list_presets."), start: num("Seconds. Default 0."), duration: num("Seconds. Default: to the end."), track: num("Lane 0-31; higher is drawn over lower. Default: on top."), x: num("Offset from the stage's centre."), y: num("Offset from the stage's centre; down is positive."), scale: num("Size multiplier."), colors: { type: "array", items: colour, description: "Up to 6 colours; particles pick among them." }, amount: num("Multiplier on how many particles."), blend: str(`One of ${BLEND_MODES.join(", ")}.`), name: str("A name for the clip.") }, required: ["preset"], additionalProperties: false },
  },
  { name: "add_title", description: "Add animated text to a nameplate or profile effect.", inputSchema: { type: "object", properties: { text: str("What it says (up to 40 characters)."), preset: str(`A style: ${TITLES.map((t) => t.id).join(", ")}.`), start: num("Seconds."), duration: num("Seconds."), x: num("Offset from centre."), y: num("Offset from centre."), color: colour, size: num("Font size in stage units."), track: num("Lane.") }, additionalProperties: false } },
  { name: "add_clip", description: "Add any clip by hand: a shape, gradient, noise, shimmer, rays, particles (full control), solid, an imported picture ({type:'image', assetId}) or a compound clip.", inputSchema: { type: "object", properties: { source: { type: "object", description: "{ type, …fields }. See sdk/format_source motion.ts for each type's fields." }, name: str("Clip name."), start: num("Seconds."), duration: num("Seconds."), track: num("Lane."), blend: str("Blend mode."), loop: { type: "boolean" }, transform: { type: "object", description: "Any of x, y, scaleX, scaleY, rotation, opacity, anchorX, anchorY." }, fx: { type: "array", description: "Clip effects." } }, required: ["source"], additionalProperties: false } },
  { name: "animate", description: "Keyframe one property of a clip so it moves, grows, spins or fades. Times are seconds from the clip's start.", inputSchema: { type: "object", properties: { clipId: str("From describe_design."), property: str(`One of ${PROPS.join(", ")}.`), keys: { type: "array", description: "[{ t, v, e? }, …]", items: { type: "object", properties: { t: num("Seconds from the clip's start."), v: num("The value."), e: ease }, required: ["t", "v"] } } }, required: ["clipId", "property", "keys"], additionalProperties: false } },
  { name: "move_clip", description: "Place a clip, or move it across the screen: give x/y for a fixed position, or from and to ({x,y}) to animate between two points. Also sets when it starts.", inputSchema: { type: "object", properties: { clipId: str("From describe_design."), x: num("Fixed x offset."), y: num("Fixed y offset."), from: { type: "object", description: "{ x, y } where it starts." }, to: { type: "object", description: "{ x, y } where it ends." }, over: num("Seconds the move takes. Default: the clip's length."), delay: num("Seconds before the move begins."), ease, start: num("When the clip begins on the timeline."), track: num("Lane.") }, required: ["clipId"], additionalProperties: false } },
  { name: "set_clip", description: "Change a clip's fields: name, on, track, start, duration, speed, reverse, loop, blend, transform (merged), source fields (merged, same type), mask.", inputSchema: { type: "object", properties: { clipId: str("From describe_design."), patch: { type: "object" } }, required: ["clipId", "patch"], additionalProperties: false } },
  { name: "add_clip_fx", description: "Put an effect on a clip: glow, neon, blur, shadow, tint, hue, bw, vivid, or an object { type, … }.", inputSchema: { type: "object", properties: { clipId: str("From describe_design."), effect: { description: `A preset (${EFFECT_IDS.join(", ")}) or an object with a "type" of ${FX_TYPES.join(", ")}.` }, params: { type: "object", description: "Overrides for a preset's settings." } }, required: ["clipId", "effect"], additionalProperties: false } },
  { name: "set_transition", description: "Give a clip an entrance (in) or exit (out) transition, or remove it with kind 'none'.", inputSchema: { type: "object", properties: { clipId: str("From describe_design."), which: str("in or out."), kind: str(`${TRANSITIONS.map((t) => t.id).join(", ")}, or none.`), duration: num("Seconds."), dir: str("left, right, up or down."), ease }, required: ["clipId", "which", "kind"], additionalProperties: false } },
  { name: "remove_clip", description: "Delete a clip. If it drew a canvas layer, that layer is hidden so the clip doesn't come back.", inputSchema: { type: "object", properties: { clipId: str("From describe_design.") }, required: ["clipId"], additionalProperties: false } },
  { name: "set_timeline", description: "Set the animation's length (seconds, at most 12) and whether it loops or plays once and rests. loopFrom makes the start an intro: it plays once when the profile is opened and then only what follows it loops. Library effects come with one.", inputSchema: { type: "object", properties: { duration: num("Seconds."), loopMode: str("loop or once."), rest: num("Seconds to hold the last frame before replaying, for 'once'."), loopFrom: num("Seconds of intro: the loop starts here after the first play-through. 0 for none.") }, additionalProperties: false } },
  { name: "add_node", description: "Draw on the canvas: a rect, ellipse, star, polygon, text or an imported picture. On a nameplate or profile effect it appears on the timeline too. Positions are in the artboard's units (describe_design says its size).", inputSchema: { type: "object", properties: { type: str("rect, ellipse, star, polygon, text or image."), x: num("Left edge."), y: num("Top edge."), w: num("Width."), h: num("Height."), fill: str("A hex colour, or 'none'."), stroke: str("A hex colour, or 'none'."), strokeWidth: num("Outline width."), radius: num("Corner radius (rect)."), points: num("Star points."), inner: num("Star inner radius, 0.05-0.95."), sides: num("Polygon sides."), text: str("For text."), fontSize: num("For text."), fontWeight: num("100-900."), color: colour, assetId: str("For image: a file of this project."), fillGradient: { type: "object", description: "{ type, angle, stops: [{ offset, color }] }" }, rotation: num("Degrees."), opacity: num("0-1."), name: str("Layer name.") }, required: ["type"], additionalProperties: false } },
  { name: "set_node", description: "Change a canvas layer: position and size (x, y, w, h), rotation, opacity, hidden, fill, stroke, text, gradients and so on.", inputSchema: { type: "object", properties: { nodeId: str("From describe_design."), patch: { type: "object" } }, required: ["nodeId", "patch"], additionalProperties: false } },
  { name: "add_scene_object", description: "Lounge scenes: add the screen (where a stream shows), a seat, the floor line, or an animated prop. For a seat, x and y are where the person's feet go.", inputSchema: { type: "object", properties: { type: str("screen, seat, floor or prop."), prop: str(`For a prop: ${SCENE_PROP_KINDS.join(", ")}.`), x: num("Left edge (seat: feet)."), y: num("Top edge (seat: feet)."), w: num("Width."), h: num("Height."), interactive: { type: "boolean", description: "For a prop: people can switch it on and off." } }, required: ["type"], additionalProperties: false } },
  { name: "set_scene_dim", description: "Lounge scenes: dim the room while a stream is playing, and by how much (0-1).", inputSchema: { type: "object", properties: { dimOnShare: { type: "boolean" }, amount: num("0-1.") }, additionalProperties: false } },
  { name: "remove_node", description: "Delete a canvas layer (and its timeline clip).", inputSchema: { type: "object", properties: { nodeId: str("From describe_design.") }, required: ["nodeId"], additionalProperties: false } },
];

// --- Theme packs ------------------------------------------------------------------------------------------------------------------

import { THEME_TOKENS, normalizeThemePackSpec } from "../../../convex/lib/creationSpecs";
import type { ThemePackData } from "@/studio/model/types";

/** Which tools apply to which kind of project, so an agent in a bot project isn't offered a timeline. */
const MOTION_TOOLS = ["list_presets", "sample_design", "add_effect", "add_title", "add_clip", "animate", "move_clip", "set_clip", "add_clip_fx", "set_transition", "remove_clip", "set_timeline"];
const SCENE_TOOLS = ["add_scene_object", "set_scene_dim"];

export function designToolsFor(kind: string): typeof DESIGN_TOOLS {
  if (!["decoration", "sticker", "nameplate", "effect", "scene"].includes(kind)) return [];
  return DESIGN_TOOLS.filter((t) => {
    if (MOTION_TOOLS.includes(t.name)) return kind === "nameplate" || kind === "effect";
    if (SCENE_TOOLS.includes(t.name)) return kind === "scene";
    return true;
  });
}

export const THEME_TOOLS: typeof DESIGN_TOOLS = [
  { name: "describe_theme", description: "The theme pack's colours (for each look it has), its font, sounds and icons, and which colour tokens exist.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  {
    name: "set_theme_colors",
    description: `Set colours of a theme pack. Tokens: ${THEME_TOKENS.join(", ")}. Colours are hex, rgb(), hsl() or oklch(). With scheme "alt" you edit the second look (for the other of light/dark); it is created if it doesn't exist, so the pack follows each person's light/dark setting.`,
    inputSchema: { type: "object", properties: { colors: { type: "object", description: "token → colour. A token set to an empty string is removed." }, scheme: { type: "string", description: "main (default) or alt." }, isDark: { type: "boolean", description: "Whether the main look is dark. Can't change while there's an alt look." }, replace: { type: "boolean", description: "Replace all of that look's colours instead of merging." } }, required: ["colors"], additionalProperties: false },
  },
  { name: "remove_theme_variant", description: "Remove the second (alt) look, so the pack has one look and forces its scheme.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
];

export const THEME_WRITE_TOOLS = new Set(["set_theme_colors", "remove_theme_variant"]);

export interface ThemeOutput {
  text: string;
  themePack?: ThemePackData;
}

export function runThemeTool(name: string, args: Args, pack: ThemePackData): ThemeOutput {
  const a = isObj(args) ? args : {};
  const data = clone(pack);
  const theme = data.theme ?? { isDark: true, colors: {} };
  switch (name) {
    case "describe_theme": {
      const lines = [`Main look: ${theme.isDark ? "dark" : "light"}, ${Object.keys(theme.colors).length} colour${Object.keys(theme.colors).length === 1 ? "" : "s"}${theme.template ? ` (started from "${theme.template}")` : ""}`];
      for (const [k, v] of Object.entries(theme.colors)) lines.push(`  ${k}: ${v}`);
      if (theme.alt) {
        lines.push(`Second look (${theme.isDark ? "light" : "dark"}): ${Object.keys(theme.alt.colors).length} colours`);
        for (const [k, v] of Object.entries(theme.alt.colors)) lines.push(`  ${k}: ${v}`);
      } else lines.push("No second look: the pack forces its one scheme on.");
      lines.push(data.background ? `Background: an app-wide picture, dim ${data.background.dim}%, blur ${data.background.blur}px, panels ${data.background.panels}% opaque.` : "Background: none.");
      lines.push(`Font: ${data.font?.family ? data.font.family : "none"}. Sounds: ${Object.keys(data.sounds).length}. Icons: ${Object.keys(data.icons).length}. (Files are imported in Studio, not written here.)`);
      lines.push(`Tokens: ${THEME_TOKENS.join(", ")}`);
      return { text: lines.join("\n") };
    }
    case "set_theme_colors": {
      const given = isObj(a.colors) ? a.colors : fail('"colors" is required: an object of token → colour.');
      const scheme = a.scheme === undefined ? "main" : oneOf(a.scheme, ["main", "alt"] as const, "scheme");
      const isDark = optBool(a, "isDark");
      if (isDark !== undefined && theme.alt && isDark !== theme.isDark) fail("The main look's scheme can't change while there's a second look. Call remove_theme_variant first.");
      const target = scheme === "alt" ? (theme.alt ??= { colors: {} }) : theme;
      const next: Record<string, string> = a.replace === true ? {} : { ...target.colors };
      for (const [token, value] of Object.entries(given)) {
        if (!(THEME_TOKENS as readonly string[]).includes(token)) fail(`"${token}" isn't a colour a theme can set. Tokens: ${THEME_TOKENS.join(", ")}.`);
        if (value === "" || value === null) delete next[token];
        else if (typeof value === "string") next[token] = value.trim();
        else fail(`"${token}" must be a colour string.`);
      }
      target.colors = next;
      if (isDark !== undefined) theme.isDark = isDark;
      // The server's own validator: what is saved is what would be accepted on submission.
      const probe = { name: "Check", theme: { isDark: theme.isDark, colors: theme.colors, ...(theme.alt && Object.keys(theme.alt.colors).length ? { alt: { colors: theme.alt.colors } } : {}) } };
      if (Object.keys(theme.colors).length) {
        try {
          normalizeThemePackSpec(probe, (u) => u);
        } catch (e) {
          fail(`The store would refuse that: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return { themePack: { ...data, theme }, text: `Set ${Object.keys(given).length} colour${Object.keys(given).length === 1 ? "" : "s"} on the ${scheme === "alt" ? `second (${theme.isDark ? "light" : "dark"})` : "main"} look.${scheme === "alt" && Object.keys(next).length === 0 ? " It has no colours yet, so it isn't sent until it does." : ""}` };
    }
    case "remove_theme_variant": {
      if (!theme.alt) return { text: "There is no second look to remove." };
      const { alt: _alt, ...rest } = theme;
      void _alt;
      return { themePack: { ...data, theme: rest }, text: "Removed the second look. The pack now has one look and forces its scheme." };
    }
    default:
      return fail(`Unknown tool: ${name}`);
  }
}

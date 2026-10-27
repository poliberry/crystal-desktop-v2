import {
  MOTION_LIMITS, contentEnd, evalColor, evalProp, newMotionId, parseRgba, sourceElapsed,
  type Clip, type ColorProp, type Ease, type Key, type MotionSpec, type Prop, type Transition,
} from "../../../convex/lib/motion";

/**
 * Editing a motion timeline, as plain functions on plain data.
 *
 * Nothing here touches React or the DOM, so every rule of the editor — what splitting a clip does to its keyframes,
 * what trimming does to its speed ramp, where a dragged clip snaps — is a function that can be tested. The editor
 * only turns pointer movements into calls to these, and everything returns new objects (never edits in place), so
 * undo is just keeping the previous one.
 *
 * Time is in seconds; the editor works in frames of 1/30 s, which `snapFrame` rounds to.
 */

export const FPS = 30;
export const FRAME = 1 / FPS;
/** The shortest a clip can be: two frames (and above the schema's 0.05 s floor, so nothing is ever bumped on load). */
export const MIN_CLIP = 2 * FRAME;
const EPS = 1e-6;

export const snapFrame = (t: number) => Math.round(t * FPS) / FPS;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));

/** `0:03:12` style timecode: minutes:seconds:frames. */
export function timecode(t: number): string {
  const total = Math.max(0, Math.round(t * FPS));
  const f = total % FPS;
  const s = Math.floor(total / FPS) % 60;
  const m = Math.floor(total / FPS / 60);
  return `${m}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

/** Back from `timecode`, or from plain seconds ("1.5", "1.5s"); null if unreadable. */
export function parseTimecode(text: string): number | null {
  const s = text.trim();
  const tc = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(s);
  if (tc) return +tc[1] * 60 + +tc[2] + +tc[3] / FPS;
  const two = /^(\d+):(\d{1,2})$/.exec(s);
  if (two) return +two[1] * 60 + +two[2];
  const sec = /^(\d*\.?\d+)\s*s?$/.exec(s);
  return sec ? parseFloat(sec[1]) : null;
}

// --- Keyframes ----------------------------------------------------------------------------------

type AnyProp = Prop | ColorProp;
const keysOf = <V,>(p: { k: Key<V>[] }) => p.k;

/** `#rrggbb` (or `#rrggbbaa` when not opaque) from the `rgba(…)` text `evalColor` makes. */
export function rgbaToHex(css: string): string {
  const [r, g, b, a] = parseRgba(css);
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}${a < 0.999 ? h(a * 255) : ""}`;
}

const isColor = (p: AnyProp): p is ColorProp => typeof p === "string" || (typeof p === "object" && typeof p.k[0]?.v === "string");

/** A property's value at `t`, as a number or a hex colour. */
export function valueAt(p: Prop, t: number): number;
export function valueAt(p: ColorProp, t: number): string;
export function valueAt(p: AnyProp, t: number): number | string {
  return isColor(p) ? rgbaToHex(evalColor(p as ColorProp, t)) : evalProp(p as Prop, t);
}

/** Where a property has keys (empty for a constant). */
export const keyTimes = (p: AnyProp): number[] => (typeof p === "object" ? (p.k as Key<unknown>[]).map((k) => k.t) : []);
export const hasKeys = (p: AnyProp) => typeof p === "object" && p.k.length > 0;

/**
 * The property with a key at `t` holding `v`. A key within half a frame of `t` is replaced (keeping its easing unless
 * one is given); otherwise a new one is added. Setting a key on a constant turns it into an animated property that
 * starts from the constant — so the first diamond doesn't change how the clip looks before it.
 */
export function setKey(p: Prop, t: number, v: number, e?: Ease): Prop;
export function setKey(p: ColorProp, t: number, v: string, e?: Ease): ColorProp;
export function setKey(p: AnyProp, t: number, v: number | string, e?: Ease): AnyProp {
  const at = r3(Math.max(0, t));
  const keys: Key<number | string>[] = typeof p === "object" ? [...(p.k as Key<number | string>[])] : [{ t: 0, v: p as number | string, e: "linear" }];
  const near = keys.findIndex((k) => Math.abs(k.t - at) < FRAME / 2);
  if (near >= 0) keys[near] = { t: keys[near].t, v, e: e ?? keys[near].e };
  else {
    // A constant that gets its first key at t>0 keeps its old value from 0 to t.
    keys.push({ t: at, v, e: e ?? "linear" });
    keys.sort((a, b) => a.t - b.t);
  }
  if (keys.length > MOTION_LIMITS.keys) return p;
  return { k: keys } as AnyProp;
}

/** The key nearest `t` removed; the last key left becomes the constant. */
export function removeKeyAt(p: AnyProp, t: number): AnyProp {
  if (typeof p !== "object") return p;
  const keys = (p.k as Key<number | string>[]).filter((k) => Math.abs(k.t - t) >= FRAME / 2);
  if (keys.length === (p.k as unknown[]).length) return p;
  if (keys.length === 0) return (p.k as Key<number | string>[])[0].v as AnyProp;
  if (keys.length === 1) return keys[0].v as AnyProp;
  return { k: keys } as AnyProp;
}

/** A property made constant again at its value at `t` (the diamond switched off for the whole property). */
export function freezeProp(p: AnyProp, t: number): AnyProp {
  return typeof p === "object" ? (valueAt(p as never, t) as AnyProp) : p;
}

export function moveKey(p: AnyProp, from: number, to: number): AnyProp {
  if (typeof p !== "object") return p;
  const target = r3(Math.max(0, to));
  const old = p.k as Key<number | string>[];
  const moved = old.find((k) => Math.abs(k.t - from) < FRAME / 2);
  if (!moved) return p;
  const m = { ...moved, t: target };
  // Whatever was already at the destination is replaced by the key that was moved there.
  const out = [...old.filter((k) => k !== moved && Math.abs(k.t - target) >= FRAME / 2), m].sort((a, b) => a.t - b.t);
  return out.length === 1 ? (out[0].v as AnyProp) : ({ k: out } as AnyProp);
}

export function setKeyEase(p: AnyProp, at: number, e: Ease): AnyProp {
  if (typeof p !== "object") return p;
  return { k: (p.k as Key<number | string>[]).map((k) => (Math.abs(k.t - at) < FRAME / 2 ? { ...k, e } : k)) } as AnyProp;
}

/** The key before `t` and the key after it (to step the playhead between keys). */
export function neighbourKeys(p: AnyProp, t: number): { prev: number | null; next: number | null } {
  const ts = keyTimes(p);
  const prev = [...ts].reverse().find((k) => k < t - FRAME / 2);
  const next = ts.find((k) => k > t + FRAME / 2);
  return { prev: prev ?? null, next: next ?? null };
}

/**
 * The property as seen from `d` seconds later: its value at time `t` is the old value at `t + d`. Used when the
 * start of a clip is cut (a positive `d`) so its animation stays where it was on the timeline, and a key is put at
 * the cut so the value there doesn't jump. A negative `d` (the clip was extended earlier) just moves keys later.
 */
export function shiftProp(p: Prop, d: number): Prop;
export function shiftProp(p: ColorProp, d: number): ColorProp;
export function shiftProp(p: AnyProp, d: number): AnyProp {
  if (typeof p !== "object" || Math.abs(d) < EPS) return p;
  const old = p.k as Key<number | string>[];
  if (d < 0) return { k: old.map((k) => ({ ...k, t: r3(k.t - d) })) } as AnyProp;
  const kept = old.filter((k) => k.t > d + EPS).map((k) => ({ ...k, t: r3(k.t - d) }));
  const before = [...old].reverse().find((k) => k.t <= d + EPS);
  const v0 = valueAt(p as never, d);
  if (kept.length === 0) return v0 as AnyProp;
  if (kept[0].t > EPS) kept.unshift({ t: 0, v: v0, e: before?.e ?? "linear" });
  return { k: kept } as AnyProp;
}

// --- Whole-clip property mapping -------------------------------------------------------------------

/** Apply `num` to every number property of a clip and `col` to every colour property, leaving the rest as it is. */
export function mapClipProps(clip: Clip, num: (p: Prop) => Prop, col: (p: ColorProp) => ColorProp): Clip {
  const tf = clip.transform;
  const s = clip.source;
  let source = s;
  switch (s.type) {
    case "shape":
      source = { ...s, fill: col(s.fill), stroke: col(s.stroke) };
      break;
    case "text":
      source = { ...s, color: col(s.color) };
      break;
    case "solid":
      source = { ...s, color: col(s.color) };
      break;
    case "gradient":
      source = { ...s, angle: num(s.angle), stops: s.stops.map((st) => ({ ...st, c: col(st.c) })) };
      break;
    case "noise":
      source = { ...s, color: col(s.color) };
      break;
    case "rays":
      source = { ...s, color: col(s.color) };
      break;
  }
  return {
    ...clip,
    source,
    transform: { ...tf, x: num(tf.x), y: num(tf.y), scaleX: num(tf.scaleX), scaleY: num(tf.scaleY), rotation: num(tf.rotation), opacity: num(tf.opacity) },
    speed: num(clip.speed),
    fx: clip.fx.map((f) => {
      switch (f.type) {
        case "blur":
          return { ...f, amount: num(f.amount) };
        case "glow":
          return { ...f, color: col(f.color), blur: num(f.blur), strength: num(f.strength) };
        case "shadow":
          return { ...f, color: col(f.color), x: num(f.x), y: num(f.y), blur: num(f.blur), opacity: num(f.opacity) };
        case "adjust":
          return { ...f, hue: num(f.hue), saturation: num(f.saturation), brightness: num(f.brightness), contrast: num(f.contrast) };
        case "tint":
          return { ...f, color: col(f.color), amount: num(f.amount) };
      }
    }),
    mask: clip.mask ? { ...clip.mask, x: num(clip.mask.x), y: num(clip.mask.y), w: num(clip.mask.w), h: num(clip.mask.h) } : undefined,
  };
}

/** The clip as seen from `d` seconds into it: every animated property shifted (see `shiftProp`). */
export const shiftClip = (clip: Clip, d: number): Clip => mapClipProps(clip, (p) => shiftProp(p, d), (p) => shiftProp(p, d));

/** Every animated property of a clip, labelled, for the inspector and the animation lanes. */
export type PropRef = { id: string; label: string; kind: "number" | "color" };

// --- Clips ------------------------------------------------------------------------------------------------

export const endOf = (c: Clip) => c.start + c.duration;
const overlaps = (a: Clip, b: Clip) => a.start < endOf(b) - EPS && b.start < endOf(a) - EPS;

/** The lowest lane where a clip of this span fits without covering another, starting the search at `from`. */
export function freeTrack(clips: Clip[], start: number, duration: number, from = 0, ignore: Set<string> = new Set()): number {
  const probe = { start, duration } as Clip;
  for (let t = from; t < 32; t++) {
    if (!clips.some((c) => !ignore.has(c.id) && c.track === t && overlaps(c, probe))) return t;
  }
  return 31;
}

export function addClip(clips: Clip[], clip: Clip): Clip[] {
  const track = freeTrack(clips, clip.start, clip.duration, clip.track);
  return [...clips, { ...clip, track }];
}

const patchClip = (clips: Clip[], id: string, fn: (c: Clip) => Clip) => clips.map((c) => (c.id === id ? fn(c) : c));
export const setClip = patchClip;

// --- Snapping ----------------------------------------------------------------------------------------------

/** The times a dragged edge snaps to: the playhead, the ends of the design, and the edges of other clips. */
export function snapPoints(clips: Clip[], opts: { playhead: number; duration: number; exclude?: Set<string> }): number[] {
  const pts = [0, opts.duration, opts.playhead];
  for (const c of clips) {
    if (opts.exclude?.has(c.id)) continue;
    pts.push(c.start, endOf(c));
  }
  return pts;
}

/** `t` moved to the nearest snap point within `tol` seconds, or to the nearest frame if none is. */
export function snapTime(t: number, points: number[], tol: number): { t: number; snapped: number | null } {
  let best: number | null = null;
  let d = tol;
  for (const p of points) {
    const dd = Math.abs(p - t);
    if (dd <= d) {
      d = dd;
      best = p;
    }
  }
  return best === null ? { t: snapFrame(t), snapped: null } : { t: best, snapped: best };
}

// --- Moving ------------------------------------------------------------------------------------------------

/**
 * Move clips by `dt` seconds and `dTrack` lanes. The group moves as one: it is stopped when its first clip reaches
 * 0 or its last reaches the end of the design, and every clip keeps its place relative to the others. With `avoid`,
 * a clip that would land on top of another in its lane is moved up to the first lane where it fits.
 */
export function moveClips(clips: Clip[], ids: Set<string>, dt: number, dTrack: number, duration: number, avoid = true): Clip[] {
  const moving = clips.filter((c) => ids.has(c.id));
  if (moving.length === 0) return clips;
  const lo = Math.min(...moving.map((c) => c.start));
  const hi = Math.max(...moving.map(endOf));
  const d = clamp(dt, -lo, Math.max(-lo, duration - hi));
  const lanes = clamp(dTrack, -Math.min(...moving.map((c) => c.track)), 31 - Math.max(...moving.map((c) => c.track)));
  const moved = clips.map((c) => (ids.has(c.id) ? { ...c, start: r3(c.start + d), track: c.track + lanes } : c));
  if (!avoid) return moved;
  // Whatever lands on top of something that stayed is lifted to a free lane.
  const stayed = moved.filter((c) => !ids.has(c.id));
  const out = [...stayed];
  const placed: Clip[] = [];
  for (const c of moved.filter((c) => ids.has(c.id)).sort((a, b) => a.start - b.start)) {
    const t = freeTrack([...out, ...placed], c.start, c.duration, c.track);
    placed.push({ ...c, track: t });
  }
  const byId = new Map(placed.map((c) => [c.id, c]));
  return moved.map((c) => byId.get(c.id) ?? c);
}

/** A clip's span after `dt` more seconds of start, kept inside [0, duration]. */
export const clampStart = (clip: Clip, start: number, duration: number) => clamp(start, 0, Math.max(0, duration - clip.duration));

// --- Trimming -----------------------------------------------------------------------------------------------

/** Seconds of source a clip consumes over `local` seconds of its own time. */
const elapsed = (c: Clip, local: number) => sourceElapsed(c.speed, local);

/**
 * Cut or extend the start of a clip so it begins at `newStart`, keeping everything that stays on screen exactly where
 * it was: its animation does not move on the timeline, and the source (a compound clip's contents, a generator's own
 * clock) carries on from the same place.
 */
export function trimStart(clip: Clip, newStart: number): Clip {
  const end = endOf(clip);
  let s = clamp(newStart, 0, end - MIN_CLIP);
  // A compound clip can't start before the start of its contents: it can only be pulled earlier by what is in front of its in-point.
  if (s < clip.start && clip.source.type === "compound" && !clip.loop && !clip.reverse) {
    const s0 = clamp(typeof clip.speed === "number" ? clip.speed : evalProp(clip.speed, 0), 0.05, 16);
    s = Math.max(s, clip.start - clip.in / s0);
  }
  const d = s - clip.start;
  if (Math.abs(d) < EPS) return clip;
  if (d > 0) {
    const cut = shiftClip(clip, d);
    return {
      ...cut,
      start: r3(s),
      duration: Math.max(MIN_CLIP, r3(end - s)),
      in: clip.reverse ? clip.in : r3(clip.in + elapsed(clip, d)),
      transitionIn: undefined,
    };
  }
  // Extended earlier: what was there is later by -d, so the animation moves later with it. The source starts
  // earlier by what the new stretch consumes, at the speed the clip starts with.
  const ext = -d;
  const grown = shiftClip(clip, d);
  const s0 = clamp(typeof clip.speed === "number" ? clip.speed : evalProp(clip.speed, 0), 0.05, 16);
  return {
    ...grown,
    start: r3(s),
    duration: r3(clip.duration + ext),
    in: clip.reverse ? clip.in : r3(Math.max(0, clip.in - s0 * ext)),
  };
}

/** Cut or extend the end of a clip so it finishes at `newEnd`. A reversed clip's source start follows, so its picture stays put. */
export function trimEnd(clip: Clip, newEnd: number, designDuration: number): Clip {
  const e = clamp(newEnd, clip.start + MIN_CLIP, designDuration);
  const duration = Math.max(MIN_CLIP, r3(e - clip.start));
  if (Math.abs(duration - clip.duration) < EPS) return clip;
  const grown = duration > clip.duration;
  return {
    ...clip,
    duration,
    in: clip.reverse ? r3(Math.max(0, clip.in + elapsed(clip, clip.duration) - elapsed(clip, duration))) : clip.in,
    transitionOut: grown ? clip.transitionOut : clip.transitionOut && clip.transitionOut.d > duration ? { ...clip.transitionOut, d: duration } : clip.transitionOut,
  };
}

// --- Splitting ----------------------------------------------------------------------------------------------

/**
 * Split a clip in two at timeline time `t` (the blade). Played end to end the two look exactly as the one did: the
 * second takes over its animation, retime and source position, the first keeps the in-transition and the second
 * the out-transition. Returns null if `t` isn't inside the clip by at least a frame either side.
 */
export function splitClip(clip: Clip, t: number): [Clip, Clip] | null {
  const local = r3(t - clip.start);
  if (local < MIN_CLIP - EPS || clip.duration - local < MIN_CLIP - EPS) return null;
  const shifted = shiftClip(clip, local);
  const total = elapsed(clip, clip.duration);
  const left: Clip = {
    ...clip,
    duration: local,
    transitionOut: undefined,
    // Reversed, the earlier half on the timeline is the later half of the source.
    in: clip.reverse ? r3(clip.in + total - elapsed(clip, local)) : clip.in,
  };
  const right: Clip = {
    ...shifted,
    id: newMotionId(),
    name: clip.name,
    start: r3(t),
    duration: r3(clip.duration - local),
    in: clip.reverse ? clip.in : r3(clip.in + elapsed(clip, local)),
    transitionIn: undefined,
  };
  return [left, right];
}

export function splitAt(clips: Clip[], t: number, ids?: Set<string>): Clip[] {
  const out: Clip[] = [];
  for (const c of clips) {
    const hit = c.on && t > c.start && t < endOf(c) && (!ids || ids.has(c.id));
    const parts = hit ? splitClip(c, t) : null;
    if (parts) out.push(...parts);
    else out.push(c);
  }
  return out;
}

// --- Deleting, duplicating -----------------------------------------------------------------------------------

/**
 * Delete clips. With `ripple`, later clips in the same lane move earlier to close the gap — and, as in a magnetic timeline,
 * only clips that start at or after the deleted one's end are moved.
 */
export function deleteClips(clips: Clip[], ids: Set<string>, ripple = false): Clip[] {
  if (!ripple) return clips.filter((c) => !ids.has(c.id));
  const gone = clips.filter((c) => ids.has(c.id));
  return clips
    .filter((c) => !ids.has(c.id))
    .map((c) => {
      const shift = gone.filter((g) => g.track === c.track && c.start >= endOf(g) - EPS).reduce((s, g) => s + g.duration, 0);
      return shift ? { ...c, start: r3(Math.max(0, c.start - shift)) } : c;
    });
}

/** Copies placed straight after the originals' group, in the first lane each fits. */
export function duplicateClips(clips: Clip[], ids: Set<string>, duration: number): { clips: Clip[]; ids: string[] } {
  const src = clips.filter((c) => ids.has(c.id));
  if (src.length === 0) return { clips, ids: [] };
  const lo = Math.min(...src.map((c) => c.start));
  const hi = Math.max(...src.map(endOf));
  const shift = Math.min(hi - lo, Math.max(0, duration - hi)) || FRAME;
  let out = clips;
  const made: string[] = [];
  for (const c of src) {
    const copy = JSON.parse(JSON.stringify(c)) as Clip;
    copy.id = newMotionId();
    copy.start = r3(Math.min(c.start + shift, Math.max(0, duration - c.duration)));
    copy.name = c.name;
    out = addClip(out, copy);
    made.push(copy.id);
  }
  return { clips: out, ids: made };
}

// --- Retime ----------------------------------------------------------------------------------------------------

/**
 * Change a clip's constant speed while it keeps consuming the same stretch of its source — so doubling the speed halves
 * its length on the timeline, as in Final Cut. Its animation is stretched with it. Returns the clip unchanged if the
 * result would not fit in the design.
 */
export function retimeConstant(clip: Clip, speed: number, designDuration: number): Clip {
  const old = typeof clip.speed === "number" ? clip.speed : 1;
  const next = clamp(speed, 0.05, 16);
  const factor = old / next;
  const duration = r3(clip.duration * factor);
  if (duration < MIN_CLIP || clip.start + duration > designDuration + EPS) return clip;
  const stretch = (p: Prop): Prop => (typeof p === "object" ? { k: p.k.map((k) => ({ ...k, t: r3(k.t * factor) })) } : p);
  const stretchC = (p: ColorProp): ColorProp => (typeof p === "object" ? { k: p.k.map((k) => ({ ...k, t: r3(k.t * factor) })) } : p);
  const out = mapClipProps(clip, stretch, stretchC);
  return {
    ...out,
    speed: next,
    duration,
    transitionIn: clip.transitionIn && { ...clip.transitionIn, d: Math.min(clip.transitionIn.d, duration) },
    transitionOut: clip.transitionOut && { ...clip.transitionOut, d: Math.min(clip.transitionOut.d, duration) },
  };
}

export const setReverse = (clip: Clip, reverse: boolean): Clip => (clip.reverse === reverse ? clip : { ...clip, reverse });

/** A speed ramp: keys on the speed so it eases between `from` and `to` across the clip (the length on the timeline stays). */
export function speedRamp(clip: Clip, from: number, to: number, e: Ease = "inOut"): Clip {
  return { ...clip, speed: { k: [{ t: 0, v: clamp(from, 0.05, 16), e }, { t: r3(clip.duration), v: clamp(to, 0.05, 16), e: "linear" }] } };
}

// --- Transitions ------------------------------------------------------------------------------------------------

export function setTransition(clip: Clip, side: "in" | "out", tr: Transition | undefined): Clip {
  const t = tr && { ...tr, d: clamp(tr.d, FRAME, clip.duration) };
  return side === "in" ? { ...clip, transitionIn: t } : { ...clip, transitionOut: t };
}

// --- Compound clips -----------------------------------------------------------------------------------------------

/**
 * Wrap clips in a compound clip (what FCP calls a compound clip): they become one clip on the timeline whose contents
 * can be opened and edited. It spans exactly from the earliest start to the latest end, and the contents keep their
 * timing, so the result plays identically.
 */
export function makeCompound(clips: Clip[], ids: Set<string>): { clips: Clip[]; id: string } | null {
  const sel = clips.filter((c) => ids.has(c.id));
  if (sel.length === 0) return null;
  const start = Math.min(...sel.map((c) => c.start));
  const end = Math.max(...sel.map(endOf));
  const minTrack = Math.min(...sel.map((c) => c.track));
  const inner = sel.map((c) => ({ ...c, start: r3(c.start - start), track: c.track - minTrack }));
  const id = newMotionId();
  const compound: Clip = {
    id,
    name: "Compound clip",
    track: minTrack,
    start: r3(start),
    duration: r3(end - start),
    in: 0,
    speed: 1,
    reverse: false,
    loop: false,
    source: { type: "compound", duration: r3(end - start), clips: inner },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 },
    blend: "normal",
    fx: [],
    on: true,
  };
  return { clips: [...clips.filter((c) => !ids.has(c.id)), compound], id };
}

/** Whether a compound clip can be opened back out onto the timeline without changing how it plays. */
export function canBreakApart(clip: Clip): boolean {
  const t = clip.transform;
  const plain = typeof t.x === "number" && t.x === 0 && typeof t.y === "number" && t.y === 0 && t.scaleX === 1 && t.scaleY === 1 && t.rotation === 0 && t.opacity === 1;
  return clip.source.type === "compound" && plain && clip.speed === 1 && !clip.reverse && clip.in === 0 && clip.fx.length === 0 && !clip.mask && clip.blend === "normal" && !clip.transitionIn && !clip.transitionOut;
}

/** The inverse of `makeCompound`: the contents go back on the timeline where they played. */
export function breakApart(clips: Clip[], id: string): { clips: Clip[]; ids: string[] } | null {
  const c = clips.find((x) => x.id === id);
  if (!c || !canBreakApart(c) || c.source.type !== "compound") return null;
  const inner = c.source.clips.filter((i) => i.start < c.duration);
  const out = inner.map((i) => ({ ...i, start: r3(c.start + i.start), duration: r3(Math.min(i.duration, c.duration - i.start)), track: i.track + c.track }));
  return { clips: [...clips.filter((x) => x.id !== id), ...out], ids: out.map((o) => o.id) };
}

// --- Scopes (editing inside a compound clip) ------------------------------------------------------------------------

/** The clips and length of the timeline at the end of `path`, a chain of compound clip ids from the top. */
export function scopeOf(spec: MotionSpec, path: string[]): { clips: Clip[]; duration: number } | null {
  let clips = spec.clips;
  let duration = spec.duration;
  for (const id of path) {
    const c = clips.find((x) => x.id === id);
    if (!c || c.source.type !== "compound") return null;
    clips = c.source.clips;
    duration = c.source.duration;
  }
  return { clips, duration };
}

/** The design with the clips at `path` replaced by `fn` of them. */
export function mapScope(spec: MotionSpec, path: string[], fn: (clips: Clip[], duration: number) => Clip[]): MotionSpec {
  if (path.length === 0) return { ...spec, clips: fn(spec.clips, spec.duration) };
  const [head, ...rest] = path;
  const recurse = (clips: Clip[]): Clip[] =>
    clips.map((c) => {
      if (c.id !== head || c.source.type !== "compound") return c;
      const src = c.source;
      if (rest.length === 0) return { ...c, source: { ...src, clips: fn(src.clips, src.duration) } };
      return { ...c, source: { ...src, clips: mapScopeClips(src, rest, fn) } };
    });
  return { ...spec, clips: recurse(spec.clips) };
}
function mapScopeClips(src: { duration: number; clips: Clip[] }, path: string[], fn: (clips: Clip[], duration: number) => Clip[]): Clip[] {
  const [head, ...rest] = path;
  return src.clips.map((c) => {
    if (c.id !== head || c.source.type !== "compound") return c;
    if (rest.length === 0) return { ...c, source: { ...c.source, clips: fn(c.source.clips, c.source.duration) } };
    return { ...c, source: { ...c.source, clips: mapScopeClips(c.source, rest, fn) } };
  });
}

/** Where a clip is in the whole design, by id, searching inside compound clips: the chain of compounds to open to reach it. */
export function pathTo(spec: MotionSpec, id: string): string[] | null {
  const walk = (clips: Clip[], path: string[]): string[] | null => {
    for (const c of clips) {
      if (c.id === id) return path;
      if (c.source.type === "compound") {
        const r = walk(c.source.clips, [...path, c.id]);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(spec.clips, []);
}

// --- Design length ------------------------------------------------------------------------------------------------------

/** The design's length set to `d` seconds; clips that no longer fit are shortened or dropped. */
export function setDuration(spec: MotionSpec, d: number): MotionSpec {
  const dur = clamp(r3(d), 0.1, MOTION_LIMITS.duration);
  const clips = spec.clips
    .filter((c) => c.start < dur - EPS)
    .map((c) => (endOf(c) > dur + EPS ? { ...c, duration: r3(dur - c.start) } : c));
  return { ...spec, duration: dur, clips };
}

/** The design's length set to where its last clip ends. */
export const fitDuration = (spec: MotionSpec): MotionSpec => (spec.clips.length ? setDuration(spec, Math.max(0.5, contentEnd(spec.clips))) : spec);

/** Turn a lane on or off: the clips in it are all skipped while it is off. */
export function setLane(clips: Clip[], track: number, on: boolean): Clip[] {
  return clips.map((c) => (c.track === track ? { ...c, on } : c));
}

/** The lane order changed: lane `from` swapped with lane `to`. */
export function swapLanes(clips: Clip[], from: number, to: number): Clip[] {
  return clips.map((c) => (c.track === from ? { ...c, track: to } : c.track === to ? { ...c, track: from } : c));
}

// --- Addressing a property ------------------------------------------------------------------------------------------
//
// The inspector, the keyframe diamonds, the animation lanes and the curve editor all talk about "this clip's X": a path
// like `transform.x`, `fx.1.blur`, `source.fill`, `mask.w` or `speed`. These read and write by path, immutably.

type Rec = Record<string, unknown>;

/** The value at `path` in a clip, or undefined. */
export function getPath(clip: Clip, path: string): unknown {
  let cur: unknown = clip;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Rec)[part];
  }
  return cur;
}

/** The clip with the value at `path` replaced (a copy along the path; nothing else is copied). */
export function setPath(clip: Clip, path: string, value: unknown): Clip {
  const parts = path.split(".");
  const go = (node: unknown, i: number): unknown => {
    const key = parts[i];
    if (Array.isArray(node)) {
      const idx = Number(key);
      const copy = node.slice();
      copy[idx] = i === parts.length - 1 ? value : go(node[idx], i + 1);
      return copy;
    }
    const rec = (node ?? {}) as Rec;
    return { ...rec, [key]: i === parts.length - 1 ? value : go(rec[key], i + 1) };
  };
  return go(clip, 0) as Clip;
}

/** A property that can be animated: a number, or a colour (a hex string or colour keys). */
export const isPropValue = (v: unknown): v is Prop | ColorProp =>
  typeof v === "number" || (typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v)) || (typeof v === "object" && v !== null && Array.isArray((v as { k?: unknown }).k));

/**
 * Set a property at clip time `local`. If it is animated — or `autoKey` is on — the value becomes a keyframe there
 * (so editing while keyed never changes how the clip looks at other times); otherwise it replaces the constant.
 */
export function setPropAt(clip: Clip, path: string, local: number, value: number | string, autoKey = false): Clip {
  const cur = getPath(clip, path);
  if (!isPropValue(cur)) return clip;
  const keyed = hasKeys(cur) || autoKey;
  const next = keyed ? (typeof value === "string" ? setKey(cur as ColorProp, local, value) : setKey(cur as Prop, local, value)) : value;
  return setPath(clip, path, next);
}

/** The diamond: a key where there isn't one (holding the current value, so nothing moves), or no key where there is. */
export function toggleKeyAt(clip: Clip, path: string, local: number): Clip {
  const cur = getPath(clip, path);
  if (!isPropValue(cur)) return clip;
  const near = keyTimes(cur).some((t) => Math.abs(t - local) < FRAME / 2);
  if (near) return setPath(clip, path, removeKeyAt(cur, local));
  const here = valueAt(cur as never, local) as number | string;
  return setPath(clip, path, typeof here === "string" ? setKey(cur as ColorProp, local, here) : setKey(cur as Prop, local, here));
}

/** Whether a property has a key at `local`. */
export function keyedAt(clip: Clip, path: string, local: number): boolean {
  const cur = getPath(clip, path);
  return isPropValue(cur) && keyTimes(cur).some((t) => Math.abs(t - local) < FRAME / 2);
}

/** Make a property constant again, at its value at `local`: all of its keys removed. */
export function clearKeys(clip: Clip, path: string, local: number): Clip {
  const cur = getPath(clip, path);
  return isPropValue(cur) ? setPath(clip, path, freezeProp(cur, local)) : clip;
}

/** Every property of a clip that is animated, for the animation lanes under a clip: path, label and where its keys are. */
export function animatedProps(clip: Clip): { path: string; label: string; times: number[] }[] {
  const out: { path: string; label: string; times: number[] }[] = [];
  const add = (path: string, label: string) => {
    const v = getPath(clip, path);
    if (isPropValue(v) && hasKeys(v)) out.push({ path, label, times: keyTimes(v) });
  };
  for (const [k, l] of [["x", "Position X"], ["y", "Position Y"], ["scaleX", "Scale X"], ["scaleY", "Scale Y"], ["rotation", "Rotation"], ["opacity", "Opacity"]] as const) add(`transform.${k}`, l);
  clip.fx.forEach((f, i) => {
    const names: Record<string, [string, string][]> = {
      blur: [["amount", "Blur"]],
      glow: [["color", "Glow colour"], ["blur", "Glow size"], ["strength", "Glow strength"]],
      shadow: [["color", "Shadow colour"], ["x", "Shadow X"], ["y", "Shadow Y"], ["blur", "Shadow blur"], ["opacity", "Shadow opacity"]],
      adjust: [["hue", "Hue"], ["saturation", "Saturation"], ["brightness", "Brightness"], ["contrast", "Contrast"]],
      tint: [["color", "Tint colour"], ["amount", "Tint amount"]],
    };
    for (const [k, l] of names[f.type] ?? []) add(`fx.${i}.${k}`, l);
  });
  if (clip.mask) for (const [k, l] of [["x", "Mask X"], ["y", "Mask Y"], ["w", "Mask width"], ["h", "Mask height"]] as const) add(`mask.${k}`, l);
  add("speed", "Speed");
  const s = clip.source;
  if (s.type === "shape") { add("source.fill", "Fill"); add("source.stroke", "Stroke"); }
  if (s.type === "text") add("source.color", "Text colour");
  if (s.type === "solid" || s.type === "noise" || s.type === "rays") add("source.color", "Colour");
  if (s.type === "gradient") { add("source.angle", "Angle"); s.stops.forEach((_, i) => add(`source.stops.${i}.c`, `Stop ${i + 1}`)); }
  return out;
}

/** Where a source rests relative to the stage's centre (a picture drawn off-centre); zero for generators. */
export { restOffset as restOf } from "../../../convex/lib/motion";

/** The range a property's graph is drawn over: the keys' values with a margin, so a curve that overshoots stays in view. */
export function valueRange(p: Prop): { min: number; max: number } {
  if (typeof p === "number") return { min: p - 1, max: p + 1 };
  const vs = p.k.map((k) => k.v);
  let min = Math.min(...vs);
  let max = Math.max(...vs);
  if (max - min < 1e-6) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.2;
  return { min: min - pad, max: max + pad };
}

/**
 * Frame the viewer's transform handles act on: a clip's source box, at its resolved place, as four corners in stage units,
 * and the pivot — so the editor can draw handles and hit-test them without knowing how a clip is drawn.
 */
export function clipQuad(r: { x: number; y: number; sx: number; sy: number; rotation: number; anchorX: number; anchorY: number }, box: { w: number; h: number; ox: number; oy: number }, stage: { w: number; h: number }) {
  const px = stage.w / 2 + r.x + box.ox;
  const py = stage.h / 2 + r.y + box.oy;
  const a = (r.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const pt = (u: number, v: number) => {
    const lx = (u - r.anchorX) * box.w * r.sx;
    const ly = (v - r.anchorY) * box.h * r.sy;
    return { x: px + lx * cos - ly * sin, y: py + lx * sin + ly * cos };
  };
  return { tl: pt(0, 0), tr: pt(1, 0), br: pt(1, 1), bl: pt(0, 1), centre: pt(0.5, 0.5), pivot: { x: px, y: py }, rotationHandle: (() => { const top = pt(0.5, 0); const c = pt(0.5, 0.5); const d = Math.hypot(top.x - c.x, top.y - c.y) || 1; return { x: top.x + ((top.x - c.x) / d) * 28, y: top.y + ((top.y - c.y) / d) * 28 }; })() };
}

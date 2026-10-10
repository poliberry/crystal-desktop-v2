import { BRUSH_LABEL, BRUSH_TYPES, BRUSH_USES, MAX_STAMPS, brushMarks, brushPolygons, brushReach, cleanBrush, defaultBrush, fitFreehand, flattenPath, resample, simplify, stampShape, taperAt } from "../../src/studio/model/brush";
import type { Brush, PathPoint } from "../../src/studio/model/types";

const DEF_J = defaultBrush("spray").jitter;
let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
type Pt = { x: number; y: number };

const line = (n = 40, len = 200): Pt[] => Array.from({ length: n + 1 }, (_, i) => ({ x: (i / n) * len, y: 0 }));
const area = (poly: Pt[]) => { let a = 0; for (let i = 0; i < poly.length; i++) { const q = poly[(i + 1) % poly.length]; a += poly[i].x * q.y - q.x * poly[i].y; } return Math.abs(a / 2); };
const bounds = (polys: Pt[][]) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of polys) for (const t of q) { x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x); y1 = Math.max(y1, t.y); } return { x0, y0, x1, y1 }; };
const finite = (polys: Pt[][]) => polys.every((q) => q.every((t) => Number.isFinite(t.x) && Number.isFinite(t.y)));
const same = (a: Pt[][], b: Pt[][]) => JSON.stringify(a) === JSON.stringify(b);

// --- flatten and resample -----------------------------------------------------------------------------
{
  const straight: PathPoint[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  const fl = flattenPath(straight, false, 100, 50)[0];
  ok("a straight segment flattens to its two ends, scaled by the box", fl.length === 2 && fl[1].x === 100 && fl[1].y === 0, fl);
  const curve: PathPoint[] = [{ x: 0, y: 0, outX: 0, outY: 1 }, { x: 1, y: 1, inX: 0, inY: 1 }];
  const c = flattenPath(curve, false, 100, 100, 2)[0];
  ok("a curve becomes many short pieces that stay on it", c.length > 20 && Math.abs(c[0].x) < 1e-9 && Math.abs(c[c.length - 1].x - 100) < 1e-9 && Math.abs(c[c.length - 1].y - 100) < 1e-9, c.length);
  ok("…and bulge towards the control point", c.some((q) => q.x < 20 && q.y > 50));
  const finer = flattenPath(curve, false, 100, 100, 0.5)[0], coarser = flattenPath(curve, false, 100, 100, 8)[0];
  ok("a smaller step gives more pieces", finer.length > coarser.length);
  ok("a closed path comes back to its start", (() => { const t = flattenPath([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], true, 10, 10)[0]; return t[t.length - 1].x === 0 && t[t.length - 1].y === 0; })());
  const two = flattenPath([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.2, y: 0.5, m: true }, { x: 0.8, y: 0.5 }], false, 10, 10);
  ok("a compound path gives one line per contour", two.length === 2);
  ok("an empty path gives nothing", flattenPath([], false, 10, 10).length === 0);

  const r = resample(line(3, 90), 10);
  ok("resampling measures the length", Math.abs(r.length - 90) < 1e-9, r.length);
  ok("…spaces samples evenly, ends included", r.samples.length === 10 && r.samples[0].x === 0 && Math.abs(r.samples[9].x - 90) < 1e-9 && r.samples.every((s, i) => i === 0 || Math.abs(s.s - r.samples[i - 1].s - 10) < 1e-6));
  ok("…and gives each the direction of travel", r.samples.every((s) => Math.abs(s.tx - 1) < 1e-9 && Math.abs(s.ty) < 1e-9));
  const bend = resample([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }], 5);
  ok("direction follows a bend", bend.samples[0].tx > 0.9 && bend.samples[bend.samples.length - 1].ty > 0.9);
  ok("a single point or repeated points can't be walked along", resample([{ x: 1, y: 1 }], 5).samples.length === 0 && resample([{ x: 1, y: 1 }, { x: 1, y: 1 }], 5).samples.length === 0);
  ok("a zero or negative step doesn't hang", resample(line(2, 10), 0).samples.length > 1 && resample(line(2, 10), -3).samples.length > 1);
}

// --- tapers -----------------------------------------------------------------------------------------------
{
  ok("a taper is 0 at the ends and 1 in the middle", taperAt(0, 100, 0.5) === 0 && taperAt(100, 100, 0.5) === 0 && taperAt(50, 100, 0.5) === 1);
  ok("it rises smoothly in between", taperAt(10, 100, 0.5) > 0 && taperAt(10, 100, 0.5) < taperAt(20, 100, 0.5));
  ok("no taper means full width everywhere", taperAt(0, 100, 0) === 1 && taperAt(100, 100, 0) === 1);
  ok("a zero-length line is safe", taperAt(0, 0, 0.5) === 1);
  ok("it is symmetric", Math.abs(taperAt(13, 100, 0.6) - taperAt(87, 100, 0.6)) < 1e-9);
}

// --- every brush -----------------------------------------------------------------------------------------
for (const type of BRUSH_TYPES) {
  const b = defaultBrush(type);
  const polys = brushMarks(line(), b, 12);
  ok(`${type}: draws something`, polys.length > 0 && polys.every((q) => q.length >= 3), polys.length);
  ok(`${type}: only real numbers`, finite(polys));
  ok(`${type}: same brush, same marks`, same(polys, brushMarks(line(), { ...b }, 12)));
  ok(`${type}: it has a name and a record of what it uses`, !!BRUSH_LABEL[type] && !!BRUSH_USES[type]);
  const bb = bounds(polys);
  const reach = brushReach(b) * 12;
  ok(`${type}: marks stay within the reach the picture makes room for`, bb.y0 >= -reach - 0.5 && bb.y1 <= reach + 0.5 && bb.x0 >= -reach - 0.5 && bb.x1 <= 200 + reach + 0.5, { bb, reach });
  ok(`${type}: a bigger brush makes bigger marks`, (() => { const s = bounds(brushMarks(line(), b, 6)), l = bounds(brushMarks(line(), b, 24)); return l.y1 - l.y0 > s.y1 - s.y0; })());
  ok(`${type}: a one-point line draws nothing and doesn't throw`, brushMarks([{ x: 5, y: 5 }], b, 10).length === 0);
  if (type !== "taper" && type !== "calligraphy" && type !== "ink" ) ok(`${type}: another seed scatters differently`, !same(polys, brushMarks(line(), { ...b, seed: 2 }, 12)));
  const long = brushMarks(line(400, 400000), b, 4);
  ok(`${type}: a huge stroke is capped, not a million marks`, long.length <= MAX_STAMPS + 4, long.length);
}

// --- what makes each one itself ------------------------------------------------------------------------------
{
  const mid = (polys: Pt[][], x: number, tol = 0.6) => { let lo = Infinity, hi = -Infinity; for (const q of polys) for (const t of q) if (Math.abs(t.x - x) < tol) { lo = Math.min(lo, t.y); hi = Math.max(hi, t.y); } return hi - lo; };
  const tp = brushMarks(line(80, 200), { ...defaultBrush("taper"), taper: 0.6 }, 20);
  ok("a tapered stroke is full width in the middle", Math.abs(mid(tp, 100) - 20) < 1.5, mid(tp, 100));
  ok("…and thin near the ends", mid(tp, 4) < 10 && mid(tp, 196) < 10, [mid(tp, 4), mid(tp, 196)]);
  ok("…the same at both ends", Math.abs(mid(tp, 8) - mid(tp, 192)) < 1.5);
  const blunt = brushMarks(line(80, 200), { ...defaultBrush("taper"), taper: 0 }, 20);
  ok("with no taper it's the same width all along", Math.abs(mid(blunt, 4) - 20) < 1.5 && Math.abs(mid(blunt, 100) - 20) < 1.5);
  const ink = brushMarks(line(80, 200), { ...defaultBrush("ink"), jitter: 0 }, 20);
  ok("ink keeps a little width at its ends", mid(ink, 1) > 2, mid(ink, 1));
  const wob = brushMarks(line(80, 200), { ...defaultBrush("ink"), jitter: 1 }, 20);
  const widths = [40, 70, 100, 130, 160].map((x) => mid(wob, x));
  ok("ink varies in width like pressure on a pen", Math.max(...widths) - Math.min(...widths) > 1.5, widths);

  // Calligraphy: a nib at 0° is thick across a vertical stroke and thin along a horizontal one.
  const nib = { ...defaultBrush("calligraphy"), angle: 0 };
  const horiz = bounds(brushMarks([{ x: 0, y: 0 }, { x: 100, y: 0 }], nib, 20));
  const vert = bounds(brushMarks([{ x: 0, y: 0 }, { x: 0, y: 100 }], nib, 20));
  ok("a flat nib is thin when moving along its edge and thick across it", horiz.y1 - horiz.y0 < 1 && vert.x1 - vert.x0 > 19, { h: horiz, v: vert });
  const turned = bounds(brushMarks([{ x: 0, y: 0 }, { x: 100, y: 0 }], { ...nib, angle: 90 }, 20));
  ok("turning the nib turns that", turned.y1 - turned.y0 > 19, turned);

  // Shape brushes.
  const dots = brushMarks(line(40, 200), { ...defaultBrush("dots"), spacing: 2, jitter: 0 }, 10);
  ok("dots are spaced by the gap, in stroke widths", dots.length >= 9 && dots.length <= 12, dots.length);
  const closer = brushMarks(line(40, 200), { ...defaultBrush("dots"), spacing: 1, jitter: 0 }, 10);
  ok("a smaller gap means more dots", closer.length > dots.length * 1.6);
  ok("dots are round: the mark's area is about πr²", Math.abs(area(dots[3]) - Math.PI * 25) < 8, area(dots[3]));
  const star = stampShape("stars", 0, 0, 10, 0);
  ok("a star has ten points, alternately far and near", star.length === 10 && Math.abs(Math.hypot(star[0].x, star[0].y) - 5) < 1e-9 && Math.abs(Math.hypot(star[1].x, star[1].y) - 2.25) < 1e-9);
  const heart = stampShape("hearts", 0, 0, 10, 0);
  const hb = bounds([heart]);
  ok("a heart fits its box and has its point down", hb.x1 - hb.x0 <= 10.5 && hb.y1 - hb.y0 <= 10.5 && heart.reduce((a, t) => (t.y > a.y ? t : a)).x < 1.2 && Math.abs(heart.reduce((a, t) => (t.y > a.y ? t : a)).x) < 1.2);
  const sp = stampShape("sparkles", 0, 0, 10, 0);
  ok("a sparkle is a four-pointed star", sp.length === 8 && Math.hypot(sp[0].x, sp[0].y) > Math.hypot(sp[1].x, sp[1].y) * 3);
  ok("a mark can be turned", Math.abs(stampShape("stars", 0, 0, 10, Math.PI)[0].y - 5) < 1e-9);

  // Chalk is broken up; spray is scattered around the line.
  const chalk = brushMarks(line(40, 200), defaultBrush("chalk"), 14);
  ok("chalk is many small specks, not a solid ribbon", chalk.length > 40 && chalk.every((q) => area(q) < 14 * 14 * 0.1));
  ok("…and drier with more jitter", brushMarks(line(40, 200), { ...defaultBrush("chalk"), jitter: 1 }, 14).length < brushMarks(line(40, 200), { ...defaultBrush("chalk"), jitter: 0 }, 14).length);
  const spray = brushMarks(line(40, 200), defaultBrush("spray"), 14);
  const above = spray.filter((q) => q[0].y < 0).length, below = spray.filter((q) => q[0].y > 0).length;
  ok("spray falls on both sides of the line", above > 10 && below > 10, { above, below });
  const inner = spray.filter((q) => Math.abs(q[0].y) < 3).length;
  ok("…densest at the line", inner > spray.length / 4, { inner, total: spray.length });
}

// --- the whole path --------------------------------------------------------------------------------------
{
  const pts: PathPoint[] = [{ x: 0, y: 0.5, outX: 0.3, outY: 0 }, { x: 1, y: 0.5, inX: 0.7, inY: 1 }];
  const polys = brushPolygons(pts, false, 200, 100, defaultBrush("taper"), 10);
  ok("a curve drawn with a brush gives polygons on the curve", polys.length > 0 && finite(polys));
  const bb = bounds(polys);
  ok("…spanning the curve's width", bb.x0 < 5 && bb.x1 > 195);
  ok("a compound path draws each contour", brushPolygons([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1, m: true }, { x: 1, y: 1 }], false, 100, 100, defaultBrush("dots"), 6).length > brushPolygons([{ x: 0, y: 0 }, { x: 1, y: 0 }], false, 100, 100, defaultBrush("dots"), 6).length);
  ok("a very thin brush still draws", brushMarks(line(), defaultBrush("taper"), 0.01).length > 0);
}

// --- cleaning ---------------------------------------------------------------------------------------------
{
  ok("every brush has defaults that are valid", BRUSH_TYPES.every((t) => JSON.stringify(cleanBrush(defaultBrush(t))) === JSON.stringify(defaultBrush(t))));
  const dirty = cleanBrush({ type: "spray", taper: 9, angle: -1e9, spacing: 0, jitter: NaN, seed: 1e12 }) as Brush;
  ok("a hand-edited brush is clamped", dirty.taper === 1 && dirty.angle === -360 && dirty.spacing === 0.3 && dirty.jitter === DEF_J && dirty.seed === 99999, dirty);
  ok("an unknown brush is dropped", cleanBrush({ type: "laser" }) === undefined && cleanBrush(null) === undefined && cleanBrush("ink") === undefined);
}

// --- freehand ---------------------------------------------------------------------------------------------
{
  const wobblyLine = Array.from({ length: 80 }, (_, i) => ({ x: i * 3, y: Math.sin(i * 12.9898) * 0.6 }));
  ok("simplify drops points that are within tolerance of a line", simplify(wobblyLine, 2).length === 2);
  ok("…and keeps a corner", simplify([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }], 2).length === 3);
  ok("…and the ends always", (() => { const s = simplify(wobblyLine, 0.001); return s[0] === wobblyLine[0] && s[s.length - 1] === wobblyLine[wobblyLine.length - 1]; })());
  ok("simplifying never makes it longer", simplify(wobblyLine, 0.1).length <= wobblyLine.length);
  const stay = (orig: Pt[], simp: Pt[], tol: number) => orig.every((q) => simp.some((s, i) => i < simp.length - 1 && (() => { const a = s, b = simp[i + 1]; const dx = b.x - a.x, dy = b.y - a.y; const L = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / L)); return Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy)) <= tol + 1e-6; })()));
  const arc = Array.from({ length: 60 }, (_, i) => ({ x: Math.cos(i / 20) * 100, y: Math.sin(i / 20) * 100 }));
  ok("every original point stays within tolerance of the result", stay(arc, simplify(arc, 3), 3));

  const fit = fitFreehand(arc, 1.5);
  ok("a drawn arc becomes a few smooth anchors, not sixty", fit.length >= 3 && fit.length < 25, fit.length);
  ok("…with handles on the inner anchors", fit.slice(1, -1).every((q) => q.outX !== undefined && q.inX !== undefined));
  ok("…and the ends where the stroke began and finished", fit[0].x === arc[0].x && fit[fit.length - 1].x === arc[arc.length - 1].x);
  ok("handles are symmetric about their anchor's tangent (smooth, no kink)", fit.slice(1, -1).every((q) => { const a = Math.atan2(q.outY! - q.y, q.outX! - q.x), b = Math.atan2(q.y - q.inY!, q.x - q.inX!); return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-6; }));
  const corner = fitFreehand([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }, { x: 80, y: 80 }], 1);
  ok("a sharp turn stays a corner", corner.length === 3 && corner[1].inX === undefined && corner[1].outX === undefined, corner);
  ok("a straight drag is a straight two-point line", (() => { const s = fitFreehand(Array.from({ length: 30 }, (_, i) => ({ x: i * 5, y: i * 2 })), 1); return s.length === 2 && s[0].outX === undefined; })());
  ok("a click (one point, or repeats) is no path", fitFreehand([{ x: 1, y: 1 }], 1).length === 0 && fitFreehand([{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 }], 1).length === 0);
  ok("everything it returns is a real number", fit.every((q) => Object.values(q).every((v) => typeof v === "boolean" || Number.isFinite(v as number))));
}

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);

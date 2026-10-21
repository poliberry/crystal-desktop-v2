/**
 * Profile effects, remade: 600 × 700, transparent, laid over a whole profile card.
 *
 * The card's middle is someone's name and words, so each effect keeps it clear and works the edges, corners and foot.
 * Motion is slow and periodic (see kit.ts): an 8-second idle after a 1.6-second intro in which the effect fades up
 * (applied by the renderer to the finished frame) and settles into place.
 */
import { STAGES, TAU, blend, cloud, coin, crystal, dot, drift, gem, glow, glowEllipse, lerp, linear, rgba, rng, smooth, spark, starPath, streak, type Ctx, type Design, type Time } from "./kit";
import { cloudLight, drawBolt, layer, makeBolt, paintBank, rain, reach, splashes, strike } from "./storm";

const W = STAGES.effect.w;
const H = STAGES.effect.h;
const INTRO = 1.6;
const IDLE = 8;
/** The storm designs take a longer idle, so their lightning can come slowly. */
const STORM_IDLE = 10;

/** A gentle settle during the intro: `e` goes 0 → 1 and is 1 from the end of the intro. */
const settled = (t: Time, delay = 0, dur = 1.3) => t.enter(delay, dur);

/**
 * Lightning Frame: a thunderhead in each corner of the card, and lightning running between them along the edges, one
 * side after another, round the frame. Each bolt draws itself from one cloud to the next, lighting both from inside,
 * and fades; between strikes the frame rests as a faint, cool rim.
 */
const FRAME_CLOUDS = [
  { seed: 61, x0: -60, x1: 250, base: -6, height: 80, rise: false, puffs: 30, rMin: 22, rMax: 48, light: [100, 50] as const },
  { seed: 67, x0: W - 250, x1: W + 60, base: -6, height: 84, rise: false, puffs: 30, rMin: 22, rMax: 48, light: [W - 100, 54] as const },
  { seed: 71, x0: W - 240, x1: W + 60, base: H + 6, height: 70, rise: true, puffs: 28, rMin: 22, rMax: 44, light: [W - 100, H - 40] as const },
  { seed: 73, x0: -60, x1: 240, base: H + 6, height: 70, rise: true, puffs: 28, rMin: 22, rMax: 44, light: [100, H - 40] as const },
];
/** Top, right, bottom and left: each from one corner's cloud to the next, clockwise, hugging the edge. */
const FRAME_BOLTS: { at: number; from: number; to: number; bolt: ReturnType<typeof makeBolt> }[] = [
  { at: 0.04, from: 0, to: 1, bolt: makeBolt(5, [170, 58], [W - 170, 66], 2, 0.16, 0.6) },
  { at: 0.24, from: 1, to: 2, bolt: makeBolt(12, [W - 40, 56], [W - 44, H - 60], 3, 0.12, 0.45) },
  { at: 0.44, from: 2, to: 3, bolt: makeBolt(19, [W - 170, H - 70], [170, H - 64], 2, 0.16, 0.6) },
  { at: 0.62, from: 3, to: 0, bolt: makeBolt(26, [42, H - 60], [40, 56], 3, 0.12, 0.45) },
];

const lightningFrame: Design = {
  slug: "lightning-frame-effect",
  name: "Lightning Frame",
  kind: "effect",
  description: "Storm cloud gathered in each corner of the card and lightning running between them along the edges, one side after another, each bolt lighting the clouds it joins before it fades, round a faint, cool rim.",
  intro: INTRO,
  idle: STORM_IDLE,
  draw: (g, t) => {
    const e = settled(t, 0, 1.4);
    const strikes = FRAME_BOLTS.map((b) => strike(t, b.at, 0.5, 0.1, 1.4));
    // How lit each corner's cloud is: by the bolts that start or end there.
    const lit = FRAME_CLOUDS.map((_, i) => FRAME_BOLTS.reduce((sum, b, k) => sum + (b.from === i || b.to === i ? strikes[k] * (b.from === i ? 1 : 0.75) : 0), 0));
    const any = Math.min(1, strikes.reduce((a, b) => a + b, 0));

    // The rim: faint and cool, a little brighter while a bolt is out.
    const inset = 14 + (1 - e) * 8;
    g.save();
    g.beginPath();
    g.roundRect(inset, inset, W - inset * 2, H - inset * 2, 30);
    g.filter = "blur(5px)";
    g.strokeStyle = rgba("#5b7fbf", 0.16 + 0.06 * any);
    g.lineWidth = 12;
    g.stroke();
    g.filter = "none";
    g.strokeStyle = rgba("#a9c0e8", (0.34 + 0.12 * any + 0.04 * t.wave(1)) * e);
    g.lineWidth = 1.4;
    g.stroke();
    g.restore();

    // A light drizzle down the two sides.
    const pour = t.enter(0.5, 1);
    const edges = (x: number) => Math.max(0, 1 - Math.min(x, W - x) / 110);
    rain(g, t, { n: 40, seed: 31, k: 7, x0: -20, x1: W + 20, top: 96, bottom: H - 70, len: 22, width: 1.1, color: "#8ea1bb", alpha: 0.45 * pour, slant: 0.2, weight: (x) => edges(x) });

    // The bolts, each drawing itself from its cloud and fading with the light it makes.
    FRAME_BOLTS.forEach((b, k) => drawBolt(g, b.bolt, reach(t, b.at, 0.45), 0.8 * strikes[k] * e, "#9ab5ec", "#f3f7ff", 0.9));

    // The thunderheads, over the ends of the bolts, lit from within.
    const drop = (1 - e) * 14;
    FRAME_CLOUDS.forEach((c, i) => {
      const down = i < 2 ? -drop : drop;
      layer(g, `frame-cloud-${i}`, 0.95, "blur(3.2px)", (l) => {
        l.translate(0, down);
        paintBank(l, t, { ...c, deep: "#161b27", body: "#2b3344", edge: "#66738c", sway: 8, phase: i / 4, boil: 0.06 });
        cloudLight(l, c.light[0], c.light[1], 170, 110, "#c4d3f2", 0.5 * Math.min(1, lit[i]));
      });
    });
  },
};

const summoningCircle: Design = {
  slug: "summoning-circle-effect",
  name: "Summoning Circle",
  kind: "effect",
  description: "A circle of runes glowing at the foot of the card, turning slowly against a second ring, with a soft pillar of light and embers drifting up through it.",
  intro: 2,
  idle: IDLE,
  draw: (g, t) => {
    const e = settled(t, 0, 1.7);
    const cx = W / 2;
    const cy = H - 92;
    blend(g, "lighter", () => {
      // The pillar: soft on every side, brightest at the circle.
      glowEllipse(g, cx, cy - 150, 110, 360, "#d8b4fe", 0.2 * e, 0.45);
      glowEllipse(g, cx, cy - 40, 90, 160, "#f5d0fe", 0.16 * e, 0.4);
      glowEllipse(g, cx, cy, 300, 120, "#a855f7", 0.4);
      g.save();
      g.translate(cx, cy);
      g.scale(1, 0.36);
      const s = 0.9 + 0.1 * e;
      g.scale(s, s);
      g.lineWidth = 3;
      g.strokeStyle = rgba("#c4b5fd", 0.85);
      g.beginPath();
      g.arc(0, 0, 240, 0, TAU);
      g.stroke();
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(0, 0, 214, 0, TAU);
      g.stroke();
      g.save();
      g.rotate((TAU / 10) * t.u);
      for (let i = 0; i < 10; i++) {
        g.save();
        g.rotate((i / 10) * TAU);
        g.translate(0, -227);
        g.strokeStyle = rgba("#f5d0fe", 0.9);
        g.lineWidth = 2.4;
        g.beginPath();
        g.moveTo(-6, -5);
        g.lineTo(0, 6);
        g.lineTo(6, -5);
        g.moveTo(-4, 0);
        g.lineTo(4, 0);
        g.stroke();
        g.restore();
      }
      g.restore();
      g.save();
      g.rotate(-(TAU / 6) * t.u);
      starPath(g, 0, 0, 170, 6, 0.58, 0);
      g.strokeStyle = rgba("#67e8f9", 0.7);
      g.lineWidth = 2;
      g.stroke();
      g.beginPath();
      g.arc(0, 0, 150, 0, TAU);
      g.strokeStyle = rgba("#a5f3fc", 0.5);
      g.stroke();
      g.restore();
      g.restore();
      drift(t, 22, 9, 1, (i, p, f, r) => {
        const x = cx + (r() - 0.5) * 260 + Math.sin(TAU * (p + r())) * 16;
        const y = lerp(cy + 10, cy - 460 - r() * 80, p);
        spark(g, x, y, 3 + r() * 3, i % 3 ? "#f5d0fe" : "#a5f3fc", 0.7 * f, 0, i % 4 === 0);
      });
    });
  },
};

const treasureRain: Design = {
  slug: "treasure-rain-effect",
  name: "Treasure Rain",
  kind: "effect",
  description: "Gold coins and a few jewels drifting slowly down the edges of the card, turning as they fall, under a warm fan of light.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    blend(g, "lighter", () => {
      g.save();
      g.translate(W / 2, -40);
      g.rotate(Math.PI / 2);
      for (let i = -4; i <= 4; i++) {
        g.save();
        g.rotate(i * 0.16);
        g.beginPath();
        g.moveTo(0, 0);
        g.arc(0, 0, 640, -0.045, 0.045);
        g.closePath();
        g.fillStyle = linear(g, 0, 0, 420, 0, [[0, rgba("#fcd34d", 0.1)], [1, rgba("#fcd34d", 0)]]);
        g.fill();
        g.restore();
      }
      g.restore();
      glowEllipse(g, W / 2, H + 20, 360, 120, "#f59e0b", 0.3);
    });
    // Coins keep to the sides; the middle, where the name is, stays clear.
    const lane = (r: () => number) => (r() < 0.5 ? 30 + r() * 150 : W - 30 - r() * 150);
    drift(t, 12, 2, 1, (i, p, f, r) => {
      const x = lane(r) + Math.sin(TAU * (p + r())) * 10;
      const y = lerp(-30, H + 30, p);
      coin(g, x, y, 10 + r() * 3, p + r(), 0.92 * f, (r() - 0.5) * 0.6);
    });
    drift(t, 6, 6, 1, (i, p, f, r) => {
      const x = lane(r);
      gem(g, x, lerp(-30, H + 30, p), 7 + r() * 3, ["#f43f5e", "#38bdf8", "#34d399", "#c084fc"][i % 4], f, Math.sin(TAU * (p + r())) * 0.6);
    });
    blend(g, "lighter", () => {
      const r = rng(12);
      for (let i = 0; i < 8; i++) {
        const x = r() < 0.5 ? 20 + r() * 160 : W - 20 - r() * 160;
        spark(g, x, 40 + r() * (H - 80), 6 + r() * 4, "#fff7d6", 0.45 * Math.pow(t.swell(1, r()), 2), 0.2);
      }
    });
  },
};

const starlitNight: Design = {
  slug: "starlit-night-effect",
  name: "Starlit Night",
  kind: "effect",
  description: "A deep blue night over the top of the card: a moon in a soft halo, stars glimmering gently at two depths, one slow shooting star a loop and a low drift of cloud.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    g.fillStyle = linear(g, 0, 0, 0, H * 0.55, [[0, rgba("#0b1030", 0.8)], [0.5, rgba("#1e3a8a", 0.3)], [1, rgba("#1e3a8a", 0)]]);
    g.fillRect(0, 0, W, H * 0.55);
    blend(g, "lighter", () => {
      glow(g, 470, 110, 150, "#fff1c4", 0.22 + 0.04 * t.wave(1));
      const r = rng(8);
      for (let i = 0; i < 46; i++) {
        const x = r() * W;
        const y = r() * H * 0.45;
        const near = i % 4 === 0;
        const a = (near ? 0.45 : 0.3) + (near ? 0.3 : 0.18) * t.swell(1, r());
        if (near) spark(g, x, y, 4 + r() * 2.5, "#ffffff", a, 0, true);
        else dot(g, x, y, 1 + r() * 0.9, "#e0e7ff", a);
      }
      // One slow shooting star a loop, crossing in a second and a half.
      const p = (t.u - 0.5) / 0.19;
      if (p > 0 && p < 1) {
        const x = lerp(90, 340, p);
        const y = lerp(70, 200, p);
        const a = Math.sin(Math.PI * p) * 0.7;
        streak(g, x - 90, y - 47, 100, Math.atan2(47, 90), "#c7d2fe", a, 2);
        glow(g, x + 10, y + 5, 10, "#ffffff", a);
      }
    });
    dot(g, 470, 110, 34, "#fff6d8", 1);
    dot(g, 458, 100, 7, "#efe0b6", 0.9);
    dot(g, 482, 122, 5, "#efe0b6", 0.85);
    dot(g, 476, 96, 3.5, "#efe0b6", 0.8);
    blend(g, "screen", () => {
      cloud(g, 160 + 30 * t.wave(1), H * 0.4, 380, 60, "#6366f1", 0.32, 5);
      cloud(g, 470 + 26 * t.wave(1, 0.5), H * 0.47, 320, 50, "#818cf8", 0.26, 9);
    });
  },
};

/**
 * Storm Chaser's lightning. A profile card shows only the middle of the effect when it is narrow (the effect is fitted
 * `cover`), and its upper third is someone's avatar, name and bio, so the storm keeps to a thin band of cloud along the
 * very top, a short bolt dropping just out of it, and rain that is dense only under the cloud and at the foot.
 */
const CHASER_BOLT = makeBolt(17, [392, 62], [412, 150], 2, 0.2, 0.7);
const CHASER_CRAWLER = makeBolt(29, [190, 34], [330, 24], 2, 0.12);

const stormChaserEffect: Design = {
  slug: "storm-chaser-effect",
  name: "Storm Chaser",
  kind: "effect",
  description: "A storm passing over the top of your profile: a band of dark rain cloud churning along the top edge, lightning glowing inside it and now and then a short distant bolt, light slanting rain, and mist with rain rings at the foot.",
  intro: 2,
  fadeIn: 1.85,
  idle: STORM_IDLE,
  draw: (g, t) => {
    const e = settled(t, 0, 1.8);
    // Three strikes a loop, all over well before the loop comes round (so none falls in the intro).
    const s1 = strike(t, 0.08, 0.55, 0.15, 1.9);
    const s2 = strike(t, 0.42, 0.6, 0.1, 1.7);
    const s3 = strike(t, 0.58, 0.7, 0.0, 1.3);

    // A light shade along the top edge only, so the cloud sits on something.
    g.fillStyle = linear(g, 0, 0, 0, 100, [[0, rgba("#121826", 0.4)], [1, rgba("#121826", 0)]]);
    g.fillRect(0, 0, W, 100);

    // The far cloud: a thin, translucent row just under the near one, lit from inside by the strikes.
    layer(g, "chaser-far", 0.62, "blur(2.6px)", (l) => {
      paintBank(l, t, { seed: 41, x0: -60, x1: W + 60, base: 40, height: 18, solid: true, puffs: 44, rMin: 12, rMax: 26, deep: "#283041", body: "#3b4558", edge: "#6b7790", sway: 10, phase: 0.1, boil: 0.06 });
      cloudLight(l, 400, 48, 170, 50, "#c3d2f2", 0.6 * s1);
      cloudLight(l, 230, 44, 150, 44, "#b9c8ea", 0.3 * s2);
      cloudLight(l, 320, 48, 120, 40, "#b9c8ea", 0.3 * s3);
    });
    // The bolt, dropping a little way out of the cloud and fading with its light.
    drawBolt(g, CHASER_BOLT, reach(t, 0.08, 0.45), 0.7 * s1 * e, "#9db6ec", "#f2f6ff", 0.85);

    // The near cloud along the top edge.
    layer(g, "chaser-near", 0.86, "blur(1.8px)", (l) => {
      paintBank(l, t, { seed: 7, x0: -60, x1: W + 60, base: 8, height: 20, solid: true, puffs: 40, rMin: 14, rMax: 30, deep: "#161b27", body: "#262e3e", edge: "#58647d", sway: 16, phase: 0.55, boil: 0.05 });
      cloudLight(l, 380, 20, 180, 44, "#c7d5f3", 0.3 * s1);
      cloudLight(l, 250, 18, 190, 44, "#c3d1f0", 0.5 * s2);
    });
    drawBolt(g, CHASER_CRAWLER, reach(t, 0.42, 0.5), 0.42 * s2 * e, "#a8bdf0", "#eef3ff", 0.7);

    // Rain: falling out of the cloud and fading before the profile's words, faint through the middle, and heavier
    // again towards the foot.
    const pour = t.enter(0.45, 1.05);
    const band = (y: number) => (y < 210 ? 1 - smooth((y - 70) / 140) * 0.85 : y > 470 ? 0.15 + 0.85 * smooth((y - 470) / 130) : 0.15) * (y > H - 40 ? Math.max(0, (H - y) / 40) : 1);
    rain(g, t, { n: 70, seed: 5, k: 7, x0: -10, x1: W + 10, top: 48, bottom: H, len: 18, width: 1, color: "#8ea1bb", alpha: 0.4 * pour, slant: 0.24, weight: (_x, y) => band(y) });
    rain(g, t, { n: 26, seed: 9, k: 9, x0: -10, x1: W + 10, top: 56, bottom: H, len: 32, width: 1.4, color: "#aebdd2", alpha: 0.4 * pour, slant: 0.24, weight: (_x, y) => band(y) });

    // Mist and rain rings at the foot.
    layer(g, "chaser-mist", 0.24 * e, "blur(10px)", (l) => {
      for (let i = 0; i < 6; i++) {
        const x = ((i + 0.5) / 6) * W + 22 * t.wave(1, i / 6);
        glowEllipse(l, x, H - 18 + 4 * t.wave(1, 0.3 + i / 7), 130, 34, "#7d8aa1", 0.5, 0.5);
      }
    });
    splashes(g, t, 12, 13, 3, 60, W - 60, H - 46, H - 12, "#b8c6da", 0.45 * pour);
  },
};

const confettiPop: Design = {
  slug: "confetti-pop-effect",
  name: "Confetti Pop",
  kind: "effect",
  description: "A gentle pop of confetti from the bottom corners as the card opens, then a slow, steady fall of confetti and glints down the sides, under soft pink, gold and teal light in the corners.",
  intro: 1.8,
  idle: IDLE,
  draw: (g, t) => {
    const party = ["#ff4d8d", "#ffd23f", "#2dd4bf", "#60a5fa", "#a78bfa"];
    // The edge light: pink, gold and teal pooled in the corners, still.
    blend(g, "lighter", () => {
      glow(g, 0, 0, 260, "#ff4d8d", 0.22);
      glow(g, W, 0, 260, "#ffd23f", 0.18);
      glow(g, 0, H, 260, "#2dd4bf", 0.2);
      glow(g, W, H, 260, "#ff4d8d", 0.2);
    });
    const piece = (x: number, y: number, spin: number, color: string, a: number, size = 1) => {
      if (a <= 0.01) return;
      g.save();
      g.translate(x, y);
      g.rotate(spin * 0.3);
      g.scale((Math.cos(spin) * 0.6 + 0.4) * size, size);
      g.fillStyle = rgba(color, a);
      g.fillRect(-7, -4, 14, 8);
      g.restore();
    };
    // The pop: thrown up and out from the two bottom corners, settling and fading before the intro ends.
    if (t.t < t.intro) {
      for (const side of [-1, 1]) {
        const r = rng(side > 0 ? 3 : 4);
        for (let i = 0; i < 22; i++) {
          const ang = (side < 0 ? -1.15 : -Math.PI + 1.15) + (r() - 0.5) * 0.7;
          const v = 380 + r() * 220;
          const s = Math.min(t.t, t.intro) * 0.95;
          const x = (side < 0 ? 20 : W - 20) + Math.cos(ang) * v * s * 0.9;
          const y = H - 20 + Math.sin(ang) * v * s + 260 * s * s;
          const a = Math.sin(Math.PI * Math.min(1, t.t / (t.intro * 0.98))) * 0.9;
          piece(x, y, TAU * (s * 2 + r()), party[i % 5], a);
        }
      }
    }
    const lane = (r: () => number) => (r() < 0.5 ? 20 + r() * 170 : W - 20 - r() * 170);
    drift(t, 30, 5, 1, (i, p, f, r) => {
      const x = lane(r) + Math.sin(TAU * (p * 2 + r())) * 14;
      piece(x, lerp(-20, H + 20, p), TAU * (p * 3 + r()), party[i % 5], 0.9 * f);
    });
    blend(g, "lighter", () => {
      const r = rng(41);
      for (let i = 0; i < 10; i++) {
        spark(g, lane(r), 30 + r() * (H - 60), 5 + r() * 3, "#fff7d6", 0.4 * Math.pow(t.swell(1, r()), 2), 0, true);
      }
    });
  },
};

/** A pair of eyes that slowly narrow and open again once a loop, at `at`. */
function sleepyEyes(g: Ctx, t: Time, x: number, y: number, at: number, size: number): void {
  const d = Math.abs(((t.u - at + 1.5) % 1) - 0.5);
  const lid = 1 - 0.72 * smooth(1 - d / 0.1);
  const look = 3 * t.wave(1, at);
  for (const side of [-1, 1]) {
    const ex = x + side * 26 * size;
    blend(g, "lighter", () => glowEllipse(g, ex, y, 26 * size, 18 * size * lid, "#fde047", 0.3));
    g.save();
    g.translate(ex, y);
    g.scale(1, lid);
    g.beginPath();
    g.ellipse(0, 0, 13 * size, 9 * size, 0, 0, TAU);
    g.fillStyle = "#facc15";
    g.fill();
    g.beginPath();
    g.ellipse(look * size, 0, 3.2 * size, 8 * size, 0, 0, TAU);
    g.fillStyle = "#1a0b22";
    g.fill();
    g.restore();
  }
}

const mischiefSmoke: Design = {
  slug: "mischief-smoke-effect",
  name: "Mischief Smoke",
  kind: "effect",
  description: "Violet and green smoke curling slowly up from the foot of the card inside a soft dark vignette, and two pairs of sleepy yellow eyes in the corners that narrow and open again in turn.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.46, W / 2, H / 2, Math.hypot(W, H) * 0.56);
    v.addColorStop(0, "rgba(7,8,24,0)");
    v.addColorStop(1, rgba("#070818", 0.6));
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
    blend(g, "lighter", () => {
      g.fillStyle = linear(g, 0, H, 0, H * 0.6, [[0, rgba("#a855f7", 0.3)], [1, rgba("#a855f7", 0)]]);
      g.fillRect(0, H * 0.6, W, H * 0.4);
      drift(t, 10, 47, 1, (i, p, f, r) => {
        const x = (r() < 0.5 ? r() * 200 : W - r() * 200) + Math.sin(TAU * (p + r())) * 30;
        const y = lerp(H + 50, H * 0.45, p);
        glow(g, x, y, 44 + r() * 22 + p * 24, i % 2 ? "#4ade80" : "#a855f7", 0.22 * f, 0.5);
      });
    });
    sleepyEyes(g, t, 130, 120, 0.3, 1.25);
    sleepyEyes(g, t, 470, 160, 0.72, 1);
    blend(g, "lighter", () =>
      drift(t, 12, 18, 1, (i, p, f, r) => {
        spark(g, r() * W, lerp(H, H * 0.2, p), 3 + r() * 2, i % 2 ? "#bbf7d0" : "#e9d5ff", 0.5 * f, 0, false);
      }),
    );
  },
};

const crystalBloom: Design = {
  slug: "crystal-bloom-effect",
  name: "Crystal Bloom",
  kind: "effect",
  description: "Crystals rising at the foot of the card in violet, cyan and magenta, glowing softly from within one after another, while dust drifts up through their light.",
  intro: 2,
  idle: IDLE,
  draw: (g, t) => {
    blend(g, "lighter", () => {
      glowEllipse(g, W / 2, H, 380, 200, "#7c3aed", 0.36 + 0.05 * t.wave(1));
      glowEllipse(g, W * 0.65, H - 30, 220, 150, "#06b6d4", 0.22 + 0.05 * t.wave(1, 0.5));
    });
    const body = ["#7c3aed", "#0891b2", "#c026d3", "#6366f1"];
    const light = ["#c4b5fd", "#a5f3fc", "#f0abfc", "#c7d2fe"];
    const dark = ["#4c1d95", "#155e75", "#86198f", "#3730a3"];
    const set: [number, number, number, number][] = [[50, 64, 150, -0.22], [118, 54, 110, -0.1], [190, 78, 210, -0.04], [262, 50, 120, 0.06], [338, 74, 190, 0.02], [410, 56, 132, 0.12], [478, 70, 176, 0.16], [552, 58, 120, 0.26]];
    set.forEach(([x, w, h, tilt], i) => {
      const e = t.enter(0.05 + i * 0.07, 1.4);
      crystal(g, x, H + 10, w, h * (0.88 + 0.12 * e), tilt, body[i % 4], light[i % 4], dark[i % 4], 1, 0.3 + 0.35 * t.swell(1, i / set.length));
    });
    blend(g, "lighter", () =>
      drift(t, 18, 6, 1, (i, p, f, r) => {
        spark(g, 30 + r() * (W - 60) + Math.sin(TAU * (p + r())) * 18, lerp(H - 60, H * 0.35, p), 2.5 + r() * 2.5, i % 2 ? "#e9d5ff" : "#a5f3fc", 0.6 * f, 0, false);
      }),
    );
  },
};

/** The creator collection's "Starlight", redrawn: a light scatter of glimmering stars. */
const starlight: Design = {
  slug: "starlight-effect",
  name: "Starlight",
  kind: "effect",
  description: "A light scatter of stars round the edges of your profile, each glimmering softly in its own time as a few motes drift up past them.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    blend(g, "lighter", () => {
      const r = rng(77);
      for (let i = 0; i < 34; i++) {
        // Mostly round the edge, a few further in.
        const edge = r();
        let x = r() * W;
        let y = r() * H;
        if (edge < 0.8) {
          const side = Math.floor(r() * 4);
          const depth = 20 + r() * 110;
          if (side === 0) y = depth;
          else if (side === 1) x = W - depth;
          else if (side === 2) y = H - depth;
          else x = depth;
        }
        const big = i % 3 === 0;
        const s = Math.pow(t.swell(1, r()), 1.5);
        if (big) spark(g, x, y, 5 + 3 * s, i % 2 ? "#fff7d6" : "#ffffff", 0.3 + 0.45 * s, 0, true);
        else dot(g, x, y, 1.2 + r(), "#fffbea", 0.25 + 0.35 * s);
      }
      drift(t, 10, 3, 1, (i, p, f, r) => {
        const x = r() < 0.5 ? 20 + r() * 140 : W - 20 - r() * 140;
        spark(g, x + Math.sin(TAU * (p + r())) * 10, lerp(H, 40, p), 2.5 + r() * 2, "#fff7d6", 0.5 * f, 0, false);
      });
    });
  },
};

/** The creator collection's "Night Sky", redrawn: a starfield under slow aurora ribbons. */
const nightSky: Design = {
  slug: "night-sky-effect",
  name: "Night Sky",
  kind: "effect",
  description: "Get cozy with a starry night: a calm field of stars across the card under slow ribbons of violet and teal aurora along the top.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    g.fillStyle = linear(g, 0, 0, 0, H * 0.5, [[0, rgba("#0a0f2c", 0.55)], [1, rgba("#0a0f2c", 0)]]);
    g.fillRect(0, 0, W, H * 0.5);
    blend(g, "lighter", () => {
      const ribbons: [string, number, number][] = [["#d25dea", 70, 0], ["#2dd4bf", 120, 0.33], ["#818cf8", 170, 0.66]];
      g.save();
      g.filter = "blur(7px)";
      for (const [col, base, ph] of ribbons) {
        const edge = (x: number) => base + 24 * Math.sin(x / 130 + TAU * (t.u + ph)) + 10 * Math.sin(x / 57 - TAU * (t.u + ph));
        g.beginPath();
        g.moveTo(-30, edge(-30));
        for (let x = -30; x <= W + 30; x += 10) g.lineTo(x, edge(x));
        for (let x = W + 30; x >= -30; x -= 10) g.lineTo(x, edge(x) - 64);
        g.closePath();
        g.fillStyle = linear(g, 0, base - 100, 0, base + 34, [[0, rgba(col, 0)], [0.72, rgba(col, 0.16)], [0.86, rgba(col, 0.2)], [1, rgba(col, 0)]]);
        g.fill();
      }
      g.restore();
      const r = rng(19);
      for (let i = 0; i < 90; i++) {
        const x = r() * W;
        const y = r() * H;
        const a = (y < H * 0.5 ? 0.5 : 0.3) * (0.55 + 0.45 * t.swell(1, r()));
        if (i % 9 === 0) spark(g, x, y, 4 + r() * 2, "#fef9c3", a, 0, true);
        else dot(g, x, y, 0.9 + r() * 0.9, i % 2 ? "#ffffff" : "#fef9c3", a);
      }
    });
  },
};

export const EFFECTS: Design[] = [lightningFrame, summoningCircle, treasureRain, starlitNight, stormChaserEffect, confettiPop, mischiefSmoke, crystalBloom, starlight, nightSky];


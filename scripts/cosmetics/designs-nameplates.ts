/**
 * Nameplates, remade: 960 × 176, opaque, drawn behind a name.
 *
 * The app draws a nameplate faintly and fades it towards the name (`fade-mask-l` at 20%), so each is a full-bleed scene
 * painted rich enough to read through that, with its subject in the right-hand half. Motion is slow and periodic (see
 * kit.ts): an 8-second idle after a 1.6-second intro in which the scene fades up and its subject settles into place.
 */
import { STAGES, TAU, blend, cloud, coin, crystal, dot, drift, gem, glow, glowEllipse, lerp, linear, mix, rgba, rng, smooth, spark, starPath, streak, type Ctx, type Design, type Time } from "./kit";
import { cloudLight, drawBolt, layer, makeBolt, paintBank, rain, reach, strike } from "./storm";

const W = STAGES.nameplate.w;
const H = STAGES.nameplate.h;
const INTRO = 1.6;
const IDLE = 8;

/**
 * The scene, drawn whole. The renderer fades the finished picture up over the intro (see render-entry.ts): fading the
 * parts one after another would darken a light card and then brighten it again, a flicker, if a slow one.
 */
function scene(_g: Ctx, _t: Time, fn: () => void): void {
  fn();
}
/** Its subject settles gently into place as it fades up: a few pixels of rise, nothing more. */
function settle(g: Ctx, t: Time, delay: number, fn: (e: number) => void, rise = 6): void {
  const e = t.enter(delay, 1.2);
  g.save();
  g.translate(0, (1 - e) * rise);
  fn(e);
  g.restore();
}
const bg = (g: Ctx, stops: [number, string][], vertical = true) => {
  g.fillStyle = vertical ? linear(g, 0, 0, 0, H, stops) : linear(g, 0, 0, W, 0, stops);
  g.fillRect(0, 0, W, H);
};

const lofiRooftop: Design = {
  slug: "lofi-rooftop-nameplate",
  name: "Lofi Rooftop",
  kind: "nameplate",
  description: "Dusk over a quiet city: a violet-to-pink sky, a soft moon, clouds drifting slowly and windows warming one by one along the skyline.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) =>
    scene(g, t, () => {
      bg(g, [[0, "#4b3fc4"], [0.55, "#9c5fd6"], [1, "#f794bd"]]);
      blend(g, "lighter", () => glowEllipse(g, 720, H, 420, 70, "#ffc6dd", 0.22));
      const r = rng(11);
      for (let i = 0; i < 20; i++) {
        const x = 420 + r() * 530;
        const y = 8 + r() * 70;
        spark(g, x, y, 2 + r() * 2.2, "#fff6e0", (0.35 + 0.3 * t.swell(1, r())) * t.enter(0.4 + r() * 0.6, 0.8), 0, false);
      }
      settle(g, t, 0.3, () => {
        blend(g, "lighter", () => glow(g, 820, 52, 90, "#ffe6bf", 0.28 + 0.05 * t.wave(1)));
        dot(g, 820, 52, 19, "#fff4dc", 1);
        dot(g, 813, 47, 4, "#f1e2c0", 0.8);
        dot(g, 827, 58, 3, "#f1e2c0", 0.7);
      });
      blend(g, "screen", () => {
        cloud(g, 640 + 26 * t.wave(1), 44, 260, 34, "#ffc8e6", 0.42, 3);
        cloud(g, 880 + 20 * t.wave(1, 0.5), 92, 200, 26, "#ffd9ee", 0.34, 9);
      });
      const far = rng(5);
      for (let x = 440; x < W; ) {
        const w = 60 + far() * 60;
        const h = 50 + far() * 40;
        g.fillStyle = rgba("#7a5ad0", 0.8);
        g.fillRect(x, H - h, w - 6, h);
        x += w;
      }
      const near = rng(17);
      for (let x = 400, b = 0; x < W + 40; b++) {
        const w = 70 + near() * 40;
        const h = 60 + near() * 55;
        g.fillStyle = "#30237a";
        g.fillRect(x, H - h, w - 8, h);
        // Windows, each warming and cooling once in the loop, out of step with its neighbours.
        for (let wy = H - h + 14; wy < H - 14; wy += 22) {
          for (let wx = x + 10; wx < x + w - 22; wx += 18) {
            const ph = near();
            if (ph < 0.35) continue;
            const a = (0.55 + 0.35 * t.swell(1, ph)) * t.enter(0.6 + ph * 0.8, 0.6);
            blend(g, "lighter", () => glow(g, wx + 4, wy + 5, 14, "#ffcf70", a * 0.25));
            g.fillStyle = rgba("#ffe3a0", a);
            g.fillRect(wx, wy, 8, 11);
          }
        }
        x += w;
      }
      g.fillStyle = "#211858";
      g.fillRect(0, H - 8, W, 8);
    }),
};

/** Storm Chaser's lightning: a distant bolt to the ground, and later a crawler inside the cloud. */
const NAMEPLATE_BOLT = makeBolt(23, [792, 74], [826, 160], 2, 0.2);
const NAMEPLATE_CRAWLER = makeBolt(37, [500, 46], [650, 36], 2, 0.14);

const stormChaser: Design = {
  slug: "storm-chaser-nameplate",
  name: "Storm Chaser",
  kind: "nameplate",
  description: "A storm front rolling in over dark hills: banks of rain cloud churning across the strip, slanting rain, and lightning lighting the clouds from within, with now and then a distant bolt.",
  intro: INTRO,
  idle: 10,
  draw: (g, t) =>
    scene(g, t, () => {
      const s1 = strike(t, 0.1, 0.55, 0.15, 1.9);
      const s2 = strike(t, 0.5, 0.6, 0.1, 1.7);
      bg(g, [[0, "#0c1220"], [0.6, "#182033"], [1, "#212b40"]]);
      // A glow low on the horizon, under the far storm.
      blend(g, "lighter", () => glowEllipse(g, 760, H - 20, 360, 70, "#4c5d82", 0.22 + 0.12 * s1));
      layer(g, "nameplate-far", 0.95, "blur(1.4px)", (l) => {
        paintBank(l, t, { seed: 43, x0: 360, x1: W + 70, base: 40, height: 46, puffs: 56, rMin: 14, rMax: 30, deep: "#20283a", body: "#323b4f", edge: "#5b6780", sway: 10, phase: 0.1, boil: 0.06 });
        cloudLight(l, 790, 60, 200, 70, "#c0cff0", 0.5 * s1);
        cloudLight(l, 570, 52, 170, 60, "#b8c7ea", 0.3 * s2);
      });
      drawBolt(g, NAMEPLATE_BOLT, reach(t, 0.1, 0.45), 0.85 * s1, "#9db6ec", "#f2f6ff", 0.8);
      // Dark hills along the foot, a faint sheen of wet light along their tops.
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += 24) g.lineTo(x, H - 16 - 9 * Math.sin(x / 140) - 5 * Math.sin(x / 53 + 1));
      g.lineTo(W, H);
      g.closePath();
      g.fillStyle = "#0a0e18";
      g.fill();
      const pour = t.enter(0.5, 0.9);
      rain(g, t, { n: 70, seed: 3, k: 6, x0: 320, x1: W + 10, top: 78, bottom: H, len: 14, width: 1, color: "#9fb2cb", alpha: 0.36 * pour, slant: 0.26 });
      layer(g, "nameplate-near", 0.97, "blur(1.6px)", (l) => {
        paintBank(l, t, { seed: 9, x0: 300, x1: W + 60, base: 6, height: 34, puffs: 48, rMin: 16, rMax: 34, deep: "#121722", body: "#222939", edge: "#535f77", sway: 14, phase: 0.55, boil: 0.05 });
        cloudLight(l, 760, 30, 200, 60, "#c7d5f3", 0.26 * s1);
        cloudLight(l, 580, 26, 200, 60, "#c3d1f0", 0.42 * s2);
      });
      drawBolt(g, NAMEPLATE_CRAWLER, reach(t, 0.5, 0.5), 0.45 * s2, "#a8bdf0", "#eef3ff", 0.6);
      rain(g, t, { n: 30, seed: 8, k: 8, x0: 360, x1: W + 10, top: 70, bottom: H, len: 24, width: 1.6, color: "#c2cfe1", alpha: 0.42 * pour, slant: 0.26 });
    }),
};

const runeCircle: Design = {
  slug: "rune-circle-nameplate",
  name: "Rune Circle",
  kind: "nameplate",
  description: "An arcane circle in violet and cyan: two rings of runes turning slowly against each other under a soft glow, with motes drifting up.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) =>
    scene(g, t, () => {
      bg(g, [[0, "#12062b"], [0.5, "#2a0f5e"], [1, "#43188a"]], false);
      const cx = 770;
      const cy = 88;
      blend(g, "lighter", () => glow(g, cx, cy, 210, "#b026d3", 0.3 + 0.05 * t.wave(1)));
      settle(g, t, 0.3, (e) => {
        g.save();
        g.translate(cx, cy);
        g.scale(0.92 + 0.08 * e, 0.92 + 0.08 * e);
        blend(g, "lighter", () => {
          // Outer ring: eight runes, an eighth of a turn per loop.
          g.save();
          g.rotate((TAU / 8) * t.u);
          g.strokeStyle = rgba("#c4b5fd", 0.85);
          g.lineWidth = 2.5;
          g.beginPath();
          g.arc(0, 0, 74, 0, TAU);
          g.stroke();
          g.lineWidth = 1;
          g.beginPath();
          g.arc(0, 0, 64, 0, TAU);
          g.stroke();
          for (let i = 0; i < 8; i++) {
            g.save();
            g.rotate((i / 8) * TAU);
            g.translate(0, -69);
            g.strokeStyle = rgba("#e9d5ff", 0.9);
            g.lineWidth = 1.6;
            g.beginPath();
            g.moveTo(-3, -3);
            g.lineTo(0, 3);
            g.lineTo(3, -3);
            g.moveTo(0, 3);
            g.lineTo(0, -4);
            g.stroke();
            g.restore();
          }
          g.restore();
          // Inner ring: six marks the other way.
          g.save();
          g.rotate(-(TAU / 6) * t.u);
          g.strokeStyle = rgba("#67e8f9", 0.75);
          g.lineWidth = 1.6;
          g.beginPath();
          g.arc(0, 0, 46, 0, TAU);
          g.stroke();
          starPath(g, 0, 0, 44, 6, 0.5, 0);
          g.strokeStyle = rgba("#a5f3fc", 0.45);
          g.lineWidth = 1.2;
          g.stroke();
          g.restore();
          spark(g, 0, 0, 13 + 1.2 * t.wave(1), "#ffffff", 0.85, 0, true);
          glow(g, 0, 0, 40, "#e879f9", 0.25 + 0.05 * t.wave(1, 0.25));
        });
        g.restore();
      }, 0);
      blend(g, "lighter", () =>
        drift(t, 16, 9, 2, (_, p, f, r) => {
          const x = cx + (r() - 0.5) * 230 + Math.sin(TAU * (p + r())) * 6;
          spark(g, x, lerp(H + 6, 10, p), 2.2 + r() * 2, r() < 0.5 ? "#e9d5ff" : "#a5f3fc", 0.6 * f * t.enter(0.8, 0.8), 0, false);
        }),
      );
    }),
};

const treasureVault: Design = {
  slug: "treasure-vault-nameplate",
  name: "Treasure Vault",
  kind: "nameplate",
  description: "A glittering hoard: a heap of gold and gems under slowly turning rays, with soft glints catching the light one after another.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) =>
    scene(g, t, () => {
      bg(g, [[0, "#2b1305"], [0.55, "#5e2e0e"], [1, "#94480f"]], false);
      const cx = 760;
      blend(g, "lighter", () => {
        g.save();
        g.translate(cx, 150);
        g.rotate((TAU / 12) * t.u);
        for (let i = 0; i < 12; i++) {
          g.rotate(TAU / 12);
          g.beginPath();
          g.moveTo(0, 0);
          g.arc(0, 0, 420, -0.07, 0.07);
          g.closePath();
          g.fillStyle = linear(g, 0, 0, 420, 0, [[0, rgba("#fde68a", 0.16)], [1, rgba("#fde68a", 0)]]);
          g.fill();
        }
        g.restore();
        glowEllipse(g, cx, 140, 300, 110, "#fbbf24", 0.32 + 0.05 * t.wave(1));
      });
      settle(g, t, 0.35, () => {
        const r = rng(31);
        // The heap: rows of coins, highest in the middle.
        for (let row = 0; row < 6; row++) {
          const y = H - 6 - row * 12;
          const half = 230 - row * 34;
          for (let x = cx - half; x <= cx + half; x += 26) {
            coin(g, x + (r() - 0.5) * 10, y + (r() - 0.5) * 4, 15, 0.02 + r() * 0.06, 1, (r() - 0.5) * 0.4);
          }
        }
        gem(g, cx - 60, H - 52, 11, "#f43f5e", 1, -0.2);
        gem(g, cx + 70, H - 44, 10, "#38bdf8", 1, 0.25);
        gem(g, cx + 6, H - 76, 12, "#34d399", 1, 0.05);
      });
      // A slow shine across the heap, and glints that swell and fade in turn.
      blend(g, "lighter", () => {
        const p = t.u;
        const x = lerp(500, 1040, p);
        const band = linear(g, x - 70, 0, x + 70, 0, [[0, rgba("#fff7d6", 0)], [0.5, rgba("#fff7d6", 0.16 * Math.sin(Math.PI * p))], [1, rgba("#fff7d6", 0)]]);
        g.fillStyle = band;
        g.fillRect(x - 70, 60, 140, H - 60);
        const pts: [number, number][] = [[640, 128], [705, 104], [760, 92], [820, 110], [880, 134], [735, 140], [800, 150]];
        pts.forEach(([gx, gy], i) => {
          // Each glint swells and fades over most of the loop: a slow catch of light, not a twinkle.
          const s = Math.pow(t.swell(1, i / pts.length), 2);
          spark(g, gx, gy, 6 + 3 * s, "#fff7d6", 0.5 * s, 0.3);
        });
      });
    }),
};

const goldenGroove: Design = {
  slug: "golden-groove-nameplate",
  name: "Golden Groove",
  kind: "nameplate",
  description: "Seventies sunset: thick violet, pink, orange and gold rings round a setting sun, breathing gently in front of a slowly turning sunburst.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) =>
    scene(g, t, () => {
      bg(g, [[0, "#3b0a45"], [0.5, "#86164d"], [1, "#b2401a"]], false);
      const cx = 770;
      const cy = 186;
      blend(g, "lighter", () => {
        g.save();
        g.translate(cx, cy);
        g.rotate((TAU / 9) * t.u);
        for (let i = 0; i < 18; i++) {
          g.rotate(TAU / 18);
          if (i % 2) continue;
          g.beginPath();
          g.moveTo(0, 0);
          g.arc(0, 0, 520, -0.09, 0.09);
          g.closePath();
          g.fillStyle = linear(g, 0, 0, 520, 0, [[0, rgba("#fdba74", 0.2)], [1, rgba("#fdba74", 0)]]);
          g.fill();
        }
        g.restore();
      });
      const bands = ["#6d28d9", "#db2777", "#ea580c", "#eab308", "#fde68a"];
      settle(g, t, 0.3, (e) => {
        bands.forEach((col, i) => {
          const r = (176 - i * 26) * (0.96 + 0.04 * e) * (1 + 0.012 * t.wave(1, i * 0.08));
          g.beginPath();
          g.arc(cx, cy, r, Math.PI, TAU);
          g.lineWidth = 20;
          g.strokeStyle = col;
          g.stroke();
          g.beginPath();
          g.arc(cx, cy, r - 7, Math.PI * 1.08, Math.PI * 1.4);
          g.lineWidth = 3;
          g.strokeStyle = rgba("#ffffff", 0.18);
          g.stroke();
        });
        blend(g, "lighter", () => glow(g, cx, cy - 10, 110, "#fde047", 0.35 + 0.06 * t.wave(1)));
        g.beginPath();
        g.arc(cx, cy - 6, 56, 0, TAU);
        g.fillStyle = linear(g, 0, cy - 62, 0, cy + 50, [[0, "#fffbe6"], [1, "#fcd34d"]]);
        g.fill();
      });
      blend(g, "lighter", () => {
        const r = rng(41);
        for (let i = 0; i < 9; i++) spark(g, 470 + r() * 470, 14 + r() * 70, 3 + r() * 2.5, "#fff7d6", (0.25 + 0.35 * t.swell(1, r())) * t.enter(0.8, 0.8), 0, false);
      });
    }),
};

const mischiefNight: Design = {
  slug: "mischief-night-nameplate",
  name: "Mischief Night",
  kind: "nameplate",
  description: "Violet and green smoke curling through the dark, and two pairs of sleepy yellow eyes that slowly narrow and open again, one after the other.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) =>
    scene(g, t, () => {
      bg(g, [[0, "#070b18"], [0.6, "#140a29"], [1, "#22103c"]], false);
      blend(g, "lighter", () => {
        const r = rng(7);
        for (let i = 0; i < 9; i++) {
          const col = i % 2 ? "#4ade80" : "#a855f7";
          const x = 420 + r() * 560 + 34 * t.wave(1, r());
          const y = 30 + r() * 130 + 10 * t.wave(2, r());
          glowEllipse(g, x, y, 120 + r() * 60, 44 + r() * 20, col, 0.16 + 0.04 * t.wave(1, r()), 0.5);
        }
      });
      const eyes = (x: number, y: number, at: number, size: number) => {
        // A slow squint once a loop: over about a second and a half, never a snap.
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
      };
      settle(g, t, 0.7, () => {
        eyes(690, 70, 0.3, 1.05);
        eyes(860, 110, 0.72, 0.85);
      }, 0);
      blend(g, "lighter", () =>
        drift(t, 10, 47, 1, (_, p, f, r) => {
          glow(g, 460 + r() * 500 + Math.sin(TAU * (p + r())) * 18, lerp(H + 20, -20, p), 22 + r() * 16, r() < 0.5 ? "#4ade80" : "#a855f7", 0.18 * f, 0.5);
        }),
      );
    }),
};

const pizzazz: Design = {
  slug: "pizzazz-nameplate",
  name: "Pizzazz",
  kind: "nameplate",
  description: "A party in a strip: a soft wash of pink, violet and teal flowing slowly along it, with confetti drifting gently down through soft bokeh lights.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) =>
    scene(g, t, () => {
      // The wash repeats every stage width and slides one width per loop.
      const off = t.u * W;
      const palette = ["#ff4d8d", "#8b5cf6", "#2dd4bf"];
      const grad = g.createLinearGradient(-off, 0, 2 * W - off, 0);
      for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, palette[i % 3]);
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
      g.fillStyle = linear(g, 0, 0, 0, H, [[0, rgba("#000000", 0.05)], [1, rgba("#000000", 0.22)]]);
      g.fillRect(0, 0, W, H);
      blend(g, "lighter", () => {
        const r = rng(13);
        for (let i = 0; i < 11; i++) {
          const x = 420 + r() * 560 + 16 * t.wave(1, r());
          const y = 20 + r() * 140 + 8 * t.wave(1, r());
          glow(g, x, y, 14 + r() * 18, "#ffffff", 0.14 + 0.06 * t.wave(1, r()), 0.6);
        }
      });
      const party = ["#ffd23f", "#ffffff", "#60a5fa", "#ff8fb3", "#a7f3d0"];
      drift(t, 28, 3, 2, (i, p, f, r) => {
        const x = 420 + r() * 560 + Math.sin(TAU * (p + r())) * 14;
        const y = lerp(-12, H + 12, p);
        const spin = TAU * (p * 2 + r());
        g.save();
        g.translate(x, y);
        g.rotate(spin * 0.25);
        g.scale(Math.cos(spin) * 0.6 + 0.4, 1);
        g.fillStyle = rgba(party[i % party.length], 0.9 * f);
        g.fillRect(-7, -4, 14, 8);
        g.restore();
      });
    }),
};

const crystalCavern: Design = {
  slug: "crystal-cavern-nameplate",
  name: "Crystal Cavern",
  kind: "nameplate",
  description: "Crystals rising out of the dark in violet, cyan and magenta, each glowing softly from within in its own time, with dust drifting through the light.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) =>
    scene(g, t, () => {
      bg(g, [[0, "#0f0a2a"], [0.6, "#1c1a48"], [1, "#2c2a78"]]);
      blend(g, "lighter", () => {
        glowEllipse(g, 790, 130, 260, 120, "#06b6d4", 0.24 + 0.05 * t.wave(1));
        glowEllipse(g, 620, 130, 200, 110, "#c026d3", 0.2 + 0.05 * t.wave(1, 0.5));
      });
      const body = ["#7c3aed", "#0891b2", "#c026d3", "#6366f1"];
      const light = ["#c4b5fd", "#a5f3fc", "#f0abfc", "#c7d2fe"];
      const dark = ["#4c1d95", "#155e75", "#86198f", "#3730a3"];
      const set: [number, number, number, number][] = [[560, 30, 70, -0.18], [610, 40, 112, -0.08], [668, 46, 150, 0.02], [722, 36, 96, 0.14], [780, 52, 160, -0.04], [840, 40, 120, 0.1], [894, 34, 84, 0.2], [940, 30, 64, 0.26]];
      set.forEach(([x, w, h, tilt], i) => {
        // They rise the last few pixels into place as the scene fades up.
        const e = t.enter(0.1 + i * 0.06, 1.2);
        crystal(g, x, H + 6, w, h * (0.94 + 0.06 * e), tilt, body[i % 4], light[i % 4], dark[i % 4], 1, 0.35 + 0.3 * t.swell(1, i / set.length));
      });
      blend(g, "lighter", () =>
        drift(t, 14, 6, 1, (_, p, f, r) => {
          spark(g, 520 + r() * 440 + Math.sin(TAU * (p + r())) * 20, lerp(H, 0, p), 2 + r() * 2, r() < 0.5 ? "#e9d5ff" : "#a5f3fc", 0.6 * f * t.enter(1, 0.6), 0, false);
        }),
      );
    }),
};

const lsdTrip: Design = {
  slug: "lsd-trip-nameplate",
  name: "LSD Trip",
  kind: "nameplate",
  description: "A slow psychedelic drift: liquid bands of magenta, gold, cyan and violet flowing gently past a softly turning mandala.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) =>
    scene(g, t, () => {
      // Hues (and the blends between neighbours) kept well away from WCAG's saturated-red boundary, R / (R + G + B) = 0.8.
      const cols = ["#6d28d9", "#d946ef", "#ec4899", "#fbbf24", "#22d3ee", "#6d28d9"];
      g.fillStyle = "#3b0a6b";
      g.fillRect(0, 0, W, H);
      // Liquid bands: each edge a slow wave travelling once per loop.
      for (let i = 0; i < cols.length - 1; i++) {
        const top = (x: number) => -30 + i * 44 + 16 * Math.sin(x / 150 + TAU * t.u + i * 0.9) + 8 * Math.sin(x / 70 - TAU * t.u + i);
        g.beginPath();
        g.moveTo(0, H + 10);
        for (let x = 0; x <= W; x += 12) g.lineTo(x, top(x));
        g.lineTo(W, H + 10);
        g.closePath();
        g.fillStyle = linear(g, 0, 0, W, 0, [[0, mix(cols[i], "#1a0533", 0.15)], [0.6, cols[i]], [1, mix(cols[i], "#ffffff", 0.12)]]);
        g.fill();
      }
      g.fillStyle = rgba("#1a0533", 0.12);
      g.fillRect(0, 0, W, H);
      const cx = 790;
      const cy = 88;
      settle(g, t, 0.4, (e) => {
        g.save();
        g.translate(cx, cy);
        g.scale(0.9 + 0.1 * e, 0.9 + 0.1 * e);
        blend(g, "lighter", () => glow(g, 0, 0, 120, "#ff7ad9", 0.28 + 0.05 * t.wave(1)));
        const rings: [number, number, number, string, number][] = [[12, 64, 16, "#fde047", 1], [8, 42, 14, "#67e8f9", -1], [6, 22, 10, "#f472b6", 1]];
        for (const [n, r, s, col, dir] of rings) {
          g.save();
          g.rotate(dir * (TAU / n) * t.u);
          for (let k = 0; k < n; k++) {
            g.save();
            g.rotate((k / n) * TAU);
            g.translate(0, -r);
            g.beginPath();
            g.ellipse(0, 0, s * 0.42, s, 0, 0, TAU);
            g.fillStyle = rgba(col, 0.85);
            g.fill();
            g.restore();
          }
          g.restore();
        }
        dot(g, 0, 0, 9, "#fff7d6", 0.95);
        g.restore();
      }, 0);
    }),
};

export const NAMEPLATES: Design[] = [lofiRooftop, stormChaser, runeCircle, treasureVault, goldenGroove, mischiefNight, pizzazz, crystalCavern, lsdTrip];

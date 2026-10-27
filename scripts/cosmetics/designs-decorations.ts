/**
 * Avatar decorations, remade: drawn in a 100-unit square laid over a box 126% as wide as the avatar, so the avatar is
 * the middle 76 units (12 to 88), a rounded square with corners of about a fifth of its width. Rendered at 384 px.
 *
 * Each sits round the picture rather than on it (the Ice Cube, which is the picture frozen in ice, and Sakura's
 * falling petals excepted), is lit from the top left, and moves the way the rest of the collection does (see kit.ts):
 * slow, periodic, nothing blinking. The renderer fades the finished frame up over the intro.
 */
import { TAU, blend, crystal, dot, drift, gem, glow, glowEllipse, lerp, linear, mix, rgba, rng, smooth, spark, type Ctx, type Design, type Time } from "./kit";

const INTRO = 1.6;
const IDLE = 8;
const AV_MIN = 12;
const AV_SIZE = 76;
const AV_R = 15.2;

/** Points round a rounded square (an angle alone drifts in at the corners), with the outward angle at each. */
function squircle(count: number, radius: number, startDeg = -90) {
  return Array.from({ length: count }, (_, i) => {
    const a = ((startDeg + (360 / count) * i) * Math.PI) / 180;
    const project = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v));
    const x = 50 + project(Math.cos(a)) * radius;
    const y = 50 + project(Math.sin(a)) * radius;
    return { x, y, out: Math.atan2(y - 50, x - 50), i };
  });
}

/** Draw `fn` everywhere except over the avatar, so it passes behind the picture. */
function behindAvatar(g: Ctx, fn: () => void): void {
  g.save();
  g.beginPath();
  g.rect(-20, -20, 140, 140);
  g.roundRect(AV_MIN, AV_MIN, AV_SIZE, AV_SIZE, AV_R);
  g.clip("evenodd");
  fn();
  g.restore();
}

/** A soft drop shadow under what `fn` draws, lifting it off the picture. */
function shadowed(g: Ctx, fn: () => void, blur = 1.6, dy = 0.8, a = 0.45): void {
  g.save();
  g.shadowColor = `rgba(10,5,24,${a})`;
  g.shadowBlur = blur * 3.84;
  g.shadowOffsetY = dy * 3.84;
  fn();
  g.restore();
}

/** Settles into place over the intro: a small scale up about (x, y). */
function settle(g: Ctx, t: Time, x: number, y: number, fn: () => void, from = 0.92): void {
  const e = t.enter(0, 1.25);
  g.save();
  g.translate(x, y);
  const s = from + (1 - from) * e;
  g.scale(s, s);
  g.translate(-x, -y);
  fn();
  g.restore();
}

function rotAbout(g: Ctx, x: number, y: number, a: number, fn: () => void): void {
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.translate(-x, -y);
  fn();
  g.restore();
}

const deg = (d: number) => (d * Math.PI) / 180;

// --- The fifteen ----------------------------------------------------------------------------------------------------------

const catEars: Design = {
  slug: "cat-ears",
  name: "Cat Ears",
  kind: "decoration",
  description: "Soft cream cat ears with pink insides on the top corners of your avatar and fine whiskers at the cheeks. Every so often an ear tilts, slowly, and the whiskers sway.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    const ear = (mirror: boolean, tilt: number) => {
      g.save();
      if (mirror) {
        g.translate(100, 0);
        g.scale(-1, 1);
      }
      rotAbout(g, 22, 22, tilt, () => {
        shadowed(g, () => {
          g.beginPath();
          g.moveTo(9, 38);
          g.bezierCurveTo(6, 26, 5, 13, 7.5, 5.5);
          g.bezierCurveTo(15, 5, 27, 6.5, 38, 9);
          g.bezierCurveTo(30, 17, 20, 28, 9, 38);
          g.closePath();
          g.fillStyle = linear(g, 6, 5, 30, 30, [[0, "#fffaf2"], [0.6, "#f6e7d2"], [1, "#e7cfb2"]]);
          g.fill();
        });
        g.beginPath();
        g.moveTo(11.5, 33);
        g.bezierCurveTo(9.6, 24, 9.4, 15, 10.6, 9);
        g.bezierCurveTo(17, 9, 24, 10, 31, 11.5);
        g.bezierCurveTo(25, 17, 18, 25, 11.5, 33);
        g.closePath();
        g.fillStyle = linear(g, 10, 9, 24, 26, [[0, "#ffc7dd"], [1, "#f58fb8"]]);
        g.fill();
        // The lit rim on the outside edge.
        g.beginPath();
        g.moveTo(8.6, 34);
        g.bezierCurveTo(6.4, 24, 5.8, 14, 7.8, 6.4);
        g.strokeStyle = rgba("#ffffff", 0.7);
        g.lineWidth = 0.7;
        g.stroke();
      });
      // Whiskers, outside the picture at the cheek.
      const sway = deg(2.5) * t.wave(1, mirror ? 0.5 : 0);
      rotAbout(g, 13, 62, sway, () => {
        g.lineCap = "round";
        for (const [y, dy] of [[58, -2.4], [62, 0], [66, 2.4]] as const) {
          g.beginPath();
          g.moveTo(13, y);
          g.quadraticCurveTo(6, y + dy * 0.4 - 0.8, 0.5, y + dy);
          g.strokeStyle = rgba("#8a8198", 0.9);
          g.lineWidth = 0.75;
          g.stroke();
        }
      });
      g.restore();
    };
    // One ear tilts and comes back over about two seconds, the other a few seconds later.
    const tiltAt = (at: number) => deg(-7) * Math.pow(Math.max(0, Math.sin(TAU * (t.u - at))), 3) * (t.u > at && t.u < at + 0.5 ? 1 : 0);
    settle(g, t, 50, 20, () => {
      ear(false, tiltAt(0.15) + deg(1) * t.wave(1));
      ear(true, tiltAt(0.6) + deg(1) * t.wave(1, 0.5));
    });
  },
};

const halo: Design = {
  slug: "halo",
  name: "Halo",
  kind: "decoration",
  description: "A glowing gold ring floating just above your avatar, bobbing gently, with two small stars glimmering beside it.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    const y = 6.5 + 0.7 * t.wave(1);
    settle(g, t, 50, y, () => {
      blend(g, "lighter", () => glowEllipse(g, 50, y, 30, 9, "#fde68a", 0.35 + 0.06 * t.wave(1, 0.25)));
      shadowed(g, () => {
        g.beginPath();
        g.ellipse(50, y, 21, 5.4, 0, 0, TAU);
        g.strokeStyle = linear(g, 29, y - 5, 71, y + 5, [[0, "#fff7cc"], [0.45, "#fbbf24"], [1, "#b45309"]]);
        g.lineWidth = 2.8;
        g.stroke();
      }, 1.2, 0.5, 0.3);
      g.beginPath();
      g.ellipse(50, y, 21, 5.4, 0, Math.PI * 1.08, Math.PI * 1.62);
      g.strokeStyle = rgba("#ffffff", 0.75);
      g.lineWidth = 0.8;
      g.stroke();
    });
    blend(g, "lighter", () => {
      spark(g, 22, 8, 3.2, "#fff7d6", 0.45 + 0.4 * t.swell(1), 0, true);
      spark(g, 79, 5, 2.4, "#fff7d6", 0.45 + 0.4 * t.swell(1, 0.5), 0, true);
    });
  },
};

const laurel: Design = {
  slug: "laurel",
  name: "Laurel Wreath",
  kind: "decoration",
  description: "Two green laurel branches with red berries wrapped round the sides of your avatar, their leaves stirring in a slow breeze.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    const branch = (mirror: boolean) => {
      g.save();
      if (mirror) {
        g.translate(100, 0);
        g.scale(-1, 1);
      }
      const at = (s: number): [number, number, number] => {
        // Along an arc round the left side, from the foot (s = 0) to the top (s = 1).
        const a = lerp(deg(118), deg(218), s);
        const x = 50 + Math.cos(a) * 44;
        const y = 52 + Math.sin(a) * 46;
        return [x, y, a];
      };
      g.beginPath();
      for (let s = 0; s <= 1.0001; s += 0.05) {
        const [x, y] = at(s);
        if (s === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = "#5b3a1e";
      g.lineWidth = 1.3;
      g.lineCap = "round";
      g.stroke();
      for (let i = 0; i < 8; i++) {
        const s = 0.06 + i * 0.12;
        const [x, y, a] = at(s);
        const sway = deg(5) * t.wave(1, -s * 0.6 + (mirror ? 0.25 : 0));
        for (const side of [-1, 1]) {
          rotAbout(g, x, y, a + Math.PI / 2 + side * deg(48) + sway, () => {
            shadowed(g, () => {
              g.beginPath();
              g.moveTo(x, y);
              g.bezierCurveTo(x - 3.2, y - 2.5, x - 2.4, y - 7, x, y - 9);
              g.bezierCurveTo(x + 2.4, y - 7, x + 3.2, y - 2.5, x, y);
              g.fillStyle = linear(g, x - 2, y - 8, x + 2, y, [[0, side < 0 ? "#8fd27a" : "#6dbb5c"], [1, "#2f7d3a"]]);
              g.fill();
            }, 1, 0.4, 0.35);
            g.beginPath();
            g.moveTo(x, y - 0.5);
            g.lineTo(x, y - 8);
            g.strokeStyle = rgba("#d9f99d", 0.45);
            g.lineWidth = 0.35;
            g.stroke();
          });
        }
        if (i % 3 === 1) {
          const [bx, by] = at(s + 0.05);
          dot(g, bx + 1.6, by, 1.7, "#dc2626", 1);
          dot(g, bx + 1.1, by - 0.5, 0.6, "#fecaca", 0.9);
        }
      }
      g.restore();
    };
    settle(g, t, 50, 70, () => {
      branch(false);
      branch(true);
    });
  },
};

const lightningCorners: Design = {
  slug: "lightning-corners",
  name: "Lightning Corners",
  kind: "decoration",
  description: "A still bolt of electric blue and gold in each corner of your avatar, each brightening and dimming slowly in turn, with a soft glow of current gliding along it.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    const bolt: [number, number][] = [[2, 2], [9, 6], [7, 10], [15, 14], [12, 17], [21, 22]];
    settle(g, t, 50, 50, () => {
      for (let c = 0; c < 4; c++) {
        g.save();
        g.translate(50, 50);
        g.rotate((c * Math.PI) / 2);
        g.translate(-50, -50);
        const a = 0.55 + 0.4 * t.swell(1, c / 4);
        blend(g, "lighter", () => {
          g.lineJoin = "round";
          g.lineCap = "round";
          for (const [lw, la, col] of [[6, 0.14, "#38bdf8"], [3, 0.4, "#7dd3fc"], [1.1, 1, "#f0f9ff"]] as const) {
            g.beginPath();
            bolt.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
            g.strokeStyle = rgba(col, la * a);
            g.lineWidth = lw;
            g.stroke();
          }
          // A yellow core in the middle stretch.
          g.beginPath();
          g.moveTo(7, 10);
          g.lineTo(15, 14);
          g.strokeStyle = rgba("#fde047", 0.7 * a);
          g.lineWidth = 0.7;
          g.stroke();
          // The current: a soft glow gliding down the bolt once a loop.
          const p = (t.u + c / 4) % 1;
          const seg = Math.min(bolt.length - 2, Math.floor(p * (bolt.length - 1)));
          const f = p * (bolt.length - 1) - seg;
          const x = lerp(bolt[seg][0], bolt[seg + 1][0], f);
          const y = lerp(bolt[seg][1], bolt[seg + 1][1], f);
          glow(g, x, y, 4.5, "#e0f2fe", 0.5 * Math.sin(Math.PI * p));
        });
        g.restore();
      }
    });
  },
};

const flameRing: Design = {
  slug: "flame-ring",
  name: "Flame Ring",
  kind: "decoration",
  description: "A ring of soft flames round your avatar, deep orange at the roots and gold at the tips, swaying slowly as they burn.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    // A warm glow round the picture, pooled rather than drawn as a band.
    blend(g, "lighter", () => {
      for (const p of squircle(12, 41, -90)) glow(g, p.x, p.y, 13, "#fb923c", 0.16);
    });
    settle(g, t, 50, 50, () => {
      const r = rng(3);
      const flames = squircle(30, 41.5, -90).map((p) => ({ ...p, size: 7 + r() * 4.5, lean: (r() - 0.5) * 0.5, ph: r() }));
      // Three layers, back to front: amber body, gold, a pale core. Kept to amber and gold rather than red, so their
      // movement never reads as red flicker.
      const looks: [number, number, [number, string][]][] = [
        [1, 3.6, [[0, "#f08a24"], [0.55, "#f59e0b"], [1, "#fcd34d"]]],
        [0.7, 2.5, [[0, "#fbbf24"], [1, "#fde68a"]]],
        [0.4, 1.4, [[0, "#fff7cc"], [1, "#fffdf2"]]],
      ];
      for (const [scale, w, stops] of looks) {
        for (const p of flames) {
          const h = p.size * scale * (0.9 + 0.1 * t.wave(2, p.ph));
          const sway = p.lean + deg(8) * t.wave(1, p.ph);
          const curl = w * 0.8 * t.wave(1, p.ph + 0.25);
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.out + Math.PI / 2 + sway * 0.4);
          g.beginPath();
          g.moveTo(-w, 1.5);
          g.bezierCurveTo(-w * 1.2, -h * 0.35, -w * 0.1 + curl * 0.5, -h * 0.7, curl, -h);
          g.bezierCurveTo(w * 0.1 + curl * 0.5, -h * 0.7, w * 1.2, -h * 0.35, w, 1.5);
          g.closePath();
          g.fillStyle = linear(g, 0, 1.5, 0, -h, stops);
          g.fill();
          g.restore();
        }
      }
    });
    blend(g, "lighter", () =>
      drift(t, 10, 4, 2, (i, p, f, r) => {
        const q = squircle(10, 46, r() * 360)[i];
        const out = 4 + p * 7;
        spark(g, q.x + Math.cos(q.out) * out, q.y + Math.sin(q.out) * out, 0.9 + r() * 0.6, "#fde68a", 0.6 * f, 0, false);
      }),
    );
  },
};

const frost: Design = {
  slug: "frost",
  name: "Frost",
  kind: "decoration",
  description: "An icy ring round your avatar with crystal spikes, a slow shimmer of light travelling round it and snowflakes drifting gently past.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    settle(g, t, 50, 50, () => {
      const pts = squircle(28, 43.5, -90);
      const r = rng(9);
      for (const p of pts) {
        const len = 3 + r() * 5;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.out + Math.PI / 2);
        g.beginPath();
        g.moveTo(-1.3, 0.5);
        g.lineTo(0, -len);
        g.lineTo(1.3, 0.5);
        g.closePath();
        g.fillStyle = linear(g, -1, 0, 1, -len, [[0, "#bae6fd"], [1, "#f0f9ff"]]);
        g.fill();
        g.restore();
      }
      g.beginPath();
      g.roundRect(9.5, 9.5, 81, 81, 17.5);
      g.strokeStyle = linear(g, 10, 10, 90, 90, [[0, "#f0f9ff"], [0.5, "#7dd3fc"], [1, "#38bdf8"]]);
      g.lineWidth = 3.4;
      g.stroke();
      g.beginPath();
      g.roundRect(9.5, 9.5, 81, 81, 17.5);
      g.strokeStyle = rgba("#ffffff", 0.55);
      g.lineWidth = 0.6;
      g.stroke();
      // A shimmer travelling once round the ring a loop.
      blend(g, "lighter", () => {
        const q = squircle(1, 41, t.u * 360 - 135)[0];
        glow(g, q.x, q.y, 12, "#ffffff", 0.26);
      });
    });
    const flake = (x: number, y: number, s: number, rot: number, a: number) => {
      if (a <= 0.01) return;
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      g.strokeStyle = rgba("#f0f9ff", a);
      g.lineWidth = 0.5;
      g.lineCap = "round";
      for (let k = 0; k < 6; k++) {
        g.rotate(TAU / 6);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(0, -s);
        g.moveTo(0, -s * 0.55);
        g.lineTo(s * 0.28, -s * 0.8);
        g.moveTo(0, -s * 0.55);
        g.lineTo(-s * 0.28, -s * 0.8);
        g.stroke();
      }
      g.restore();
    };
    drift(t, 6, 21, 1, (i, p, f, r) => {
      const x = i % 2 ? 2 + r() * 8 : 90 + r() * 8;
      flake(x + Math.sin(TAU * (p + r())) * 2, lerp(4, 96, p), 2 + r() * 1.5, TAU * (p * 0.5 + r()), 0.85 * f);
    });
  },
};

/** A five-petalled blossom. */
function flower(g: Ctx, x: number, y: number, r: number, rot: number, petal = "#ffc0d9", deep = "#f472b6"): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  for (let k = 0; k < 5; k++) {
    g.rotate(TAU / 5);
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(-r * 0.75, -r * 0.35, -r * 0.6, -r * 1.05, 0, -r * 0.92);
    g.bezierCurveTo(r * 0.6, -r * 1.05, r * 0.75, -r * 0.35, 0, 0);
    g.fillStyle = linear(g, 0, 0, 0, -r, [[0, deep], [0.5, petal], [1, mix(petal, "#ffffff", 0.5)]]);
    g.fill();
  }
  dot(g, 0, 0, r * 0.22, "#fde68a", 1);
  g.restore();
}
function petal(g: Ctx, x: number, y: number, s: number, rot: number, a: number): void {
  if (a <= 0.01) return;
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(1, 0.55 + 0.45 * Math.cos(rot) ** 2);
  g.beginPath();
  g.ellipse(0, 0, s, s * 0.6, 0, 0, TAU);
  g.fillStyle = rgba("#ffc0d9", a);
  g.fill();
  g.restore();
}

const blossom: Design = {
  slug: "blossom",
  name: "Cherry Blossom",
  kind: "decoration",
  description: "A branch of cherry blossom across the top corner of your avatar, swaying a little, with a few petals drifting slowly off it.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    settle(g, t, 98, 18, () =>
      rotAbout(g, 98, 18, deg(1.6) * t.wave(1), () => {
        shadowed(g, () => {
          g.beginPath();
          g.moveTo(100, 30);
          g.bezierCurveTo(88, 22, 76, 10, 56, 6);
          g.strokeStyle = "#6b4226";
          g.lineWidth = 2.2;
          g.lineCap = "round";
          g.stroke();
          g.beginPath();
          g.moveTo(80, 15);
          g.quadraticCurveTo(76, 22, 70, 24);
          g.lineWidth = 1.2;
          g.stroke();
        });
        const flowers: [number, number, number][] = [[90, 22, 5.4], [76, 13, 6], [62, 8, 4.6], [70, 24, 4], [84, 8, 3.6]];
        flowers.forEach(([x, y, r], i) => shadowed(g, () => flower(g, x, y, r, deg(15 * i) + deg(4) * t.wave(1, i / 5)), 1, 0.5, 0.35));
        dot(g, 55, 5, 1.6, "#f472b6", 1);
        dot(g, 96, 32, 1.4, "#f472b6", 1);
      }),
    );
    drift(t, 4, 31, 1, (i, p, f, r) => {
      const x = lerp(80 - r() * 20, 96 - r() * 10, p) + Math.sin(TAU * (p + r())) * 3;
      const y = lerp(16, 98, p);
      petal(g, x, y, 1.7, TAU * (p + r()), 0.9 * f);
    });
  },
};

const crystalCluster: Design = {
  slug: "crystal-cluster",
  name: "Crystal Cluster",
  kind: "decoration",
  description: "Violet and cyan crystals growing up from the bottom corners of your avatar, each glowing softly from within in its own time.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    const set: [number, number, number, number, number][] = [[6, 8, 24, -0.38, 0], [14, 10, 32, -0.12, 1], [23, 7, 18, 0.2, 2], [77, 7, 18, -0.2, 3], [86, 10, 32, 0.12, 0], [94, 8, 24, 0.38, 1]];
    const body = ["#7c3aed", "#0891b2", "#a855f7", "#06b6d4"];
    const light = ["#c4b5fd", "#a5f3fc", "#e9d5ff", "#cffafe"];
    const dark = ["#4c1d95", "#155e75", "#6b21a8", "#0e7490"];
    blend(g, "lighter", () => {
      glowEllipse(g, 15, 96, 22, 12, "#7c3aed", 0.4);
      glowEllipse(g, 85, 96, 22, 12, "#06b6d4", 0.4);
    });
    settle(g, t, 50, 100, () =>
      set.forEach(([x, w, h, tilt, c], i) => shadowed(g, () => crystal(g, x, 101, w, h, tilt, body[c], light[c], dark[c], 1, 0.35 + 0.4 * t.swell(1, i / set.length)), 1.2, 0.5, 0.4)),
    );
    blend(g, "lighter", () => {
      spark(g, 16, 64, 1.8, "#e9d5ff", 0.3 + 0.4 * t.swell(1, 0.1), 0, true);
      spark(g, 86, 62, 1.8, "#cffafe", 0.3 + 0.4 * t.swell(1, 0.6), 0, true);
    });
  },
};

const pixelFrame: Design = {
  slug: "pixel-frame",
  name: "Pixel Frame",
  kind: "decoration",
  description: "An 8-bit border of chunky coloured squares round your avatar, with a soft glint of light gliding round it and pixel sparkles in the corners.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    const cols = ["#f472b6", "#fb923c", "#facc15", "#4ade80", "#38bdf8", "#a78bfa"];
    const s = 5;
    const cells: [number, number][] = [];
    for (let x = 5; x <= 90; x += s) cells.push([x, 5], [x, 90]);
    for (let y = 10; y <= 85; y += s) cells.push([5, y], [90, y]);
    // The glint's place, as an angle round the frame.
    const glintAt = t.u * TAU - Math.PI * 0.75;
    settle(g, t, 50, 50, () => {
      for (const [x, y] of cells) {
        // The corners are cut, as a pixel-art frame is.
        if ((x === 5 || x === 90) && (y === 5 || y === 90)) continue;
        const k = Math.floor((x + y) / s) % cols.length;
        const ang = Math.atan2(y + 2.5 - 50, x + 2.5 - 50);
        const d = Math.abs(Math.atan2(Math.sin(ang - glintAt), Math.cos(ang - glintAt)));
        const lift = 0.35 * smooth(1 - d / 0.7);
        g.fillStyle = mix(cols[k], "#ffffff", lift);
        g.fillRect(x, y, s, s);
        g.fillStyle = rgba("#ffffff", 0.28);
        g.fillRect(x, y, s, 1);
        g.fillStyle = rgba("#000000", 0.22);
        g.fillRect(x, y + s - 1, s, 1);
      }
    });
    const plus = (x: number, y: number, a: number) => {
      g.fillStyle = rgba("#ffffff", a);
      g.fillRect(x - 0.75, y - 2.25, 1.5, 4.5);
      g.fillRect(x - 2.25, y - 0.75, 4.5, 1.5);
    };
    plus(3.5, 3.5, 0.3 + 0.5 * t.swell(1));
    plus(96.5, 3.5, 0.3 + 0.5 * t.swell(1, 0.25));
    plus(96.5, 96.5, 0.3 + 0.5 * t.swell(1, 0.5));
    plus(3.5, 96.5, 0.3 + 0.5 * t.swell(1, 0.75));
  },
};

const saturn: Design = {
  slug: "saturn",
  name: "Ringed Planet",
  kind: "decoration",
  description: "A tilted ring wrapping your avatar like a planet's, passing behind the picture and in front of it, with two small moons gliding slowly round.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    const tilt = deg(-16);
    const ring = (front: boolean) => {
      g.save();
      g.translate(50, 52);
      g.rotate(tilt);
      g.scale(1, 0.27);
      const bands: [number, number, string][] = [[47, 5, "#fcd9a8"], [41, 3.4, "#e9a3c9"], [36.5, 2, "#c4b5fd"]];
      for (const [r, lw, c] of bands) {
        g.beginPath();
        g.arc(0, 0, r, front ? 0 : Math.PI, front ? Math.PI : TAU);
        g.strokeStyle = rgba(c, front ? 0.95 : 0.8);
        g.lineWidth = lw / 0.27;
        g.stroke();
      }
      g.restore();
    };
    const moon = (k: number, rad: number, size: number, color: string) => {
      const a = TAU * (t.u + k);
      const x0 = Math.cos(a) * rad;
      const y0 = Math.sin(a) * rad * 0.27;
      const x = 50 + x0 * Math.cos(tilt) - y0 * Math.sin(tilt);
      const y = 52 + x0 * Math.sin(tilt) + y0 * Math.cos(tilt);
      return { x, y, front: Math.sin(a) > 0, draw: () => {
        g.beginPath();
        g.arc(x, y, size, 0, TAU);
        g.fillStyle = linear(g, x - size, y - size, x + size, y + size, [[0, mix(color, "#ffffff", 0.5)], [1, mix(color, "#000000", 0.35)]]);
        g.fill();
      } };
    };
    const moons = [moon(0, 46, 2.6, "#c7d2fe"), moon(0.5, 42, 1.9, "#fbcfe8")];
    settle(g, t, 50, 52, () => {
      behindAvatar(g, () => {
        ring(false);
        moons.filter((m) => !m.front).forEach((m) => m.draw());
      });
      shadowed(g, () => {
        ring(true);
        moons.filter((m) => m.front).forEach((m) => m.draw());
      }, 1.2, 0.6, 0.35);
    });
  },
};

const gemFrame: Design = {
  slug: "gem-frame",
  name: "Jeweled Frame",
  kind: "decoration",
  description: "A bevelled gold frame set with a ruby, a sapphire, an emerald and a diamond, each catching the light slowly in turn.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    settle(g, t, 50, 50, () => {
      shadowed(g, () => {
        g.beginPath();
        g.roundRect(9.5, 9.5, 81, 81, 17.5);
        g.strokeStyle = linear(g, 10, 10, 90, 90, [[0, "#fff3b0"], [0.35, "#fbbf24"], [0.7, "#d97706"], [1, "#92400e"]]);
        g.lineWidth = 4.2;
        g.stroke();
      });
      g.beginPath();
      g.roundRect(8, 8, 84, 84, 19);
      g.strokeStyle = rgba("#fff7d6", 0.55);
      g.lineWidth = 0.5;
      g.stroke();
      const set: [number, number, string][] = [[50, 9.5, "#e11d48"], [90.5, 50, "#2563eb"], [50, 90.5, "#059669"], [9.5, 50, "#e0f2fe"]];
      set.forEach(([x, y, c], i) => {
        dot(g, x, y, 5.4, "#b45309", 1);
        dot(g, x, y, 4.6, "#fcd34d", 1);
        gem(g, x, y + 0.4, 3.6, c, 1);
        blend(g, "lighter", () => spark(g, x - 1.2, y - 1.4, 2.6, "#ffffff", 0.7 * Math.pow(t.swell(1, i / 4), 2), deg(15), true));
      });
    });
  },
};

const horns: Design = {
  slug: "horns",
  name: "Little Horns",
  kind: "decoration",
  description: "A pair of small glossy red horns on top of your avatar, for the member who is up to something, with a slow sheen sliding over them.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    const bob = 0.4 * t.wave(1);
    const horn = (mirror: boolean) => {
      g.save();
      if (mirror) {
        g.translate(100, 0);
        g.scale(-1, 1);
      }
      g.translate(0, bob);
      const path = () => {
        g.beginPath();
        g.moveTo(22, 18);
        g.bezierCurveTo(19, 11, 17, 6, 12, 1.5);
        g.bezierCurveTo(20, 3.5, 27, 8, 32, 15);
        g.closePath();
      };
      shadowed(g, () => {
        path();
        g.fillStyle = linear(g, 12, 2, 30, 18, [[0, "#f87171"], [0.55, "#b91c1c"], [1, "#7f1d1d"]]);
        g.fill();
      });
      // The sheen, gliding up the horn once a loop.
      g.save();
      path();
      g.clip();
      const p = t.u;
      const y = lerp(22, -2, p);
      g.fillStyle = linear(g, 0, y - 3, 0, y + 3, [[0, rgba("#ffffff", 0)], [0.5, rgba("#ffffff", 0.35 * Math.sin(Math.PI * p))], [1, rgba("#ffffff", 0)]]);
      g.fillRect(0, y - 3, 40, 6);
      g.restore();
      g.beginPath();
      g.moveTo(14, 3);
      g.bezierCurveTo(18, 7, 20, 11, 22, 16);
      g.strokeStyle = rgba("#fecaca", 0.6);
      g.lineWidth = 0.6;
      g.stroke();
      g.restore();
    };
    settle(g, t, 50, 14, () => {
      horn(false);
      horn(true);
    });
  },
};

const iceCube: Design = {
  slug: "ice-cube",
  name: "Ice Cube",
  kind: "decoration",
  refract: "ice",
  description: "Your avatar frozen in a slab of ice that bends the picture behind it, melting slowly: a drop gathers at the foot, falls and spreads a ring across a little puddle.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    settle(g, t, 50, 50, () => {
      // The slab: clear over the picture, frostier towards its edges.
      g.beginPath();
      g.roundRect(6, 6, 88, 88, 18);
      const body = g.createRadialGradient(46, 44, 20, 50, 50, 62);
      body.addColorStop(0, rgba("#e0f2fe", 0.06));
      body.addColorStop(0.7, rgba("#bae6fd", 0.22));
      body.addColorStop(1, rgba("#e0f2fe", 0.6));
      g.fillStyle = body;
      g.fill();
      g.strokeStyle = rgba("#f0f9ff", 0.85);
      g.lineWidth = 1.4;
      g.stroke();
      g.beginPath();
      g.roundRect(8.5, 8.5, 83, 83, 16);
      g.strokeStyle = rgba("#7dd3fc", 0.45);
      g.lineWidth = 0.6;
      g.stroke();
      // Highlights where the light catches the top left, and a crack.
      g.beginPath();
      g.moveTo(12, 30);
      g.quadraticCurveTo(13, 14, 28, 11);
      g.strokeStyle = rgba("#ffffff", 0.75);
      g.lineWidth = 1.6;
      g.lineCap = "round";
      g.stroke();
      g.beginPath();
      g.moveTo(16, 36);
      g.lineTo(17, 31);
      g.moveTo(33, 12.5);
      g.lineTo(38, 12);
      g.strokeStyle = rgba("#ffffff", 0.5);
      g.lineWidth = 1;
      g.stroke();
      g.beginPath();
      g.moveTo(78, 70);
      g.lineTo(84, 76);
      g.lineTo(82, 82);
      g.moveTo(84, 76);
      g.lineTo(90, 77);
      g.strokeStyle = rgba("#e0f2fe", 0.45);
      g.lineWidth = 0.5;
      g.stroke();
      blend(g, "lighter", () => glow(g, 24, 20, 14, "#ffffff", 0.12 + 0.04 * t.wave(1)));
    });
    // The drip: gathers over five seconds, falls in under a second, rings the puddle.
    const x = 62;
    const grow = smooth(t.u / 0.62);
    const fall = (t.u - 0.62) / 0.08;
    g.beginPath();
    g.ellipse(52, 98, 20, 2, 0, 0, TAU);
    g.fillStyle = rgba("#bae6fd", 0.35);
    g.fill();
    if (t.u < 0.62) {
      const r = 0.6 + 1.5 * grow;
      g.beginPath();
      g.ellipse(x, 94 + r, r * 0.85, r * 1.15, 0, 0, TAU);
      g.fillStyle = rgba("#e0f2fe", 0.85);
      g.fill();
    } else if (fall < 1) {
      g.beginPath();
      g.ellipse(x, lerp(96.5, 98, fall), 1.6, 2, 0, 0, TAU);
      g.fillStyle = rgba("#e0f2fe", 0.85 * (1 - fall * 0.5));
      g.fill();
    }
    const ring = (t.u - 0.7) / 0.3;
    if (ring > 0 && ring < 1) {
      g.beginPath();
      g.ellipse(x, 98, 1.5 + ring * 10, (1.5 + ring * 10) * 0.18, 0, 0, TAU);
      g.strokeStyle = rgba("#f0f9ff", 0.7 * (1 - ring));
      g.lineWidth = 0.5;
      g.stroke();
    }
  },
};

const sakura: Design = {
  slug: "sakura",
  name: "Sakura Wreath",
  kind: "decoration",
  description: "A wreath of cherry blossom on a twig round your avatar, swaying gently, with petals drifting slowly down across the picture.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    settle(g, t, 50, 50, () => {
      g.beginPath();
      const pts = squircle(40, 43, -90);
      pts.forEach((p, i) => {
        const wob = 0.8 * Math.sin(i * 1.7);
        const x = p.x + Math.cos(p.out) * wob;
        const y = p.y + Math.sin(p.out) * wob;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.closePath();
      g.strokeStyle = "#6b4226";
      g.lineWidth = 1.4;
      g.stroke();
      const r = rng(5);
      squircle(14, 43, -80).forEach((p, i) => {
        const leaf = i % 3 === 2;
        const sway = deg(5) * t.wave(1, i / 14);
        if (leaf) {
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.out + sway);
          g.beginPath();
          g.ellipse(2.5, 0, 3, 1.3, 0, 0, TAU);
          g.fillStyle = "#65a30d";
          g.fill();
          g.restore();
        } else {
          shadowed(g, () => flower(g, p.x, p.y, 3.6 + r() * 1.6, r() * TAU + sway, i % 2 ? "#ffd1e3" : "#ffb3cf", "#ec4899"), 1, 0.5, 0.3);
        }
      });
    });
    drift(t, 5, 17, 1, (i, p, f, r) => {
      const x = lerp(10 + r() * 60, 30 + r() * 60, p) + Math.sin(TAU * (p + r())) * 4;
      petal(g, x, lerp(2, 98, p), 1.6, TAU * (p + r()), 0.75 * f);
    });
  },
};

const moon: Design = {
  slug: "moon",
  name: "Crescent Moon",
  kind: "decoration",
  description: "A cratered crescent moon over the corner of your avatar among softly glimmering stars, with one slow shooting star a loop.",
  intro: INTRO,
  idle: IDLE,
  draw: (g, t) => {
    blend(g, "lighter", () => {
      const stars: [number, number, number][] = [[10, 8, 2.4], [30, 4, 1.6], [96, 40, 1.8], [94, 62, 2.4], [56, 3, 1.4], [4, 28, 1.5]];
      stars.forEach(([x, y, s], i) => spark(g, x, y, s, "#fef9c3", 0.35 + 0.45 * t.swell(1, i / stars.length), 0, true));
      const p = (t.u - 0.35) / 0.18;
      if (p > 0 && p < 1) {
        const x = lerp(8, 44, p);
        const y = lerp(16, 6, p);
        const a = Math.sin(Math.PI * p) * 0.75;
        g.strokeStyle = linear(g, x - 12, y + 3.3, x, y, [[0, rgba("#e0e7ff", 0)], [1, rgba("#ffffff", a)]]);
        g.lineWidth = 0.8;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(x - 12, y + 3.3);
        g.lineTo(x, y);
        g.stroke();
      }
    });
    settle(g, t, 80, 18, () => {
      blend(g, "lighter", () => glow(g, 74, 22, 17, "#fde68a", 0.22 + 0.05 * t.wave(1)));
      // The crescent: the moon's disc less a second disc set up and to the right of it.
      const crescent = () => {
        const [ax, ay, ar] = [80, 18, 14];
        const [bx, by, br] = [86.5, 13.5, 11.5];
        const d = Math.hypot(bx - ax, by - ay);
        const along = (d * d + ar * ar - br * br) / (2 * d);
        const half = Math.sqrt(ar * ar - along * along);
        const ux = (bx - ax) / d;
        const uy = (by - ay) / d;
        const mx = ax + ux * along;
        const my = ay + uy * along;
        const p1: [number, number] = [mx - uy * half, my + ux * half];
        const p2: [number, number] = [mx + uy * half, my - ux * half];
        const angle = (cx: number, cy: number, [px, py]: [number, number]) => Math.atan2(py - cy, px - cx);
        g.beginPath();
        // Round the outside the long way, then back along the inner edge.
        g.arc(ax, ay, ar, angle(ax, ay, p1), angle(ax, ay, p2), false);
        g.arc(bx, by, br, angle(bx, by, p2), angle(bx, by, p1), true);
        g.closePath();
      };
      shadowed(g, () => {
        crescent();
        g.fillStyle = linear(g, 66, 6, 92, 32, [[0, "#fffbe6"], [0.6, "#fde68a"], [1, "#eab308"]]);
        g.fill();
      });
      g.save();
      crescent();
      g.clip();
      dot(g, 71, 22, 1.8, "#e2c76e", 0.8);
      dot(g, 75, 29, 1.2, "#e2c76e", 0.8);
      dot(g, 70.5, 15, 1, "#e2c76e", 0.7);
      g.restore();
    });
  },
};

export const DECORATIONS: Design[] = [catEars, halo, laurel, lightningCorners, flameRing, frost, blossom, crystalCluster, pixelFrame, saturn, gemFrame, horns, iceCube, sakura, moon];


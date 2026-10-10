"use client";

import { useEffect, useRef } from "react";

/**
 * The 3D picture behind Studio's sign-in: the Crystal logo, extruded and lit, floating among a pencil, a pen nib, code and
 * earnings cards, a coin, a few colour swatches and sparkles. Drawn with three.js into a transparent canvas laid over the
 * page's own gradient, and loaded only for this screen (the module is imported on mount, never bundled into the rest of Studio).
 *
 * Everything is placed by fractions of what the camera can see, so the same composition holds at any window size: the
 * logo sits low and left, the pencil beside it, the cards and the coin along the bottom, clear of the sign-in card and
 * the headline. The pointer tilts the logo and shifts the camera a little; with "reduce motion" nothing moves.
 */

/** The logo's outline (ring and tail) and its "C", from public/logo.svg, in that file's 102x101 space. */
const LOGO_OUTLINE =
  "M51 8.41211C27.5825 8.41211 8.5 27.2977 8.5 50.4736C8.5 73.6495 27.5825 92.5351 51 92.5351H89.25C90.8225 92.5351 92.2675 91.6518 93.0325 90.2638C93.755 88.8757 93.67 87.1933 92.7775 85.9314L85.34 75.2899C90.6525 68.0974 93.5425 59.3906 93.5425 50.4736C93.5425 27.2977 74.46 8.41211 51.0425 8.41211H51ZM76.5 77.5191L81.1325 84.1228H51C32.2575 84.1228 17 69.0227 17 50.4736C17 31.9245 32.2575 16.8244 51 16.8244C69.7425 16.8244 85 31.9245 85 50.4736C85 58.5073 82.0675 66.2467 76.7975 72.3876C75.5225 73.8177 75.4375 75.9629 76.5425 77.5191H76.5Z";
const LOGO_C =
  "M68.4501 35.1539C65.3692 31.748 61.3625 29.346 56.9368 28.2517C52.5111 27.1574 47.8651 27.42 43.5864 29.0061C39.3077 30.5923 35.5884 33.4309 32.8988 37.1629C30.2092 40.8949 28.6702 45.3527 28.4764 49.9726C28.2826 54.5926 29.4426 59.1671 31.8098 63.1177C34.177 67.0684 37.6451 70.2177 41.7755 72.1675C45.9059 74.1173 50.513 74.7799 55.0144 74.0716C59.5157 73.3633 63.709 71.3158 67.0641 68.1882L61.2753 61.7887C59.167 63.7541 56.5319 65.0407 53.7034 65.4858C50.8748 65.9309 47.9797 65.5145 45.3842 64.2893C42.7888 63.0641 40.6095 61.0851 39.122 58.6026C37.6344 56.12 36.9055 53.2455 37.0273 50.3424C37.1491 47.4393 38.1162 44.638 39.8063 42.2929C41.4963 39.9478 43.8335 38.164 46.5222 37.1673C49.2109 36.1706 52.1303 36.0056 54.9114 36.6932C57.6924 37.3809 60.2102 38.8903 62.1462 41.0305L68.4501 35.1539Z";

type Three = typeof import("three");
type Geo = import("three").BufferGeometry<import("three").NormalBufferAttributes>;

export default function StudioScene({ className }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let stop: () => void = () => {};
    void (async () => {
      const THREE = await import("three");
      const { SVGLoader } = await import("three/examples/jsm/loaders/SVGLoader.js");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      const { RoundedBoxGeometry } = await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");
      if (disposed || !host.current) return;
      try {
        stop = build(THREE, host.current, { SVGLoader, RoomEnvironment, RoundedBoxGeometry });
      } catch {
        // No WebGL (a remote desktop, a blocked GPU): the page is still a good page without its picture.
      }
    })();
    return () => {
      disposed = true;
      stop();
    };
  }, []);

  return <div ref={host} className={className} aria-hidden />;
}

interface Extras {
  SVGLoader: typeof import("three/examples/jsm/loaders/SVGLoader.js").SVGLoader;
  RoomEnvironment: typeof import("three/examples/jsm/environments/RoomEnvironment.js").RoomEnvironment;
  RoundedBoxGeometry: typeof import("three/examples/jsm/geometries/RoundedBoxGeometry.js").RoundedBoxGeometry;
}

/** A float in [0, 1) that is the same every time, so the sparkles are in the same places on every launch. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function build(THREE: Three, host: HTMLElement, x: Extras): () => void {
  // The sign-in scene is intentionally static: it renders one frame (no rAF loop, no pointer parallax).
  const reduced = true;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new x.RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = 0.7;

  const FOV = 32;
  const CAM_Z = 14;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0.2, CAM_Z);

  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 5, 7);
  scene.add(key);
  const green = new THREE.PointLight(0x4ade80, 90, 30);
  green.position.set(-7, -2, 5);
  scene.add(green);
  const blue = new THREE.PointLight(0x3b82f6, 90, 30);
  blue.position.set(7, -3, 4);
  scene.add(blue);

  const disposables: { dispose(): void }[] = [renderer, pmrem, envTexture];
  const track = <T extends { dispose(): void }>(d: T): T => (disposables.push(d), d);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  /** A texture drawn with the 2D canvas API. */
  const canvasTexture = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): InstanceType<Three["CanvasTexture"]> => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d")!);
    const t = track(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    return t;
  };

  /** Everything that floats: where it rests (as fractions of the visible area), how it bobs, how it spins. */
  interface Item {
    obj: InstanceType<Three["Object3D"]>;
    fx: number;
    fy: number;
    z: number;
    bob: number;
    speed: number;
    phase: number;
    spin?: (t: number, depth: number) => void;
  }
  const items: Item[] = [];
  const add = (item: Item) => {
    scene.add(item.obj);
    items.push(item);
  };

  // --- The logo -----------------------------------------------------------------------------------------------------
  const gradientColors = (geo: Geo, box: InstanceType<Three["Box3"]>) => {
    // Green at the top left to blue at the bottom right, as in the app icon. (SVG space: y grows downward.)
    const pos = geo.getAttribute("position") as InstanceType<Three["BufferAttribute"]>;
    const col = new Float32Array(pos.count * 3);
    const a = new THREE.Color(0x5eea9a);
    const b = new THREE.Color(0x3b82f6);
    const c = new THREE.Color();
    const w = box.max.x - box.min.x;
    const h = box.max.y - box.min.y;
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, Math.max(0, ((pos.getX(i) - box.min.x) / w) * 0.45 + ((pos.getY(i) - box.min.y) / h) * 0.65));
      c.copy(a).lerp(b, t);
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  };

  const logo = new THREE.Group();
  {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 102 101"><path d="${LOGO_OUTLINE}"/><path d="${LOGO_C}"/></svg>`;
    const data = new x.SVGLoader().parse(svg);
    const material = track(new THREE.MeshPhysicalMaterial({ vertexColors: true, metalness: 0.15, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15, envMapIntensity: 0.55, side: THREE.DoubleSide }));
    const box = new THREE.Box3(new THREE.Vector3(8.5, 8.4, 0), new THREE.Vector3(93.6, 92.6, 0));
    const body = new THREE.Group();
    for (const path of data.paths) {
      for (const shape of x.SVGLoader.createShapes(path)) {
        const geo = track(new THREE.ExtrudeGeometry(shape, { depth: 10, bevelEnabled: true, bevelThickness: 1.6, bevelSize: 1.3, bevelSegments: 8, curveSegments: 40 }));
        gradientColors(geo, box);
        body.add(new THREE.Mesh(geo, material));
      }
    }
    // SVG's y axis points down; centre the mark on its own middle and stand it upright.
    body.position.set(-(8.5 + 93.6) / 2, (8.4 + 92.6) / 2, -5);
    body.scale.y = -1;
    const holder = new THREE.Group();
    holder.add(body);
    holder.scale.setScalar(2.75 / 85);
    logo.add(holder);
  }
  add({
    obj: logo,
    fx: -0.3,
    fy: -0.56,
    z: 0,
    bob: 0.13,
    speed: 0.7,
    phase: 0,
    spin: (t) => {
      logo.rotation.y = Math.sin(t * 0.45) * 0.42 + pointer.x * 0.32;
      logo.rotation.x = Math.sin(t * 0.37) * 0.07 - pointer.y * 0.18;
      logo.rotation.z = Math.sin(t * 0.3) * 0.03;
    },
  });

  // --- A pencil -----------------------------------------------------------------------------------------------------
  {
    const pencil = new THREE.Group();
    const mat = (color: number, over: Partial<ConstructorParameters<Three["MeshStandardMaterial"]>[0]> = {}) => track(new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05, flatShading: true, ...over }));
    const part = (geo: Geo, m: InstanceType<Three["Material"]>, y: number) => {
      const mesh = new THREE.Mesh(track(geo), m);
      mesh.position.y = y;
      pencil.add(mesh);
      return mesh;
    };
    part(new THREE.CylinderGeometry(0.16, 0.16, 2.0, 6), mat(0xfacc15), 0);
    part(new THREE.CylinderGeometry(0.168, 0.168, 0.3, 24), mat(0xcbd5e1, { metalness: 1, roughness: 0.25, flatShading: false }), 1.14);
    part(new THREE.CylinderGeometry(0.15, 0.15, 0.26, 24), mat(0xf472b6, { roughness: 0.7, flatShading: false }), 1.42);
    part(new THREE.CylinderGeometry(0.16, 0.035, 0.46, 6), mat(0xf3d3a6, { roughness: 0.8 }), -1.23);
    const lead = part(new THREE.ConeGeometry(0.05, 0.14, 12), mat(0x23232b, { flatShading: false }), -1.53);
    lead.rotation.x = Math.PI;
    pencil.scale.setScalar(0.8);
    pencil.rotation.z = 0.95;
    const holder = new THREE.Group();
    holder.add(pencil);
    add({ obj: holder, fx: -0.9, fy: -0.66, z: 1.0, bob: 0.2, speed: 0.9, phase: 1.3, spin: (t) => { holder.rotation.y = Math.sin(t * 0.6) * 0.5; holder.rotation.x = Math.sin(t * 0.5 + 1) * 0.18; } });
  }

  // --- A pen nib (the Pen tool) ---------------------------------------------------------------------------------------
  {
    const s = new THREE.Shape();
    s.moveTo(0, -1.15);
    s.bezierCurveTo(0.1, -0.7, 0.58, -0.3, 0.55, 0.22);
    s.bezierCurveTo(0.54, 0.5, 0.46, 0.8, 0.4, 1.05);
    s.lineTo(-0.4, 1.05);
    s.bezierCurveTo(-0.46, 0.8, -0.54, 0.5, -0.55, 0.22);
    s.bezierCurveTo(-0.58, -0.3, -0.1, -0.7, 0, -1.15);
    const eye = new THREE.Path();
    eye.absarc(0, 0.28, 0.1, 0, Math.PI * 2, true);
    s.holes.push(eye);
    const slit = new THREE.Path();
    slit.moveTo(-0.018, 0.17);
    slit.lineTo(-0.018, -0.72);
    slit.lineTo(0.018, -0.72);
    slit.lineTo(0.018, 0.17);
    slit.closePath();
    s.holes.push(slit);
    const geo = track(new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 4, curveSegments: 28 }));
    geo.center();
    const nib = new THREE.Mesh(geo, track(new THREE.MeshPhysicalMaterial({ color: 0x5eead4, metalness: 1, roughness: 0.18, clearcoat: 0.6 })));
    nib.scale.setScalar(0.8);
    nib.rotation.z = -0.35;
    const holder = new THREE.Group();
    holder.add(nib);
    add({ obj: holder, fx: -0.64, fy: -0.84, z: 0.8, bob: 0.16, speed: 0.8, phase: 2.4, spin: (t) => { holder.rotation.y = Math.sin(t * 0.55 + 2) * 0.7; } });
  }

  // --- Cards: some code, and some earnings -----------------------------------------------------------------------------------
  const card = (tex: InstanceType<Three["CanvasTexture"]>, w: number, h: number) => {
    const m = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)), track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, toneMapped: false })));
    const g = new THREE.Group();
    g.add(m);
    return g;
  };
  const round = (g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, r: number) => {
    g.beginPath();
    g.roundRect(x0, y0, w, h, r);
  };
  const shell = (g: CanvasRenderingContext2D, w: number, h: number, accent: string) => {
    round(g, 6, 6, w - 12, h - 12, 34);
    g.fillStyle = "rgba(14,17,23,0.94)";
    g.fill();
    const edge = g.createLinearGradient(0, 0, w, h);
    edge.addColorStop(0, "rgba(255,255,255,0.28)");
    edge.addColorStop(0.5, "rgba(255,255,255,0.06)");
    edge.addColorStop(1, accent);
    g.lineWidth = 3;
    g.strokeStyle = edge;
    g.stroke();
  };

  {
    const W = 880;
    const H = 560;
    const tex = canvasTexture(W, H, (g) => {
      shell(g, W, H, "rgba(94,234,154,0.7)");
      for (const [i, c] of ["#ff5f57", "#febc2e", "#28c840"].entries()) {
        g.beginPath();
        g.arc(52 + i * 32, 56, 10, 0, Math.PI * 2);
        g.fillStyle = c;
        g.fill();
      }
      g.font = "500 26px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      g.fillStyle = "rgba(255,255,255,0.45)";
      g.fillText("src/commands/roll.ts", 170, 65);
      const K = "#c084fc";
      const F = "#7dd3fc";
      const S = "#86efac";
      const P = "#e2e8f0";
      const D = "#94a3b8";
      const lines: [string, string][][] = [
        [["import ", K], ["{ defineCommand } ", P], ["from ", K], ['"@crystal/bot"', S], [";", P]],
        [],
        [["export default ", K], ["defineCommand", F], ["({", P]],
        [["  name", D], [": ", P], ['"roll"', S], [",", P]],
        [["  description", D], [": ", P], ['"Roll a die"', S], [",", P]],
        [["  run", D], [": ", P], ["async ", K], ["(i) ", P], ["=> ", K], ["{", P]],
        [["    await ", K], ["i", P], [".", P], ["reply", F], ["(", P], ['"You rolled a 6"', S], [");", P]],
        [["  }", P], [",", P]],
        [["});", P]],
      ];
      g.font = "500 31px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      lines.forEach((segs, row) => {
        let px = 52;
        for (const [text, color] of segs) {
          g.fillStyle = color;
          g.fillText(text, px, 140 + row * 44);
          px += g.measureText(text).width;
        }
      });
    });
    const c = card(tex, 3.1, 3.1 * (560 / 880));
    add({ obj: c, fx: 0.2, fy: -0.64, z: 0.2, bob: 0.14, speed: 0.65, phase: 0.6, spin: (t) => { c.rotation.y = -0.38 + Math.sin(t * 0.5) * 0.12; c.rotation.x = 0.1 + Math.sin(t * 0.42) * 0.04; c.rotation.z = -0.04; } });
  }

  {
    const W = 560;
    const H = 400;
    const tex = canvasTexture(W, H, (g) => {
      shell(g, W, H, "rgba(96,165,250,0.7)");
      g.font = "600 24px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.fillText("EARNED THIS MONTH", 44, 80);
      g.font = "800 84px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
      const text = g.createLinearGradient(44, 90, 44, 170);
      text.addColorStop(0, "#ffffff");
      text.addColorStop(1, "#86efac");
      g.fillStyle = text;
      g.fillText("$1,284", 44, 170);
      const bars = [0.25, 0.38, 0.3, 0.5, 0.46, 0.7, 0.62, 0.9];
      bars.forEach((v, i) => {
        const bw = 44;
        const bh = 140 * v + 14;
        const bx = 44 + i * (bw + 15);
        const by = 360 - bh;
        const fill = g.createLinearGradient(0, by, 0, by + bh);
        fill.addColorStop(0, i === bars.length - 1 ? "#4ade80" : "#60a5fa");
        fill.addColorStop(1, i === bars.length - 1 ? "#16a34a" : "#1d4ed8");
        g.fillStyle = fill;
        round(g, bx, by, bw, bh, 10);
        g.fill();
      });
    });
    const c = card(tex, 2.1, 2.1 * (400 / 560));
    add({ obj: c, fx: 0.74, fy: -0.7, z: -0.6, bob: 0.12, speed: 0.75, phase: 3.1, spin: (t) => { c.rotation.y = 0.42 + Math.sin(t * 0.48 + 1) * 0.12; c.rotation.x = 0.08; c.rotation.z = 0.05; } });
  }

  // --- A coin -------------------------------------------------------------------------------------------------------
  {
    const face = canvasTexture(256, 256, (g) => {
      const bg = g.createRadialGradient(128, 110, 20, 128, 128, 128);
      bg.addColorStop(0, "#ffe9a3");
      bg.addColorStop(1, "#f5b82e");
      g.fillStyle = bg;
      g.fillRect(0, 0, 256, 256);
      g.lineWidth = 10;
      g.strokeStyle = "rgba(146,92,10,0.55)";
      g.beginPath();
      g.arc(128, 128, 108, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 22;
      g.lineCap = "round";
      g.strokeStyle = "#a16207";
      g.beginPath();
      g.arc(128, 128, 52, Math.PI * 0.22, Math.PI * 1.78);
      g.stroke();
    });
    const edge = track(new THREE.MeshPhysicalMaterial({ color: 0xf5b82e, metalness: 1, roughness: 0.3 }));
    const faceMat = track(new THREE.MeshPhysicalMaterial({ map: face, metalness: 0.9, roughness: 0.32 }));
    const coin = new THREE.Mesh(track(new THREE.CylinderGeometry(0.5, 0.5, 0.09, 64)), [edge, faceMat, faceMat]);
    coin.rotation.x = Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(coin);
    add({ obj: holder, fx: 0.46, fy: -0.9, z: 1.3, bob: 0.2, speed: 1.0, phase: 4.2, spin: (t) => { holder.rotation.y = t * 0.9; holder.rotation.z = 0.25; } });
  }

  // --- Swatches: the things creators make -----------------------------------------------------------------------------------
  {
    const rand = seeded(7);
    const colors = [0xfb923c, 0xf472b6, 0xa78bfa, 0x22d3ee, 0x4ade80];
    const spots: [number, number, number][] = [[-0.62, -0.4, -1.0], [-0.02, -0.94, 0.4], [0.4, -0.36, -1.5], [0.93, -0.9, 0.2], [-0.2, -0.38, 1.4]];
    spots.forEach(([fx, fy, z], i) => {
      const geo = track(new x.RoundedBoxGeometry(0.38, 0.38, 0.38, 5, 0.11));
      const m = new THREE.Mesh(geo, track(new THREE.MeshPhysicalMaterial({ color: colors[i % colors.length], roughness: 0.18, metalness: 0.1, clearcoat: 1 })));
      const sx = 0.2 + rand() * 0.5;
      const sy = 0.2 + rand() * 0.5;
      m.scale.setScalar(0.8 + rand() * 0.6);
      add({ obj: m, fx, fy, z, bob: 0.1 + rand() * 0.1, speed: 0.7 + rand() * 0.6, phase: rand() * 6, spin: (t) => { m.rotation.x = t * sx; m.rotation.y = t * sy; } });
    });
  }

  // --- Sparkles ------------------------------------------------------------------------------------------------------
  const sparkleTex = canvasTexture(128, 128, (g) => {
    const glow = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    glow.addColorStop(0, "rgba(255,255,255,0.95)");
    glow.addColorStop(0.18, "rgba(255,255,255,0.35)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, 128, 128);
    g.beginPath();
    g.moveTo(64, 2);
    g.quadraticCurveTo(68, 60, 126, 64);
    g.quadraticCurveTo(68, 68, 64, 126);
    g.quadraticCurveTo(60, 68, 2, 64);
    g.quadraticCurveTo(60, 60, 64, 2);
    g.fillStyle = "#fff";
    g.fill();
  });
  const sparkles: { sprite: InstanceType<Three["Sprite"]>; size: number; speed: number; phase: number }[] = [];
  {
    const rand = seeded(2026);
    const tints = [0xffffff, 0xbbf7d0, 0xbae6fd, 0xffffff, 0xfde68a];
    for (let i = 0; i < 46; i++) {
      const big = i < 14;
      const sprite = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: sparkleTex, color: tints[i % tints.length], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 })));
      const z = -3 + rand() * 6;
      const size = big ? 0.36 + rand() * 0.4 : 0.1 + rand() * 0.15;
      // Not behind the headline and its blurb (the upper left): a sparkle under a letter reads as a smudge.
      let fx = -0.97 + rand() * 1.94;
      let fy = -0.98 + rand() * (big ? 1.2 : 1.7);
      for (let tries = 0; tries < 12 && fx < 0.02 && fy > -0.3; tries++) {
        fx = -0.97 + rand() * 1.94;
        fy = -0.98 + rand() * (big ? 1.2 : 1.7);
      }
      if (fx < 0.02 && fy > -0.3) fy = -0.3 - rand() * 0.65;
      sprite.scale.setScalar(size);
      scene.add(sprite);
      sparkles.push({ sprite, size, speed: 0.8 + rand() * 1.8, phase: rand() * 10 });
      items.push({ obj: sprite, fx, fy, z, bob: 0.05 + rand() * 0.12, speed: 0.4 + rand() * 0.6, phase: rand() * 10 });
    }
  }

  // --- Layout, pointer, and the loop -----------------------------------------------------------------------------------
  const pointer = { x: 0, y: 0 };
  const smooth = { x: 0, y: 0 };
  const onPointer = (e: PointerEvent) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  };
  if (!reduced) window.addEventListener("pointermove", onPointer);

  const base = new Map<InstanceType<Three["Object3D"]>, InstanceType<Three["Vector3"]>>();
  const layout = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const tan = Math.tan((FOV / 2) * (Math.PI / 180));
    for (const it of items) {
      const halfH = tan * (CAM_Z - it.z);
      base.set(it.obj, new THREE.Vector3(it.fx * halfH * camera.aspect, it.fy * halfH, it.z));
    }
  };

  const draw = (t: number) => {
    smooth.x += (pointer.x - smooth.x) * 0.06;
    smooth.y += (pointer.y - smooth.y) * 0.06;
    camera.position.x = smooth.x * 0.7;
    camera.position.y = 0.2 - smooth.y * 0.4;
    camera.lookAt(0, -0.3, 0);
    for (const it of items) {
      const b = base.get(it.obj)!;
      it.obj.position.set(b.x, b.y + Math.sin(t * it.speed + it.phase) * it.bob, b.z);
      it.spin?.(t, it.z);
    }
    for (const s of sparkles) {
      const k = 0.55 + 0.45 * Math.sin(t * s.speed + s.phase);
      s.sprite.scale.setScalar(s.size * (0.6 + 0.6 * k));
      s.sprite.material.opacity = 0.25 + 0.75 * k;
    }
    renderer.render(scene, camera);
  };

  layout();
  const resize = new ResizeObserver(() => {
    layout();
    if (reduced) draw(0);
  });
  resize.observe(host);

  let raf = 0;
  const clock = new THREE.Clock();
  const frame = () => {
    draw(clock.getElapsedTime());
    raf = requestAnimationFrame(frame);
  };
  if (reduced) draw(0);
  else raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    resize.disconnect();
    window.removeEventListener("pointermove", onPointer);
    for (const d of disposables) d.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
}

/**
 * The 3D picture on Crystal's sign-in and in its installer: a game controller with chat bubbles, headphones, dice and a
 * heart around it — playing and talking with friends. Drawn once with three.js into a transparent canvas, and redrawn
 * only when the panel is resized. Nothing moves: no floating, no spin, no pointer parallax, no animation loop, so it
 * costs nothing while the page sits there.
 *
 * Plain TypeScript with no React in it, so the installer (which has none) can use it too; src/components/auth/login-scene.tsx
 * is the React wrapper. three.js is imported on demand, so a page that never shows this never loads it.
 */

/** Draws the scene into `host` and returns what undoes it. Quiet if there is no WebGL: the page is fine without its picture. */
export function mountLoginScene(host: HTMLElement): () => void {
  let disposed = false;
  let stop: () => void = () => {};
  void (async () => {
    const THREE = await import("three");
    const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
    const { RoundedBoxGeometry } = await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");
    if (disposed) return;
    try {
      stop = build(THREE, host, { RoomEnvironment, RoundedBoxGeometry });
    } catch {
      // No WebGL.
    }
  })();
  return () => {
    disposed = true;
    stop();
  };
}

type Three = typeof import("three");
type Obj = import("three").Object3D;
type Geo = import("three").BufferGeometry<import("three").NormalBufferAttributes>;
type Mat = import("three").Material;
interface Extras {
  RoomEnvironment: typeof import("three/examples/jsm/environments/RoomEnvironment.js").RoomEnvironment;
  RoundedBoxGeometry: typeof import("three/examples/jsm/geometries/RoundedBoxGeometry.js").RoundedBoxGeometry;
}

function build(THREE: Three, host: HTMLElement, x: Extras): () => void {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = false;
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromScene(new x.RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = 0.3;

  const FOV = 30;
  const CAM_Z = 15;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAM_Z);

  scene.add(new THREE.AmbientLight(0xffffff, 0.22));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-4, 6, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9be7ff, 1.1);
  rim.position.set(6, -2, -4);
  scene.add(rim);

  const disposables: { dispose(): void }[] = [renderer, pmrem, envTexture];
  const track = <T extends { dispose(): void }>(d: T): T => (disposables.push(d), d);

  const std = (color: number, o: import("three").MeshPhysicalMaterialParameters = {}) =>
    track(new THREE.MeshPhysicalMaterial({ color, roughness: 0.38, metalness: 0.02, clearcoat: 0.5, clearcoatRoughness: 0.25, ...o }));

  // Every object wears the same gradient — blue, then purple, then green — across *its own* shape, from one corner of it to
  // the other, so each one shows the whole gradient rather than a slice of a bigger one. It is written into the vertex
  // colours once, after the object is built (`applyGradient`), and multiplies the material's white. Neutral dark details
  // use `std` and keep their own colour.
  const STOPS = [new THREE.Color(0x1f63ff), new THREE.Color(0x9333ff), new THREE.Color(0x10d98a)];
  const DIR = new THREE.Vector2(0.8, -0.6);
  const gradientAt = (t: number, out: InstanceType<Three["Color"]>) => {
    const k = Math.min(1, Math.max(0, t)) * 2;
    return k < 1 ? out.copy(STOPS[0]).lerp(STOPS[1], k) : out.copy(STOPS[1]).lerp(STOPS[2], k - 1);
  };
  const applyGradient = (root: Obj) => {
    const meshes = ((root as { isMesh?: boolean }).isMesh ? [root] : root.children).filter((o): o is InstanceType<Three["Mesh"]> => !!(o as { isMesh?: boolean }).isMesh);
    // A mesh's place within its object (the object itself is the identity). Composed now: nothing has rendered yet.
    const to = (m: InstanceType<Three["Mesh"]>) => {
      if (m === root) return new THREE.Matrix4();
      m.updateMatrix();
      return m.matrix;
    };
    const v = new THREE.Vector3();
    // How far along DIR the whole object reaches.
    let lo = Infinity;
    let hi = -Infinity;
    for (const m of meshes) {
      const pos = m.geometry.getAttribute("position") as InstanceType<Three["BufferAttribute"]>;
      const mat = to(m);
      for (let n = 0; n < pos.count; n++) {
        v.fromBufferAttribute(pos, n).applyMatrix4(mat);
        const d = v.x * DIR.x + v.y * DIR.y;
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
    }
    const span = Math.max(1e-6, hi - lo);
    const c = new THREE.Color();
    for (const m of meshes) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (!mats.some((x) => (x as { vertexColors?: boolean }).vertexColors)) continue;
      const pos = m.geometry.getAttribute("position") as InstanceType<Three["BufferAttribute"]>;
      const mat = to(m);
      const col = new Float32Array(pos.count * 3);
      for (let n = 0; n < pos.count; n++) {
        v.fromBufferAttribute(pos, n).applyMatrix4(mat);
        gradientAt((v.x * DIR.x + v.y * DIR.y - lo) / span, c);
        col[n * 3] = c.r;
        col[n * 3 + 1] = c.g;
        col[n * 3 + 2] = c.b;
      }
      m.geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
    }
  };
  /** A material that takes the gradient. */
  const grad = (o: import("three").MeshPhysicalMaterialParameters = {}) =>
    track(new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.4, metalness: 0.02, clearcoat: 0.35, clearcoatRoughness: 0.3, ...o }));

  const canvasTexture = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d")!);
    const t = track(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  };

  /** Everything is placed once: fractions of what the camera sees at that depth, then rotated to a fixed pose. */
  interface Placed {
    obj: Obj;
    fx: number;
    fy: number;
    z: number;
  }
  const placed: Placed[] = [];
  const place = (obj: Obj, fx: number, fy: number, z: number, rot: [number, number, number], scale = 1) => {
    obj.rotation.set(...rot);
    obj.scale.setScalar(scale);
    scene.add(obj);
    placed.push({ obj, fx, fy, z });
  };

  // --- Game controller --------------------------------------------------------------------------------------------------
  const controller = (() => {
    const g = new THREE.Group();
    const shell = grad({ roughness: 0.28 });
    const dark = std(0x1d2026, { roughness: 0.45, clearcoat: 0.3 });
    const add = (geo: Geo, m: Mat, px: number, py: number, pz: number) => {
      const mesh = new THREE.Mesh(track(geo), m);
      mesh.position.set(px, py, pz);
      g.add(mesh);
      return mesh;
    };
    add(new x.RoundedBoxGeometry(3.3, 1.45, 0.78, 8, 0.36), shell, 0, 0.05, 0);
    for (const s of [-1, 1]) {
      const grip = add(new THREE.CapsuleGeometry(0.5, 1.15, 10, 24), shell, s * 1.28, -0.78, -0.02);
      grip.rotation.z = s * 0.28;
      grip.scale.z = 0.8;
    }
    const FRONT = 0.4;
    // D-pad: a cross, sunk into a dark well.
    const well = add(new THREE.CylinderGeometry(0.46, 0.46, 0.06, 40), dark, -1.08, 0.12, FRONT - 0.01);
    well.rotation.x = Math.PI / 2;
    add(new x.RoundedBoxGeometry(0.62, 0.2, 0.14, 3, 0.05), dark, -1.08, 0.12, FRONT + 0.06);
    add(new x.RoundedBoxGeometry(0.2, 0.62, 0.14, 3, 0.05), dark, -1.08, 0.12, FRONT + 0.06);
    // Face buttons, in the usual four colours.
    const faces: [number, number][] = [[1.08, 0.45], [1.38, 0.15], [0.78, 0.15], [1.08, -0.15]];
    for (const [px, py] of faces) {
      const b = add(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 32), grad({ roughness: 0.25 }), px, py - 0.08, FRONT + 0.03);
      b.rotation.x = Math.PI / 2;
    }
    // Sticks.
    for (const [px, py] of [[-0.55, -0.4], [0.55, -0.4]]) {
      const base = add(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 32), dark, px, py, FRONT - 0.01);
      base.rotation.x = Math.PI / 2;
      const cap = add(new THREE.CylinderGeometry(0.22, 0.26, 0.16, 32), std(0x2b2f38, { roughness: 0.55 }), px, py, FRONT + 0.1);
      cap.rotation.x = Math.PI / 2;
    }
    // The Crystal button in the middle, and two small ones either side.
    const home = add(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 32), grad({ roughness: 0.2 }), 0, 0.28, FRONT + 0.02);
    home.rotation.x = Math.PI / 2;
    for (const px of [-0.34, 0.34]) {
      const s = add(new THREE.CapsuleGeometry(0.04, 0.16, 4, 8), dark, px, 0.3, FRONT + 0.01);
      s.rotation.z = Math.PI / 2;
    }
    // Shoulder bumpers.
    for (const s of [-1, 1]) add(new x.RoundedBoxGeometry(0.95, 0.2, 0.36, 4, 0.08), grad(), s * 1.15, 0.8, -0.1);
    return g;
  })();

  // --- Chat bubbles -----------------------------------------------------------------------------------------------------
  const bubble = (w: number, h: number, tail: -1 | 1, face?: InstanceType<Three["CanvasTexture"]>) => {
    const r = Math.min(h / 2, 0.55);
    const x0 = -w / 2;
    const y0 = -h / 2;
    const body = new THREE.Shape();
    body.moveTo(x0 + r, y0);
    body.lineTo(w / 2 - r, y0);
    body.absarc(w / 2 - r, y0 + r, r, -Math.PI / 2, 0, false);
    body.lineTo(w / 2, -y0 - r);
    body.absarc(w / 2 - r, -y0 - r, r, 0, Math.PI / 2, false);
    body.lineTo(x0 + r, -y0);
    body.absarc(x0 + r, -y0 - r, r, Math.PI / 2, Math.PI, false);
    body.lineTo(x0, y0 + r);
    body.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
    // The tail: a small wedge under the corner it speaks from.
    const edge = tail * (w / 2 - r * 0.9);
    const tailShape = new THREE.Shape();
    tailShape.moveTo(edge, y0 + 0.1);
    tailShape.lineTo(edge - tail * 0.75, y0 + 0.1);
    tailShape.lineTo(edge, y0 - 0.5);
    tailShape.closePath();
    const opts = { depth: 0.34, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 6, curveSegments: 28 };
    const mat = grad({ roughness: 0.22 });
    const g = new THREE.Group();
    for (const shape of [body, tailShape]) {
      const geo = track(new THREE.ExtrudeGeometry(shape, opts));
      geo.translate(0, 0, -0.17);
      g.add(new THREE.Mesh(geo, mat));
    }
    if (face) {
      const plane = new THREE.Mesh(track(new THREE.PlaneGeometry(w * 0.9, h * 0.9)), track(new THREE.MeshBasicMaterial({ map: face, transparent: true, toneMapped: false })));
      plane.position.z = 0.3;
      g.add(plane);
    }
    return g;
  };

  const dotsFace = canvasTexture(512, 256, (g) => {
    for (const [i, a] of [0.55, 0.8, 1].entries()) {
      g.beginPath();
      g.arc(150 + i * 106, 128, 36, 0, Math.PI * 2);
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.fill();
    }
  });
  const textFace = (label: string, color = "#ffffff") =>
    canvasTexture(512, 256, (g) => {
      g.font = "900 150px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = color;
      g.fillText(label, 256, 138);
    });
  const emojiFace = (emoji: string) =>
    canvasTexture(512, 256, (g) => {
      g.font = "170px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(emoji, 256, 140);
    });

  // --- Headphones -------------------------------------------------------------------------------------------------------
  const headphones = (() => {
    const g = new THREE.Group();
    const band = new THREE.Mesh(track(new THREE.TorusGeometry(1.15, 0.1, 20, 64, Math.PI)), grad({ roughness: 0.3 }));
    g.add(band);
    for (const s of [-1, 1]) {
      const cup = new THREE.Mesh(track(new THREE.CylinderGeometry(0.52, 0.52, 0.42, 48)), std(0x1f2937, { roughness: 0.4 }));
      cup.rotation.z = Math.PI / 2;
      cup.position.set(s * 1.15, 0, 0);
      g.add(cup);
      const pad = new THREE.Mesh(track(new THREE.TorusGeometry(0.46, 0.13, 20, 48)), grad({ roughness: 0.7, clearcoat: 0.1 }));
      pad.rotation.y = Math.PI / 2;
      pad.position.set(s * 0.92, 0, 0);
      g.add(pad);
      const cap = new THREE.Mesh(track(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 40)), grad({ metalness: 0.5, roughness: 0.25 }));
      cap.rotation.z = Math.PI / 2;
      cap.position.set(s * 1.38, 0, 0);
      g.add(cap);
    }
    return g;
  })();

  // --- Dice -------------------------------------------------------------------------------------------------------------
  const die = (() => {
    const pips: Record<number, [number, number][]> = {
      1: [[0.5, 0.5]],
      2: [[0.27, 0.27], [0.73, 0.73]],
      3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
      4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
      5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
      6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]],
    };
    const face = (n: number) =>
      track(new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        map: canvasTexture(256, 256, (g) => {
          g.fillStyle = "#ffffff";
          g.fillRect(0, 0, 256, 256);
          g.fillStyle = "#1e1b4b";
          for (const [px, py] of pips[n]) {
            g.beginPath();
            g.arc(px * 256, py * 256, 25, 0, Math.PI * 2);
            g.fill();
          }
        }),
        roughness: 0.25,
        clearcoat: 1,
      }));
    return new THREE.Mesh(track(new x.RoundedBoxGeometry(1, 1, 1, 6, 0.14)), [face(3), face(4), face(1), face(6), face(2), face(5)]);
  })();

  // --- Heart ------------------------------------------------------------------------------------------------------------
  const heart = (() => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.9);
    s.bezierCurveTo(-0.2, -0.7, -1.0, -0.25, -1.0, 0.3);
    s.bezierCurveTo(-1.0, 0.8, -0.35, 1.0, 0, 0.55);
    s.bezierCurveTo(0.35, 1.0, 1.0, 0.8, 1.0, 0.3);
    s.bezierCurveTo(1.0, -0.25, 0.2, -0.7, 0, -0.9);
    const geo = track(new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.22, bevelSize: 0.2, bevelSegments: 10, curveSegments: 32 }));
    geo.center();
    return new THREE.Mesh(geo, grad({ roughness: 0.2, clearcoat: 1 }));
  })();

  // --- A play button and a few stars ---------------------------------------------------------------------------------------
  const play = (() => {
    const s = new THREE.Shape();
    s.moveTo(-0.5, -0.6);
    s.lineTo(0.7, 0);
    s.lineTo(-0.5, 0.6);
    s.closePath();
    const geo = track(new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.16, bevelSize: 0.14, bevelSegments: 8 }));
    geo.center();
    return new THREE.Mesh(geo, grad({ roughness: 0.2, clearcoat: 1 }));
  })();
  const star = () => {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 ? 0.42 : 1;
      s[i === 0 ? "moveTo" : "lineTo"](Math.cos(a) * rr, Math.sin(a) * rr);
    }
    s.closePath();
    const geo = track(new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.08, bevelSegments: 5 }));
    geo.center();
    return new THREE.Mesh(geo, grad({ roughness: 0.2, clearcoat: 1 }));
  };

  // --- Composition ---------------------------------------------------------------------------------------------------------
  // Fixed poses, by hand. fx/fy are fractions of the half-width / half-height visible at that depth.
  place(controller, 0.0, -0.1, 0, [-0.38, 0.32, -0.12], 1.28);
  place(headphones, -0.66, 0.5, -1.2, [0.25, 0.5, 0.36], 0.95);
  place(bubble(2.6, 1.3, -1, dotsFace), 0.5, 0.58, 0.4, [-0.08, -0.3, 0.06]);
  place(bubble(1.9, 1.15, 1, textFace("gg")), -0.5, -0.18, 1.6, [0.05, 0.38, -0.08], 0.9);
  place(bubble(1.5, 1.2, -1, emojiFace("🔥")), 0.82, 0.05, 0.8, [0.0, -0.4, -0.1], 0.9);
  place(bubble(1.5, 1.2, 1, emojiFace("🎮")), -0.88, -0.72, 0.6, [0.12, 0.45, 0.1], 0.8);
  place(die, 0.58, -0.7, 1.2, [0.55, 0.7, 0.2], 1.15);
  place(heart, 0.2, 0.74, 0.6, [0.1, -0.35, 0.18], 0.55);
  place(play, -0.28, 0.82, -0.4, [0.2, -0.4, -0.1], 0.5);
  place(star(), 0.95, 0.72, -0.6, [0.2, 0.3, 0.3], 0.34);
  place(star(), -0.98, 0.1, -1, [0.1, -0.2, 0.2], 0.22);
  place(star(), 0.42, -0.95, -0.5, [0.1, 0.1, -0.2], 0.26);

  for (const p of placed) applyGradient(p.obj);

  // A few sparkles, fixed in place.
  const sparkleTex = canvasTexture(128, 128, (g) => {
    const glow = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    glow.addColorStop(0, "rgba(255,255,255,0.9)");
    glow.addColorStop(0.2, "rgba(255,255,255,0.3)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, 128, 128);
    g.beginPath();
    g.moveTo(64, 4);
    g.quadraticCurveTo(68, 60, 124, 64);
    g.quadraticCurveTo(68, 68, 64, 124);
    g.quadraticCurveTo(60, 68, 4, 64);
    g.quadraticCurveTo(60, 60, 64, 4);
    g.fillStyle = "#fff";
    g.fill();
  });
  const sparkles: [number, number, number, number][] = [
    [-0.78, 0.82, -0.8, 0.7], [0.1, 0.3, -1, 0.5], [0.96, -0.3, -0.8, 0.6], [-0.2, -0.85, -0.6, 0.55], [0.7, 0.9, -1, 0.4],
    [-0.95, -0.35, -1, 0.45], [0.3, -0.45, -1.5, 0.35], [-0.45, 0.36, -1.5, 0.4],
  ];
  for (const [fx, fy, z, size] of sparkles) {
    const sprite = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: sparkleTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 })));
    sprite.scale.setScalar(size);
    scene.add(sprite);
    placed.push({ obj: sprite, fx, fy, z });
  }

  const draw = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const tan = Math.tan((FOV / 2) * (Math.PI / 180));
    // The composition is drawn for a panel about 1.9 times wider than tall; a narrower one scales it down to fit its width.
    const fit = Math.min(1, camera.aspect / 1.9);
    for (const p of placed) {
      const halfH = tan * (CAM_Z - p.z);
      p.obj.position.set(p.fx * halfH * camera.aspect * 0.94, (p.fy * 0.9) * halfH, p.z);
    }
    for (const p of placed) if (!(p.obj as { isSprite?: boolean }).isSprite) p.obj.scale.setScalar(p.obj.userData.base * fit);
    renderer.render(scene, camera);
  };
  for (const p of placed) p.obj.userData.base = p.obj.scale.x;

  draw();
  const resize = new ResizeObserver(draw);
  resize.observe(host);

  return () => {
    resize.disconnect();
    for (const d of disposables) d.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
}

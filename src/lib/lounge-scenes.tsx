import type { ReactNode } from "react";

import type { SceneSpecProp } from "../../convex/lib/creationSpecs";

/**
 * The rooms a lounge can be.
 *
 * A scene is a picture with three facts about it: where the screen is (the
 * place a stream is shown), where the floor starts (the part people may walk on)
 * and where they can sit. Everything is in percentages of the picture, so a
 * scene is the same room at any size, and a scene bought from the marketplace
 * is described by exactly the same numbers.
 *
 * The built-in scenes are drawn in SVG rather than shipped as pictures, for the
 * same reason the avatar decorations are: they need no network, cost a few
 * hundred bytes and look sharp at any size.
 */

export interface SceneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SceneSeat {
  x: number;
  y: number;
}

export interface LoungeScene {
  id: string;
  name: string;
  blurb: string;
  /** The screen, as a percentage of the picture. */
  screen: SceneRect;
  /** Where the floor starts, as a percentage from the top. */
  floorTop: number;
  seats: SceneSeat[];
  /** Props placed in the room, if it has any. */
  props?: SceneSpecProp[];
  /** The picture, drawn to fill a 160×90 box. */
  art: ReactNode;
}

const Plank = ({ y, tone = "#000" }: { y: number; tone?: string }) => (
  <line x1="0" x2="160" y1={y} y2={y} stroke={tone} strokeOpacity="0.16" strokeWidth="0.3" />
);

/** A TV: bezel, glass and a sliver of reflection. The glass itself is drawn over
 * this by the stage — this is only the frame around it. */
const Bezel = ({ r, color = "#0b0b12" }: { r: SceneRect; color?: string }) => {
  const x = (r.x / 100) * 160;
  const y = (r.y / 100) * 90;
  const w = (r.w / 100) * 160;
  const h = (r.h / 100) * 90;
  return <rect x={x - 1.6} y={y - 1.6} width={w + 3.2} height={h + 3.2} rx="1.6" fill={color} />;
};

/** A seat, placed by where the furniture is drawn: the art's own 160×90 units,
 * converted to the percentages everything else in a scene is measured in.
 * Written this way so a seat is read off the drawing, not worked out from it. */
const seat = (artX: number, artY: number): SceneSeat => ({
  x: +((artX / 160) * 100).toFixed(2),
  y: +((artY / 90) * 100).toFixed(2),
});

const LIVING_SCREEN: SceneRect = { x: 31, y: 11, w: 38, h: 31 };
const CINEMA_SCREEN: SceneRect = { x: 21, y: 7, w: 58, h: 42 };
const BEACH_SCREEN: SceneRect = { x: 30, y: 10, w: 40, h: 32 };
const ARCADE_SCREEN: SceneRect = { x: 28, y: 9, w: 44, h: 33 };

export const LOUNGE_SCENES: LoungeScene[] = [
  {
    id: "living-room",
    name: "Living room",
    blurb: "A cosy room with a couch and beanbags.",
    screen: LIVING_SCREEN,
    floorTop: 58,
    // The three couch cushions, then a beanbag either side.
    seats: [seat(64, 77), seat(80, 77), seat(96, 77), seat(22, 84), seat(138, 85)],
    art: (
      <>
        <defs>
          <linearGradient id="lr-wall" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#3b2d5e" />
            <stop offset="1" stopColor="#25193f" />
          </linearGradient>
          <linearGradient id="lr-floor" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#5d4030" />
            <stop offset="1" stopColor="#35241b" />
          </linearGradient>
          <radialGradient id="lr-glow" cx="0.5" cy="0.3" r="0.6">
            <stop offset="0" stopColor="#8aa4ff" stopOpacity="0.28" />
            <stop offset="1" stopColor="#8aa4ff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="160" height="90" fill="url(#lr-wall)" />
        <rect y="52" width="160" height="38" fill="url(#lr-floor)" />
        {[58, 64, 71, 79, 88].map((y) => (
          <Plank key={y} y={y} />
        ))}
        <rect y="51" width="160" height="1.6" fill="#1b1230" />
        {/* a window, and a picture frame */}
        <rect x="6" y="10" width="22" height="26" rx="1.5" fill="#18264d" />
        <rect x="7.5" y="11.5" width="19" height="23" fill="#4f7bd1" opacity="0.55" />
        <path d="M17 11.5v23M7.5 23h19" stroke="#18264d" strokeWidth="1" />
        <rect x="132" y="12" width="20" height="14" rx="1" fill="#1b1230" />
        <rect x="134" y="14" width="16" height="10" fill="#d98a5b" opacity="0.75" />
        <circle cx="144" cy="19" r="3" fill="#f6d28a" opacity="0.9" />
        {/* TV on a console */}
        <Bezel r={LIVING_SCREEN} />
        <rect x="46" y="44" width="68" height="8" rx="1.2" fill="#6b4a37" />
        <rect x="48" y="45.5" width="64" height="1" fill="#000" opacity="0.18" />
        <rect x="72" y="41.5" width="16" height="2.4" fill="#0b0b12" />
        <ellipse cx="80" cy="46" rx="60" ry="30" fill="url(#lr-glow)" />
        {/* rug */}
        <ellipse cx="80" cy="74" rx="54" ry="11" fill="#7a3558" opacity="0.8" />
        <ellipse cx="80" cy="74" rx="46" ry="8.5" fill="none" stroke="#f1b8cf" strokeOpacity="0.35" strokeWidth="0.6" />
        {/* couch */}
        <rect x="52" y="66" width="56" height="16" rx="4" fill="#3d5a7a" />
        <rect x="55" y="70" width="50" height="11" rx="3" fill="#4a6c91" />
        <path d="M80 70v11" stroke="#2f4862" strokeWidth="0.6" />
        <rect x="49" y="68" width="8" height="15" rx="3.5" fill="#34506d" />
        <rect x="103" y="68" width="8" height="15" rx="3.5" fill="#34506d" />
        {/* beanbags */}
        <ellipse cx="22" cy="86" rx="11" ry="6.5" fill="#d9625b" />
        <ellipse cx="22" cy="83.5" rx="8" ry="4" fill="#e9847d" />
        <ellipse cx="138" cy="87" rx="12" ry="6.5" fill="#e0b24c" />
        <ellipse cx="138" cy="84.5" rx="9" ry="4" fill="#efca72" />
        {/* lamp and plant */}
        <rect x="150" y="38" width="1.2" height="30" fill="#0f0a1c" />
        <path d="M144 38h13l-3 8h-7z" fill="#f4d58d" opacity="0.9" />
        <rect x="6" y="64" width="9" height="12" rx="1.5" fill="#8b5a3c" />
        <path d="M10.5 64c-5-6-6-12-3-16 2 4 4 7 3 16zm0 0c4-7 8-10 12-10-3 4-6 6-12 10z" fill="#3f9a5b" />
      </>
    ),
  },
  {
    id: "cinema",
    name: "Cinema",
    blurb: "Velvet seats and a screen that fills the wall.",
    screen: CINEMA_SCREEN,
    floorTop: 60,
    // Two rows of velvet seats, front row first — see the rows drawn below.
    seats: [
      ...[50, 62, 74, 86, 98, 110].map((x) => seat(x, 67)),
      ...[56, 68, 80, 92, 104].map((x) => seat(x, 79)),
    ],
    art: (
      <>
        <defs>
          <linearGradient id="ci-wall" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#1a0b12" />
            <stop offset="1" stopColor="#0d0509" />
          </linearGradient>
          <linearGradient id="ci-floor" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#3a0f1c" />
            <stop offset="1" stopColor="#1c070e" />
          </linearGradient>
          <linearGradient id="ci-curtain" x1="0" x2="1">
            <stop offset="0" stopColor="#5e0f24" />
            <stop offset="0.5" stopColor="#8e1b38" />
            <stop offset="1" stopColor="#5e0f24" />
          </linearGradient>
          <radialGradient id="ci-beam" cx="0.5" cy="0.2" r="0.8">
            <stop offset="0" stopColor="#bcd0ff" stopOpacity="0.22" />
            <stop offset="1" stopColor="#bcd0ff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="160" height="90" fill="url(#ci-wall)" />
        <rect y="54" width="160" height="36" fill="url(#ci-floor)" />
        <rect y="52.5" width="160" height="2" fill="#2a0a14" />
        <Bezel r={CINEMA_SCREEN} color="#050308" />
        <rect x="0" y="0" width="30" height="58" fill="url(#ci-curtain)" />
        <rect x="130" y="0" width="30" height="58" fill="url(#ci-curtain)" />
        {[6, 12, 18, 24, 136, 142, 148, 154].map((x) => (
          <line key={x} x1={x} x2={x} y1="0" y2="58" stroke="#000" strokeOpacity="0.25" strokeWidth="0.7" />
        ))}
        <rect x="0" y="0" width="160" height="5" fill="#3b0a1a" />
        <ellipse cx="80" cy="30" rx="70" ry="40" fill="url(#ci-beam)" />
        {/* rows of seats */}
        {[
          { y: 66, xs: [50, 62, 74, 86, 98, 110] },
          { y: 78, xs: [56, 68, 80, 92, 104] },
        ].map((row) =>
          row.xs.map((x) => (
            <g key={`${row.y}-${x}`}>
              <rect x={x - 5} y={row.y - 7} width="10" height="10" rx="2.5" fill="#8e1b38" />
              <rect x={x - 5} y={row.y} width="10" height="5" rx="2" fill="#b02a4c" />
              <rect x={x - 6.5} y={row.y - 1} width="2" height="6" rx="1" fill="#6e1228" />
              <rect x={x + 4.5} y={row.y - 1} width="2" height="6" rx="1" fill="#6e1228" />
            </g>
          )),
        )}
        {/* popcorn */}
        <rect x="130" y="74" width="9" height="10" rx="1" fill="#d63a3a" />
        <path d="M130 74h9l-1 3h-7z" fill="#fff" opacity="0.85" />
        <circle cx="133" cy="73" r="2" fill="#ffe9a8" />
        <circle cx="136.5" cy="72.5" r="2" fill="#ffe9a8" />
      </>
    ),
  },
  {
    id: "beach",
    name: "Beach night",
    blurb: "A sheet between two palms, and the sea behind.",
    screen: BEACH_SCREEN,
    floorTop: 56,
    // Three logs round the fire, and two beanbags.
    seats: [seat(30, 79), seat(58, 81), seat(86, 79), seat(46, 85), seat(74, 86)],
    art: (
      <>
        <defs>
          <linearGradient id="bc-sky" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#1d1b4b" />
            <stop offset="0.55" stopColor="#7a3b73" />
            <stop offset="1" stopColor="#f08a5d" />
          </linearGradient>
          <linearGradient id="bc-sea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#254c8a" />
            <stop offset="1" stopColor="#173866" />
          </linearGradient>
          <linearGradient id="bc-sand" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#d9b98a" />
            <stop offset="1" stopColor="#a98760" />
          </linearGradient>
        </defs>
        <rect width="160" height="90" fill="url(#bc-sky)" />
        {[[12, 8], [40, 14], [118, 6], [140, 16], [96, 10], [70, 5]].map(([x, y]) => (
          <circle key={`${x}${y}`} cx={x} cy={y} r="0.5" fill="#fff" opacity="0.8" />
        ))}
        <circle cx="132" cy="38" r="9" fill="#ffd7a3" opacity="0.9" />
        <rect y="38" width="160" height="14" fill="url(#bc-sea)" />
        <path d="M0 44h160" stroke="#fff" strokeOpacity="0.18" strokeWidth="0.4" strokeDasharray="6 5" />
        <rect y="52" width="160" height="38" fill="url(#bc-sand)" />
        {/* palms */}
        {[
          { x: 12, flip: 1 },
          { x: 148, flip: -1 },
        ].map((p) => (
          <g key={p.x} transform={`translate(${p.x} 0) scale(${p.flip} 1)`}>
            <path d="M0 76C1 56 3 38 6 22" stroke="#2b1a14" strokeWidth="2.4" fill="none" strokeLinecap="round" />
            <path d="M6 22c-8-2-14 1-18 8 6-2 12-3 18-8zm0 0c8-6 15-5 20 0-7-1-13 0-20 0zm0 0c-3-8-1-14 5-18-1 6-2 12-5 18zm0 0c6 3 10 9 10 15-5-4-8-9-10-15z" fill="#14402a" />
          </g>
        ))}
        {/* the sheet, on two posts */}
        <Bezel r={BEACH_SCREEN} color="#e8e2d6" />
        <rect x="46" y="38" width="1.6" height="22" fill="#4a3426" />
        <rect x="112.4" y="38" width="1.6" height="22" fill="#4a3426" />
        {/* logs and beanbags */}
        {[30, 58, 86].map((x) => (
          <rect key={x} x={x - 9} y={x === 58 ? 78 : 76} width="18" height="5" rx="2.5" fill="#6b4a37" />
        ))}
        <ellipse cx="46" cy="84" rx="8" ry="4" fill="#3aa6a0" />
        <ellipse cx="74" cy="85" rx="8" ry="4" fill="#e4865f" />
        {/* fire */}
        <path d="M118 82c-2-4 0-6 1-9 1 3 4 4 3 9a4 4 0 0 1-4 0z" fill="#f59e42" />
        <path d="M118.5 82c-1-2 0-3 .5-5 1 1.5 2 2 1.5 5z" fill="#ffe08a" />
        <ellipse cx="119" cy="83" rx="5" ry="1.4" fill="#000" opacity="0.25" />
      </>
    ),
  },
  {
    id: "arcade",
    name: "Neon arcade",
    blurb: "Glow, grid and a CRT as big as the wall.",
    screen: ARCADE_SCREEN,
    floorTop: 58,
    // The sofa's three cushions, then a beanbag either side.
    seats: [seat(41, 78), seat(51, 78), seat(61, 78), seat(22, 87), seat(144, 87)],
    art: (
      <>
        <defs>
          <linearGradient id="ar-wall" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#14082e" />
            <stop offset="1" stopColor="#2a0e4f" />
          </linearGradient>
          <linearGradient id="ar-floor" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#1d0b3b" />
            <stop offset="1" stopColor="#0c0420" />
          </linearGradient>
          <filter id="ar-blur">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>
        <rect width="160" height="90" fill="url(#ar-wall)" />
        <rect y="52" width="160" height="38" fill="url(#ar-floor)" />
        {/* the grid floor */}
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <line key={`h${i}`} x1="0" x2="160" y1={54 + i * i * 1.2 + i * 2} y2={54 + i * i * 1.2 + i * 2} stroke="#35e0ff" strokeOpacity="0.22" strokeWidth="0.3" />
        ))}
        {Array.from({ length: 17 }, (_, i) => (
          <line key={`v${i}`} x1={80 + (i - 8) * 4} x2={80 + (i - 8) * 18} y1="52" y2="90" stroke="#ff3dcb" strokeOpacity="0.2" strokeWidth="0.3" />
        ))}
        <rect y="51.5" width="160" height="1" fill="#ff3dcb" opacity="0.7" />
        {/* the screen's glow and frame */}
        <rect x="24" y="5" width="112" height="41" rx="3" fill="#ff3dcb" opacity="0.35" filter="url(#ar-blur)" />
        <Bezel r={ARCADE_SCREEN} color="#0a0418" />
        <rect x={(ARCADE_SCREEN.x / 100) * 160 - 2.6} y={(ARCADE_SCREEN.y / 100) * 90 - 2.6} width={(ARCADE_SCREEN.w / 100) * 160 + 5.2} height={(ARCADE_SCREEN.h / 100) * 90 + 5.2} rx="2.4" fill="none" stroke="#35e0ff" strokeWidth="0.7" />
        {/* cabinets */}
        {[
          { x: 4, hue: "#ff3dcb" },
          { x: 136, hue: "#35e0ff" },
        ].map((c) => (
          <g key={c.x}>
            <rect x={c.x} y="28" width="20" height="42" rx="2" fill="#150a2e" stroke={c.hue} strokeWidth="0.6" />
            <rect x={c.x + 3} y="32" width="14" height="12" rx="1" fill={c.hue} opacity="0.55" />
            <rect x={c.x + 4} y="50" width="12" height="4" rx="1" fill="#0a0418" />
            <circle cx={c.x + 7} cy="52" r="1" fill="#ffd23f" />
            <circle cx={c.x + 13} cy="52" r="1" fill="#ff5f5f" />
          </g>
        ))}
        {/* neon sign */}
        <text x="80" y="4.2" textAnchor="middle" fontSize="3.4" fontWeight="700" fill="#35e0ff" opacity="0.9" letterSpacing="1">
          INSERT COIN
        </text>
        {/* sofa and beanbags */}
        <rect x="32" y="68" width="38" height="13" rx="3.5" fill="#6f2dbd" />
        <rect x="35" y="72" width="32" height="8.5" rx="2.5" fill="#8a46d9" />
        <ellipse cx="22" cy="86" rx="10" ry="5.6" fill="#ff3dcb" opacity="0.85" />
        <ellipse cx="144" cy="86" rx="10" ry="5.6" fill="#35e0ff" opacity="0.8" />
      </>
    ),
  },
];

const BY_ID = new Map(LOUNGE_SCENES.map((s) => [s.id, s]));

/** What a channel's stored scene resolves to: a built-in, or a bought one drawn
 * as a picture with the same three facts. */
export interface ResolvedScene {
  id: string;
  name: string;
  screen: SceneRect;
  floorTop: number;
  seats: SceneSeat[];
  /** Animated props — from a bought scene, and the built-in ones that have a
   * fire or a lamp of their own. */
  props: SceneSpecProp[];
  /** Whether the room darkens while somebody is sharing, and how far. */
  lights: { dimOnShare: boolean; amount: number };
  /** Built-in art, or undefined when `backgroundUrl` is used. */
  art?: ReactNode;
  backgroundUrl?: string;
}

export function resolveScene(channel: {
  loungeScene?: string;
  loungeSceneCustom?: {
    name: string;
    backgroundUrl: string;
    screen: SceneRect;
    floorTop: number;
    seats?: SceneSeat[];
    props?: { id: string; kind: string; x: number; y: number; size: number; interactive: boolean; on: boolean }[];
    lights?: { dimOnShare: boolean; amount: number };
  };
}): ResolvedScene {
  if (channel.loungeScene === "custom" && channel.loungeSceneCustom) {
    const c = channel.loungeSceneCustom;
    return {
      id: "custom",
      name: c.name,
      screen: c.screen,
      floorTop: c.floorTop,
      seats: c.seats ?? [],
      props: (c.props ?? []) as SceneSpecProp[],
      lights: c.lights ?? { dimOnShare: false, amount: 0.6 },
      backgroundUrl: c.backgroundUrl,
    };
  }
  const scene = BY_ID.get(channel.loungeScene ?? "living-room") ?? LOUNGE_SCENES[0];
  return {
    id: scene.id,
    name: scene.name,
    screen: scene.screen,
    floorTop: scene.floorTop,
    seats: scene.seats,
    props: scene.props ?? [],
    // The cinema has always put its lights down for a show.
    lights: { dimOnShare: scene.id === "cinema", amount: 0.66 },
    art: scene.art,
  };
}

/** A built-in scene as a small picture, for the pickers. */
export function SceneThumbnail({ scene }: { scene: LoungeScene }) {
  return (
    <svg viewBox="0 0 160 90" className="size-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {scene.art}
    </svg>
  );
}

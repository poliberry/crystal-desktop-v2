"use client";

import { RoomEvent, type Room, type RemoteParticipant } from "livekit-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SceneSpecProp, ScenePropKind } from "../../../convex/lib/creationSpecs";
import { cn } from "@/lib/utils";

/**
 * The animated things a scene can have in it: a fire, a lamp, a disco ball.
 *
 * They are drawn here, by Crystal, from a fixed catalogue. A scene says *which*
 * and *where* — never how — so nothing a creator uploads runs: it can choose a
 * fire, but only this file decides what a fire looks like.
 *
 * A prop is either always doing its thing or switchable. A switchable one can be
 * clicked by anyone in the room, and the new state travels to everyone else as a
 * small LiveKit data packet, the same way walking does.
 */

export const PROP_TOPIC = "lounge:prop";

interface PropPacket {
  id: string;
  on: boolean;
  /** When it was changed, on the sender's clock — the newest wins. */
  ts: number;
}

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

/** Which props are on, shared by everyone in the room. */
export function useLoungeProps(room: Room, props: SceneSpecProp[], enabled: boolean) {
  const initial = useMemo(() => new Map(props.map((p) => [p.id, { on: p.on, ts: 0 }])), [props]);
  const [state, setState] = useState(initial);
  const stateRef = useRef(state);
  stateRef.current = state;

  // A different scene is a different set of props, back to how it starts.
  useEffect(() => setState(initial), [initial]);

  const ids = useMemo(() => new Set(props.map((p) => p.id)), [props]);

  const apply = useCallback(
    (packet: PropPacket) => {
      if (!ids.has(packet.id) || typeof packet.on !== "boolean" || typeof packet.ts !== "number") return;
      setState((prev) => {
        const current = prev.get(packet.id);
        if (current && current.ts >= packet.ts) return prev;
        const next = new Map(prev);
        next.set(packet.id, { on: packet.on, ts: packet.ts });
        return next;
      });
    },
    [ids],
  );

  const toggle = useCallback(
    (id: string) => {
      const current = stateRef.current.get(id);
      if (!current) return;
      const packet: PropPacket = { id, on: !current.on, ts: Date.now() };
      apply(packet);
      void room.localParticipant.publishData(encode(packet), { reliable: true, topic: PROP_TOPIC }).catch(() => {});
    },
    [room, apply],
  );

  useEffect(() => {
    if (!enabled) return;
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (!participant || topic !== PROP_TOPIC) return;
      try {
        apply(JSON.parse(new TextDecoder().decode(payload)) as PropPacket);
      } catch {
        /* malformed */
      }
    };
    // Somebody arrived: tell them what has been switched, so they see the same room.
    const onJoined = (participant: RemoteParticipant) => {
      for (const [id, s] of stateRef.current) {
        if (s.ts === 0) continue;
        void room.localParticipant
          .publishData(encode({ id, on: s.on, ts: s.ts }), {
            reliable: true,
            topic: PROP_TOPIC,
            destinationIdentities: [participant.identity],
          })
          .catch(() => {});
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.ParticipantConnected, onJoined);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.ParticipantConnected, onJoined);
    };
  }, [enabled, room, apply]);

  return { isOn: (id: string) => state.get(id)?.on ?? true, toggle };
}

// --- Art ---------------------------------------------------------------------------------

/** Width : height of each prop's drawing. */
export const PROP_ASPECT: Record<ScenePropKind, number> = {
  fire: 1,
  lamp: 0.6,
  neon: 2.2,
  discoball: 0.8,
  fireflies: 1.6,
  snow: 1.4,
  steam: 0.7,
  candle: 0.5,
};

function Art({ kind, on }: { kind: ScenePropKind; on: boolean }) {
  switch (kind) {
    case "fire":
      return (
        <svg viewBox="0 0 100 100" className="size-full overflow-visible" aria-hidden>
          {on && <circle cx="50" cy="62" r="46" fill="url(#pf-glow)" className="lounge-prop-pulse" />}
          <defs>
            <radialGradient id="pf-glow">
              <stop offset="0" stopColor="#ffb347" stopOpacity="0.55" />
              <stop offset="1" stopColor="#ff7a18" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect x="22" y="84" width="56" height="9" rx="4.5" fill="#5a3a26" />
          <rect x="30" y="76" width="44" height="9" rx="4.5" fill="#6b4a37" transform="rotate(-6 52 80)" />
          {on ? (
            <g className="lounge-flicker" style={{ transformOrigin: "50px 84px" }}>
              <path d="M50 20c8 14 22 22 22 42a22 22 0 0 1-44 0c0-12 6-18 12-26 2 8 6 10 8 12 0-10-2-18 2-28z" fill="#f59e42" />
              <path d="M50 44c5 8 12 12 12 22a12 12 0 0 1-24 0c0-6 3-10 7-14 1 4 3 6 5 7z" fill="#ffe08a" />
            </g>
          ) : (
            <g>
              <circle cx="42" cy="80" r="2" fill="#ff7a18" opacity="0.6" />
              <circle cx="58" cy="82" r="1.6" fill="#ff7a18" opacity="0.5" />
            </g>
          )}
        </svg>
      );
    case "lamp":
      return (
        <svg viewBox="0 0 60 100" className="size-full overflow-visible" aria-hidden>
          {on && (
            <>
              <defs>
                <linearGradient id="pl-beam" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="#ffe9a8" stopOpacity="0.5" />
                  <stop offset="1" stopColor="#ffe9a8" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M8 26 L-30 100 L90 100 L52 26z" fill="url(#pl-beam)" />
            </>
          )}
          <rect x="29" y="30" width="3" height="62" fill="#1b1230" />
          <ellipse cx="30.5" cy="94" rx="14" ry="3" fill="#1b1230" />
          <path d="M8 26h44l-8-22H16z" fill={on ? "#f4d58d" : "#8a7a58"} />
        </svg>
      );
    case "candle":
      return (
        <svg viewBox="0 0 40 80" className="size-full overflow-visible" aria-hidden>
          {on && <circle cx="20" cy="22" r="22" fill="#ffcf70" opacity="0.18" className="lounge-prop-pulse" />}
          <rect x="12" y="34" width="16" height="42" rx="3" fill="#f1e6cf" />
          <rect x="19" y="28" width="2" height="8" fill="#3a2a1a" />
          {on && (
            <path d="M20 8c5 7 7 11 7 15a7 7 0 0 1-14 0c0-4 2-8 7-15z" fill="#ffb347" className="lounge-flicker" style={{ transformOrigin: "20px 30px" }} />
          )}
        </svg>
      );
    case "neon":
      return (
        <svg viewBox="0 0 110 50" className="size-full overflow-visible" aria-hidden>
          <rect
            x="4"
            y="4"
            width="102"
            height="42"
            rx="14"
            fill="none"
            stroke={on ? "#ff3dcb" : "#5a2a52"}
            strokeWidth="4"
            className={on ? "lounge-neon" : undefined}
            style={on ? { filter: "drop-shadow(0 0 5px #ff3dcb) drop-shadow(0 0 12px #ff3dcb)" } : undefined}
          />
          <rect
            x="16"
            y="16"
            width="78"
            height="18"
            rx="8"
            fill="none"
            stroke={on ? "#35e0ff" : "#1d4a55"}
            strokeWidth="3"
            className={on ? "lounge-neon" : undefined}
            style={on ? { filter: "drop-shadow(0 0 5px #35e0ff) drop-shadow(0 0 10px #35e0ff)", animationDelay: "0.4s" } : undefined}
          />
        </svg>
      );
    case "discoball":
      return (
        <svg viewBox="0 0 80 100" className="size-full overflow-visible" aria-hidden>
          <rect x="39" y="0" width="2" height="32" fill="#888" />
          <g className={on ? "lounge-spin" : undefined} style={{ transformOrigin: "40px 52px" }}>
            <circle cx="40" cy="52" r="20" fill="#c8cdd8" />
            {[
              [30, 44],
              [44, 40],
              [52, 52],
              [36, 58],
              [46, 64],
              [28, 54],
            ].map(([x, y], i) => (
              <rect key={i} x={x - 3} y={y - 3} width="6" height="6" fill={i % 2 ? "#fff" : "#9aa3b5"} opacity="0.9" />
            ))}
          </g>
          {on &&
            [0, 1, 2, 3].map((i) => (
              <circle
                key={i}
                cx={[-20, 100, 10, 70][i]}
                cy={[60, 70, 92, 94][i]}
                r="6"
                fill={["#ff3dcb", "#35e0ff", "#ffd23f", "#7cf29c"][i]}
                opacity="0.55"
                className="lounge-twinkle"
                style={{ animationDelay: `${i * 0.35}s` }}
              />
            ))}
        </svg>
      );
    case "fireflies":
      return (
        <svg viewBox="0 0 160 100" className="size-full overflow-visible" aria-hidden>
          {on &&
            Array.from({ length: 9 }, (_, i) => (
              <circle
                key={i}
                cx={14 + ((i * 53) % 132)}
                cy={12 + ((i * 37) % 76)}
                r="2.4"
                fill="#d9ff7a"
                className="lounge-firefly"
                style={{ animationDelay: `${(i % 5) * 0.7}s`, animationDuration: `${3.2 + (i % 4)}s` }}
              />
            ))}
        </svg>
      );
    case "snow":
      return (
        <svg viewBox="0 0 140 100" className="size-full overflow-hidden" aria-hidden>
          {on &&
            Array.from({ length: 22 }, (_, i) => (
              <circle
                key={i}
                cx={(i * 47) % 140}
                cy="-4"
                r={1 + (i % 3) * 0.6}
                fill="#fff"
                opacity="0.85"
                className="lounge-snow"
                style={{ animationDelay: `${(i % 11) * 0.45}s`, animationDuration: `${4 + (i % 5)}s` }}
              />
            ))}
        </svg>
      );
    case "steam":
      return (
        <svg viewBox="0 0 70 100" className="size-full overflow-visible" aria-hidden>
          <path d="M14 70h42l-5 24H19z" fill="#e9e1d3" />
          {on &&
            [0, 1, 2].map((i) => (
              <path
                key={i}
                d={`M${24 + i * 11} 66c-6-8 6-14 0-24`}
                fill="none"
                stroke="#fff"
                strokeWidth="3"
                strokeLinecap="round"
                opacity="0.6"
                className="lounge-steam"
                style={{ animationDelay: `${i * 0.5}s` }}
              />
            ))}
        </svg>
      );
  }
}

/** One prop, standing where the scene says. */
export function ScenePropView({
  prop,
  on,
  onToggle,
  disabled,
}: {
  prop: SceneSpecProp;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const interactive = prop.interactive && !disabled;
  const style: React.CSSProperties = {
    left: `${prop.x}%`,
    top: `${prop.y}%`,
    width: `${prop.size}%`,
    aspectRatio: String(PROP_ASPECT[prop.kind]),
    // Feet on the spot, like a person standing on it.
    transform: "translate(-50%, -100%)",
    // Under anyone standing in front of it, over anyone behind it.
    zIndex: Math.round(prop.y * 10) - 1,
  };

  const art = <Art kind={prop.kind} on={on} />;
  if (!interactive) {
    return (
      <div className="pointer-events-none absolute" style={style}>
        {art}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={on}
      aria-label={`${on ? "Turn off" : "Turn on"} the ${prop.kind}`}
      className={cn(
        "absolute cursor-pointer rounded-md outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-white/70 active:scale-95",
      )}
      style={style}
    >
      {art}
    </button>
  );
}

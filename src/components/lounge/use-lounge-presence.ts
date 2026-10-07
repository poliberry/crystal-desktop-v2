"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RoomEvent, type Room, type RemoteParticipant } from "livekit-client";

import type { ResolvedScene } from "@/lib/lounge-scenes";

/**
 * Who is standing where in a lounge.
 *
 * Positions travel between the people in the room as small LiveKit data
 * packets, not through the database: they change ten times a second and mean
 * nothing a moment later. A packet is `{x, y, s}` — percentages of the scene,
 * and the seat index if sitting — sent unreliably while moving (a lost one is
 * replaced by the next) and reliably when stopping, when someone arrives, and
 * every few seconds as a heartbeat, so a latecomer is never left looking at an
 * empty room.
 */

export const POSITION_TOPIC = "lounge:pos";
export const TYPING_TOPIC = "lounge:typing";

export interface Spot {
  x: number;
  y: number;
  /** The seat sat in, if any. */
  seat: number | null;
}

/** Walking speed, in percent of the scene's width per second. */
const SPEED = 26;
const SEND_EVERY_MS = 90;
const HEARTBEAT_MS = 4000;
const X_MIN = 5;
const X_MAX = 95;
const Y_MAX = 95;
/** The scene is wider than it is tall; a percent of its height is shorter than
 * a percent of its width, so vertical distances are scaled to walk evenly. */
const ASPECT = 90 / 160;

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

/** Somewhere for somebody to stand until we hear where they are: spread over
 * the floor by who they are, so a room full of newcomers isn't one pile. */
export function defaultSpot(identity: string, scene: ResolvedScene): Spot {
  let hash = 0;
  for (let i = 0; i < identity.length; i++) hash = (hash * 31 + identity.charCodeAt(i)) >>> 0;
  const yMin = scene.floorTop + 8;
  return {
    x: 14 + (hash % 1000) / 1000 * 72,
    y: yMin + (((hash >>> 10) % 1000) / 1000) * (Y_MAX - yMin - 4),
    seat: null,
  };
}

export function useLoungePresence(room: Room, scene: ResolvedScene, enabled: boolean) {
  const yMin = scene.floorTop + 7;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  const me = room.localParticipant.identity;
  const [spots, setSpots] = useState<Map<string, Spot>>(() => new Map());
  const [typing, setTyping] = useState<Set<string>>(() => new Set());
  const [walking, setWalking] = useState<Set<string>>(() => new Set());

  const local = useRef<Spot>(defaultSpot(me, scene));
  const target = useRef<{ x: number; y: number } | null>(null);
  const keys = useRef(new Set<string>());
  const lastSent = useRef({ x: -1, y: -1, seat: -2 as number | null, at: 0 });
  const walkTimers = useRef(new Map<string, number>());
  const typingTimers = useRef(new Map<string, number>());

  const publish = useCallback(
    (reliable: boolean, to?: string) => {
      const s = local.current;
      void room.localParticipant
        .publishData(encode({ x: +s.x.toFixed(2), y: +s.y.toFixed(2), s: s.seat }), {
          reliable,
          topic: POSITION_TOPIC,
          ...(to ? { destinationIdentities: [to] } : {}),
        })
        .catch(() => {});
      lastSent.current = { x: s.x, y: s.y, seat: s.seat, at: performance.now() };
    },
    [room],
  );

  // The local avatar is part of the same map, so everything is drawn the same way.
  const commitLocal = useCallback(() => {
    setSpots((prev) => {
      const next = new Map(prev);
      next.set(me, { ...local.current });
      return next;
    });
  }, [me]);

  /** Walk somewhere on the floor. */
  const walkTo = useCallback(
    (x: number, y: number) => {
      local.current = { ...local.current, seat: null };
      target.current = {
        x: Math.min(X_MAX, Math.max(X_MIN, x)),
        y: Math.min(Y_MAX, Math.max(sceneRef.current.floorTop + 7, y)),
      };
    },
    [],
  );

  /** Go and sit. */
  const sitAt = useCallback(
    (index: number) => {
      const seat = sceneRef.current.seats[index];
      if (!seat) return;
      target.current = null;
      local.current = { x: seat.x, y: seat.y, seat: index };
      commitLocal();
      publish(true);
    },
    [commitLocal, publish],
  );

  const sendTyping = useCallback(
    (on: boolean) => {
      void room.localParticipant
        .publishData(encode({ on }), { reliable: false, topic: TYPING_TOPIC })
        .catch(() => {});
    },
    [room],
  );

  // --- the walking loop ---------------------------------------------------------------
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let last = performance.now();
    let wasMoving = false;

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = local.current;
      let dx = 0;
      let dy = 0;

      if (keys.current.size > 0) {
        if (keys.current.has("left")) dx -= 1;
        if (keys.current.has("right")) dx += 1;
        if (keys.current.has("up")) dy -= 1;
        if (keys.current.has("down")) dy += 1;
        if (dx || dy) target.current = null;
      }
      if (!dx && !dy && target.current) {
        const vx = target.current.x - s.x;
        const vy = (target.current.y - s.y) / ASPECT;
        const dist = Math.hypot(vx, vy);
        if (dist < 0.4) {
          local.current = { ...s, x: target.current.x, y: target.current.y };
          target.current = null;
        } else {
          dx = vx / dist;
          dy = vy / dist;
        }
      }

      const moving = !!(dx || dy);
      if (moving) {
        const len = Math.hypot(dx, dy) || 1;
        local.current = {
          seat: null,
          x: Math.min(X_MAX, Math.max(X_MIN, s.x + (dx / len) * SPEED * dt)),
          y: Math.min(Y_MAX, Math.max(yMin, s.y + ((dy / len) * SPEED * dt) * ASPECT)),
        };
        commitLocal();
        if (now - lastSent.current.at > SEND_EVERY_MS) publish(false);
      } else if (wasMoving) {
        commitLocal();
        publish(true);
      }
      if (moving !== wasMoving) {
        wasMoving = moving;
        setWalking((prev) => {
          const next = new Set(prev);
          if (moving) next.add(me);
          else next.delete(me);
          return next;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, yMin, me, commitLocal, publish]);

  // --- keyboard ------------------------------------------------------------------------
  useEffect(() => {
    if (!enabled) return;
    const map: Record<string, string> = {
      ArrowLeft: "left", a: "left", A: "left",
      ArrowRight: "right", d: "right", D: "right",
      ArrowUp: "up", w: "up", W: "up",
      ArrowDown: "down", s: "down", S: "down",
    };
    const typingInField = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      const key = map[e.key];
      if (!key || typingInField(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      keys.current.add(key);
    };
    const up = (e: KeyboardEvent) => {
      const key = map[e.key];
      if (key) keys.current.delete(key);
    };
    const clear = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, [enabled]);

  // --- hearing about everyone else ---------------------------------------------------------
  useEffect(() => {
    if (!enabled) return;
    commitLocal();
    publish(true);

    const markWalking = (identity: string) => {
      setWalking((prev) => (prev.has(identity) ? prev : new Set(prev).add(identity)));
      window.clearTimeout(walkTimers.current.get(identity));
      walkTimers.current.set(
        identity,
        window.setTimeout(() => {
          setWalking((prev) => {
            if (!prev.has(identity)) return prev;
            const next = new Set(prev);
            next.delete(identity);
            return next;
          });
        }, 350),
      );
    };

    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (!participant) return;
      if (topic === POSITION_TOPIC) {
        try {
          const p = JSON.parse(new TextDecoder().decode(payload)) as { x?: number; y?: number; s?: number | null };
          if (typeof p.x !== "number" || typeof p.y !== "number") return;
          const spot: Spot = {
            // Clamped on arrival: a packet is just a number from somebody else's
            // machine and shouldn't be able to put an avatar outside the room.
            x: Math.min(100, Math.max(0, p.x)),
            y: Math.min(100, Math.max(0, p.y)),
            seat: typeof p.s === "number" ? p.s : null,
          };
          setSpots((prev) => {
            const before = prev.get(participant.identity);
            if (before && before.x !== spot.x || before && before.y !== spot.y) markWalking(participant.identity);
            const next = new Map(prev);
            next.set(participant.identity, spot);
            return next;
          });
        } catch {
          /* malformed */
        }
      } else if (topic === TYPING_TOPIC) {
        try {
          const { on } = JSON.parse(new TextDecoder().decode(payload)) as { on?: boolean };
          window.clearTimeout(typingTimers.current.get(participant.identity));
          setTyping((prev) => {
            const next = new Set(prev);
            if (on) next.add(participant.identity);
            else next.delete(participant.identity);
            return next;
          });
          // Typing that is never turned off (they closed the app) stops by itself.
          if (on) {
            typingTimers.current.set(
              participant.identity,
              window.setTimeout(() => {
                setTyping((prev) => {
                  const next = new Set(prev);
                  next.delete(participant.identity);
                  return next;
                });
              }, 6000),
            );
          }
        } catch {
          /* malformed */
        }
      }
    };

    // Somebody arrived: tell them where we are, at once.
    const onJoined = (participant: RemoteParticipant) => publish(true, participant.identity);
    const onLeft = (participant: RemoteParticipant) => {
      setSpots((prev) => {
        if (!prev.has(participant.identity)) return prev;
        const next = new Map(prev);
        next.delete(participant.identity);
        return next;
      });
    };

    room.on(RoomEvent.DataReceived, onData);
    room.on(RoomEvent.ParticipantConnected, onJoined);
    room.on(RoomEvent.ParticipantDisconnected, onLeft);
    const heartbeat = window.setInterval(() => publish(true), HEARTBEAT_MS);
    const timers = walkTimers.current;
    const typers = typingTimers.current;
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      room.off(RoomEvent.ParticipantConnected, onJoined);
      room.off(RoomEvent.ParticipantDisconnected, onLeft);
      window.clearInterval(heartbeat);
      timers.forEach((t) => window.clearTimeout(t));
      typers.forEach((t) => window.clearTimeout(t));
    };
  }, [enabled, room, commitLocal, publish]);

  return useMemo(
    () => ({ spots, typing, walking, walkTo, sitAt, sendTyping, localIdentity: me }),
    [spots, typing, walking, walkTo, sitAt, sendTyping, me],
  );
}

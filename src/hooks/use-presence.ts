"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect } from "react";

import { api } from "../../convex/_generated/api";
import { getDeviceId } from "@/lib/device-id";
import { displayStatus, type ManualStatus } from "@/lib/presence";
import type { RichPresenceActivity } from "@/types/desktop-api";

const IDLE_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const ACTIVITY_EVENTS = ["mousemove", "keydown", "mousedown", "touchstart", "scroll"] as const;

/**
 * Beats for *this device*, identified by a stable id.
 *
 * The id is what lets the backend keep a phone and a desktop apart: closing
 * one no longer decides the user's status on its own, only the loss of the
 * last live device does (see `reconcile` in convex/presence.ts).
 */
export function usePresenceHeartbeat() {
  const heartbeat = useMutation(api.presence.heartbeat);
  const endSession = useMutation(api.presence.endSession);

  useEffect(() => {
    const deviceId = getDeviceId();
    const isIdleRef = { current: false };
    let lastActivityAt = Date.now();

    const beat = (isIdle: boolean) =>
      void heartbeat({ isIdle, deviceId, platform: "desktop" });

    const markActive = () => {
      lastActivityAt = Date.now();
      if (isIdleRef.current) {
        isIdleRef.current = false;
        beat(false);
      }
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActive, { passive: true });
    }
    markActive();

    // Activity events such as mousemove and scroll fire many times per second.
    // Re-arming a five-minute timeout for each one needlessly allocates and
    // wakes the renderer during normal use. The heartbeat already runs every
    // 20 seconds, which is plenty of precision for presence and gives us one
    // stable place to advance the idle state.
    const tick = () => {
      const idle = Date.now() - lastActivityAt >= IDLE_MS;
      isIdleRef.current = idle;
      beat(idle);
    };
    tick();
    const interval = setInterval(tick, HEARTBEAT_INTERVAL_MS);

    // Quitting reports itself rather than waiting to be swept, so someone who
    // closes the desktop app drops offline immediately instead of a minute
    // later. Best effort — a hard kill still falls back to the sweep.
    const onUnload = () => void endSession({ deviceId });
    window.addEventListener("beforeunload", onUnload);

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActive);
      }
      window.removeEventListener("beforeunload", onUnload);
      clearInterval(interval);
    };
  }, [heartbeat, endSession]);
}

export function useMyPresence() {
  const presence = useQuery(api.presence.getMine);
  if (!presence) {
    return {
      status: "online" as const,
      manualStatus: "online" as const,
      activities: [] as RichPresenceActivity[],
      loaded: presence !== undefined,
    };
  }
  return {
    status: displayStatus(presence.manualStatus, presence.isIdle),
    // The raw manual choice, distinct from `status` — `status` collapses to
    // "idle" from real inactivity too, which the status switcher shouldn't
    // show as selected unless the user actually picked "Idle" themselves.
    manualStatus: presence.manualStatus,
    /** Everything this client is currently broadcasting, richest first. */
    activities: ((presence.activities as RichPresenceActivity[] | undefined)?.length
      ? (presence.activities as RichPresenceActivity[])
      : presence.activity
        ? [presence.activity as RichPresenceActivity]
        : []) as RichPresenceActivity[],
    loaded: true,
  };
}

export function useSetPresenceStatus() {
  const setStatus = useMutation(api.presence.setStatus);
  return (manualStatus: ManualStatus) => void setStatus({ manualStatus });
}

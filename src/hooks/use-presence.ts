"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect } from "react";

import { api } from "../../convex/_generated/api";
import { displayStatus, type ManualStatus } from "@/lib/presence";

const IDLE_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const ACTIVITY_EVENTS = ["mousemove", "keydown", "mousedown", "touchstart", "scroll"] as const;

export function usePresenceHeartbeat() {
  const heartbeat = useMutation(api.presence.heartbeat);

  useEffect(() => {
    const isIdleRef = { current: false };
    let idleTimer: ReturnType<typeof setTimeout>;

    const markActive = () => {
      if (isIdleRef.current) {
        isIdleRef.current = false;
        void heartbeat({ isIdle: false });
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        isIdleRef.current = true;
        void heartbeat({ isIdle: true });
      }, IDLE_MS);
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActive, { passive: true });
    }
    markActive();

    const interval = setInterval(() => {
      void heartbeat({ isIdle: isIdleRef.current });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActive);
      }
      clearInterval(interval);
      clearTimeout(idleTimer);
    };
  }, [heartbeat]);
}

export function useMyPresence() {
  const presence = useQuery(api.presence.getMine);
  if (!presence) {
    return { status: "online" as const, manualStatus: "online" as const, loaded: presence !== undefined };
  }
  return {
    status: displayStatus(presence.manualStatus, presence.isIdle),
    // The raw manual choice, distinct from `status` — `status` collapses to
    // "idle" from real inactivity too, which the status switcher shouldn't
    // show as selected unless the user actually picked "Idle" themselves.
    manualStatus: presence.manualStatus,
    loaded: true,
  };
}

export function useSetPresenceStatus() {
  const setStatus = useMutation(api.presence.setStatus);
  return (manualStatus: ManualStatus) => void setStatus({ manualStatus });
}

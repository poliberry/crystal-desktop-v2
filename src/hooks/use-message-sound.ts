"use client";

import { useQuery } from "convex/react";
import { useEffect, useRef } from "react";

import { api } from "../../convex/_generated/api";
import { useAudioPreferences } from "@/components/audio-provider";

/**
 * Plays the message chime when a new notification arrives.
 *
 * Watches only the newest notification's id, so an incoming message is one
 * small subscription update rather than a re-fetch of the whole feed. The
 * first value seen is treated as already-known — otherwise every app launch
 * would chime for whatever happened to be at the top.
 */
export function useMessageSound(): void {
  const latest = useQuery(api.notifications.latest);
  const { playCue } = useAudioPreferences();
  const lastSeen = useRef<string | null>(null);
  const primed = useRef(false);

  useEffect(() => {
    if (latest === undefined) return;

    if (!primed.current) {
      primed.current = true;
      lastSeen.current = latest?.id ?? null;
      return;
    }

    if (!latest || latest.id === lastSeen.current) return;
    lastSeen.current = latest.id;
    playCue("message");
  }, [latest, playCue]);
}

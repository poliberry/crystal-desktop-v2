"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useAudioPreferences } from "@/components/audio-provider";
import { getDesktopAPI } from "@/lib/desktop";
import { getDeviceId } from "@/lib/device-id";
import type { RichPresenceActivity } from "@/types/desktop-api";

/**
 * Mirrors whatever the Electron layer detects (a running game, an activity
 * pushed over the Discord-compatible IPC socket, or now-playing music) into
 * this user's Convex presence row, so everyone else's profile cards can show
 * it. Renders nothing; mounted once per session by `SessionBootstrap`.
 *
 * A plain browser build has no desktop layer, so this is a no-op there.
 */
export function useRichPresenceReporter(): void {
  const setActivities = useMutation(api.presence.setActivities);
  const { richPresenceEnabled } = useAudioPreferences();

  useEffect(() => {
    const desktop = getDesktopAPI()?.richPresence;
    if (!desktop) return;

    let cancelled = false;
    const publish = (activities: RichPresenceActivity[]) => {
      if (cancelled) return;
      void setActivities({ activities: activities.map(toPayload), deviceId: getDeviceId() }).catch(() => {});
    };

    // Keep the main process in step with the setting, so it stops scanning
    // (and stops holding the IPC socket's activities) when turned off.
    void desktop.setEnabled(richPresenceEnabled).catch(() => {});

    if (!richPresenceEnabled) {
      publish([]);
      return () => {
        cancelled = true;
      };
    }

    // Pick up whatever was already detected before this mounted — the main
    // process starts scanning at launch, well before sign-in completes.
    let latest: RichPresenceActivity[] = [];
    const remember = (activities: RichPresenceActivity[]) => {
      latest = activities;
      publish(activities);
    };
    void desktop.get().then(remember).catch(() => {});
    const unsubscribe = desktop.onChange(remember);

    // Say it again now and then. The server keeps each device's list apart and merges them, so a device
    // that stops reporting is dropped from the merge; this keeps a long-running game or song on the card
    // across a server update or a missed write. An unchanged list costs the server nothing.
    const refresh = setInterval(() => {
      if (latest.length > 0) publish(latest);
    }, 60_000);

    return () => {
      cancelled = true;
      clearInterval(refresh);
      unsubscribe();
    };
  }, [richPresenceEnabled, setActivities]);

  // Retract the activity when the window goes away, so a profile card doesn't
  // keep advertising a game for a client that's gone. (`sweepStale` covers a
  // hard crash, but this makes a clean exit immediate.)
  useEffect(() => {
    const onUnload = () => {
      void setActivities({ activities: [], deviceId: getDeviceId() }).catch(() => {});
    };
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, [setActivities]);
}

/**
 * Strip the fields Convex owns and roll the playback position forward to
 * "now". `positionSampledAt` is on this machine's clock, so the *difference*
 * is skew-free; Convex then stamps its own clock as the anchor viewers
 * interpolate from.
 */
function toPayload(activity: RichPresenceActivity) {
  const { positionSampledAt, positionUpdatedAt: _stored, positionMs, ...rest } = activity;
  if (positionMs === undefined) return { ...rest };
  const elapsed = positionSampledAt ? Math.max(0, Date.now() - positionSampledAt) : 0;
  const advanced = positionMs + elapsed;
  return {
    ...rest,
    positionMs: rest.durationMs ? Math.min(advanced, rest.durationMs) : advanced,
  };
}

/** Everything a given user is currently broadcasting, richest first. */
export function useUserActivities(userId: Id<"users"> | undefined): RichPresenceActivity[] {
  const presence = useQuery(api.presence.getUserPresence, userId ? { userId } : "skip");
  // Screen sharing is an activity as far as a profile card is concerned; it
  // just doesn't arrive through the Rich Presence pipeline, because it's
  // something the app knows about itself rather than something it detected.
  const stream = useQuery(api.presence.streamOf, userId ? { userId } : "skip");

  // Already resolved by the query: the user's own custom activity folded in
  // ahead of anything detected, the pre-list `activity` field folded in for
  // older rows, and nothing at all for somebody offline.
  const reported = (presence?.activities ?? []) as RichPresenceActivity[];

  return useMemo(() => {
    if (!stream) return reported;
    // First: a live stream is the most immediate thing anyone is doing, and it's
    // the one with something to click.
    return [
      {
        type: "streaming",
        name: stream.where,
        details: stream.context ?? undefined,
        imageUrl: stream.thumbnailUrl,
      },
      ...reported,
    ];
  }, [reported, stream]);
}

/** Diagnostics for the Settings panel — detectable count, IPC socket path. */
export function useRichPresenceStatus() {
  const [status, setStatus] = useState<{
    enabled: boolean;
    detectableCount: number;
    ipcPath: string | null;
    ipcClients: number;
  } | null>(null);


  useEffect(() => {
    const desktop = getDesktopAPI()?.richPresence;
    if (!desktop) return;
    let cancelled = false;

    const refresh = () => {
      void desktop
        .status()
        .then((next) => {
          if (!cancelled) setStatus(next);
        })
        .catch(() => {});
    };

    refresh();
    // The catalog downloads asynchronously at launch and games connect to the
    // IPC socket at any time, so poll rather than snapshotting once.
    const interval = setInterval(refresh, 5_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return status;
}

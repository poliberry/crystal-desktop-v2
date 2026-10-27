"use client";

import { ConnectionQuality, ConnectionState, RoomEvent, Track, type Room } from "livekit-client";
import { useEffect, useRef, useState } from "react";

/**
 * How the call is actually going, sampled once a second.
 *
 * Two different questions, answered from two different places. *Is it good* is
 * LiveKit's own `ConnectionQuality`, which the server computes from what it can
 * see of the whole session and is a better judge than anything derived here.
 * *Why* is WebRTC's statistics — round trip time and packet loss — which is
 * what somebody staring at a stuttering call actually wants to see, and what
 * makes the difference between "my connection is bad" and "theirs is".
 *
 * Sampled rather than subscribed because that is what the underlying API is: a
 * cumulative counter you read and difference. A second is Discord's interval
 * too, and it is slow enough to be free and fast enough that a graph of it
 * shows a hiccup.
 */

/** One reading. `null` where the call was up but the browser had nothing to
 * report yet — a track that has just been published has no round trip time. */
export interface CallStatsSample {
  at: number;
  pingMs: number | null;
  /** 0–1, over the last interval rather than the whole call: a call that has
   * been up for an hour should show the trouble it is having *now*. */
  lossRate: number | null;
}

/**
 * Good, fair or poor — the three states worth colouring, and the only
 * distinction anybody acts on.
 *
 * `unknown` is its own state rather than an optimistic "good": the moment
 * before the first sample lands is not a claim about the connection, and
 * painting it green would be one.
 */
export type ConnectionGrade = "good" | "fair" | "poor" | "unknown";

export interface CallStats {
  grade: ConnectionGrade;
  /** Newest last, oldest first. */
  samples: CallStatsSample[];
  pingMs: number | null;
  lossRate: number | null;
  /** Which LiveKit node the call is on, when the server said. Discord shows
   * this and it is the one thing a support conversation always asks for. */
  server: string | null;
}

/** Two minutes at a sample a second — the width of the graph, and as far back
 * as "how is it going" means. Exported because the graph draws exactly this
 * window whether or not it has filled up yet. */
export const STATS_HISTORY = 120;

const SAMPLE_MS = 1000;

/**
 * Where fair becomes poor.
 *
 * Not invented: 250ms is the point at which conversation stops overlapping
 * naturally and people start talking over each other, and 10% loss is where
 * speech audibly breaks up rather than merely thinning. Both are the numbers
 * Discord quotes in the same panel, which also makes the advice transferable.
 */
const PING_POOR_MS = 250;
const PING_FAIR_MS = 120;
const LOSS_POOR = 0.1;
const LOSS_FAIR = 0.02;

const EMPTY: CallStats = {
  grade: "unknown",
  samples: [],
  pingMs: null,
  lossRate: null,
  server: null,
};

export function useCallStats(room: Room | null, active: boolean): CallStats {
  const [stats, setStats] = useState<CallStats>(EMPTY);
  /** The counters as of the last sample. Packet totals are cumulative for the
   * life of the connection, so a rate needs the previous reading. */
  const previous = useRef<{ sent: number; lost: number } | null>(null);

  useEffect(() => {
    if (!room || !active) {
      previous.current = null;
      setStats(EMPTY);
      return;
    }

    let cancelled = false;

    const grade = (pingMs: number | null, lossRate: number | null): ConnectionGrade => {
      // LiveKit's own verdict first, since it sees things this side can't —
      // a participant whose connection has dropped entirely reports `Lost`
      // while the local statistics still look fine.
      const quality = room.localParticipant.connectionQuality;
      if (quality === ConnectionQuality.Lost || quality === ConnectionQuality.Poor) {
        return "poor";
      }
      if (pingMs === null && lossRate === null) {
        return quality === ConnectionQuality.Excellent || quality === ConnectionQuality.Good
          ? "good"
          : "unknown";
      }
      if ((pingMs ?? 0) >= PING_POOR_MS || (lossRate ?? 0) >= LOSS_POOR) return "poor";
      if ((pingMs ?? 0) >= PING_FAIR_MS || (lossRate ?? 0) >= LOSS_FAIR) return "fair";
      return "good";
    };

    const sample = async () => {
      if (room.state !== ConnectionState.Connected) return;

      const report = await readOutboundStats(room);
      if (cancelled) return;

      let lossRate: number | null = null;
      if (report && previous.current) {
        const sent = report.packetsSent - previous.current.sent;
        const lost = report.packetsLost - previous.current.lost;
        // A negative delta means the counters restarted underneath us (a
        // reconnect republishes the track); a zero one means nothing was sent,
        // which is silence rather than loss.
        if (sent > 0 && lost >= 0) lossRate = Math.min(1, lost / (sent + lost));
      }
      previous.current = report
        ? { sent: report.packetsSent, lost: report.packetsLost }
        : null;

      const pingMs = report?.rttMs ?? null;
      const at = Date.now();

      setStats((current) => ({
        grade: grade(pingMs, lossRate),
        samples: [...current.samples, { at, pingMs, lossRate }].slice(-STATS_HISTORY),
        pingMs,
        lossRate,
        server: serverLabel(room),
      }));
    };

    void sample();
    const interval = setInterval(() => void sample(), SAMPLE_MS);

    // A quality change is worth repainting for immediately — it is the one
    // input that doesn't come from the poll, and "poor" arriving a second late
    // is a second of green on a call that has already broken up.
    const onQuality = () => void sample();
    room.on(RoomEvent.ConnectionQualityChanged, onQuality);

    return () => {
      cancelled = true;
      clearInterval(interval);
      room.off(RoomEvent.ConnectionQualityChanged, onQuality);
    };
  }, [room, active]);

  return stats;
}

/** Which node the call is on. Region and id where the server reports both,
 * since a region alone is not enough to look anything up. */
function serverLabel(room: Room): string | null {
  const info = room.serverInfo;
  if (!info) return null;
  const parts = [info.region, info.nodeId].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Round trip time and packet counters for the microphone we are sending.
 *
 * The outbound side, deliberately: it is the half of the call this machine is
 * responsible for, and the half somebody can do something about. `packetsLost`
 * comes from the *remote* inbound report — the far end telling us what it
 * didn't receive — which is why both halves of one direction have to be read
 * from two different entries.
 */
async function readOutboundStats(
  room: Room
): Promise<{ rttMs: number | null; packetsSent: number; packetsLost: number } | null> {
  const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
  const track = publication?.track;
  if (!track) return null;

  const report = await track.getRTCStatsReport().catch(() => undefined);
  if (!report) return null;

  let rttMs: number | null = null;
  let packetsSent = 0;
  let packetsLost = 0;

  report.forEach((entry) => {
    const stat = entry as Record<string, unknown> & { type: string };
    if (stat.type === "outbound-rtp" && typeof stat.packetsSent === "number") {
      packetsSent += stat.packetsSent;
    }
    if (stat.type === "remote-inbound-rtp") {
      if (typeof stat.packetsLost === "number") packetsLost += Math.max(0, stat.packetsLost);
      if (typeof stat.roundTripTime === "number") {
        rttMs = Math.round(stat.roundTripTime * 1000);
      }
    }
  });

  return { rttMs, packetsSent, packetsLost };
}

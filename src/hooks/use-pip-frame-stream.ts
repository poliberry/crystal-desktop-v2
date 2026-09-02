"use client";

import { useEffect, useRef, useState } from "react";
import { ParticipantEvent, Track, type Participant } from "livekit-client";

/** How often (ms) to capture and stream a frame to the pop-out window. 8fps
 * is enough for a small pop-out preview; 12fps + 0.85 quality was ~1.2 MB/s
 * of JPEG data URLs over IPC → GC pressure + RSS creep. */
const FRAME_INTERVAL_MS = 1000 / 8;

/** Hard ceiling regardless of how big the user resizes the pop-out window to
 * (e.g. maximized on a large display) — 1280 covers a maximized pip on 1080p
 * without capturing full-HD and then JPEG-encoding it 8×/s. */
const MAX_CAPTURE_WIDTH = 1280;

/**
 * Feed the pop-out window (`src/app/pip/page.tsx`) with frames of a
 * participant's video.
 *
 * That window has no LiveKit connection of its own — a second one would show
 * up as a duplicate, silent participant to everyone else in the call — so it's
 * a passive frame sink, and something in the main window has to keep drawing
 * for it. This is that: an off-screen `<video>` attached to the same underlying
 * track (tracks support multiple simultaneous attachments, so this doesn't
 * disturb whatever tile is also showing it), captured to a canvas at the
 * window's own live size.
 *
 * Extracted from the focused call tile so the mini player can pop a stream out
 * too, and so both go through one capture loop instead of two racing each other
 * to send frames.
 */
export function usePipFrameStream({
  participant,
  kind,
  enabled,
  size,
  sendFrame,
}: {
  participant: Participant | null;
  /** Which of the participant's tracks to capture. */
  kind: "screen" | "camera";
  enabled: boolean;
  /** The pop-out window's current content size, so frames match it instead of
   * being upscaled from a fixed guess. */
  size: { width: number; height: number };
  sendFrame: (dataUrl: string) => void;
}): void {
  // Read inside the capture loop, which must not be torn down and rebuilt
  // every time the user nudges the window's edge.
  const sizeRef = useRef(size);
  sizeRef.current = size;

  // The track being captured may not be published yet — popping out the
  // instant a share starts is exactly when it isn't. Re-resolving on the
  // participant's own track events is what turns that into a late start
  // rather than a permanently blank pop-out.
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled || !participant) return;
    const bump = () => setRevision((n) => n + 1);
    participant
      .on(ParticipantEvent.TrackSubscribed, bump)
      .on(ParticipantEvent.TrackPublished, bump)
      .on(ParticipantEvent.TrackUnmuted, bump)
      .on(ParticipantEvent.LocalTrackPublished, bump);
    return () => {
      participant
        .off(ParticipantEvent.TrackSubscribed, bump)
        .off(ParticipantEvent.TrackPublished, bump)
        .off(ParticipantEvent.TrackUnmuted, bump)
        .off(ParticipantEvent.LocalTrackPublished, bump);
    };
  }, [enabled, participant]);

  useEffect(() => {
    if (!enabled || !participant) return;

    const source = kind === "screen" ? Track.Source.ScreenShare : Track.Source.Camera;
    const track = participant.getTrackPublication(source)?.track;
    if (!track) return;

    const offscreen = document.createElement("video");
    offscreen.autoplay = true;
    offscreen.muted = true;
    offscreen.playsInline = true;
    Object.assign(offscreen.style, {
      position: "fixed",
      width: "1px",
      height: "1px",
      opacity: "0",
      pointerEvents: "none",
      top: "0",
      left: "0",
    });
    document.body.appendChild(offscreen);
    track.attach(offscreen);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    let rafId: number;
    let lastSent = 0;

    const loop = (t: number) => {
      rafId = requestAnimationFrame(loop);
      if (!ctx || t - lastSent < FRAME_INTERVAL_MS) return;
      if (offscreen.readyState < 2 || !offscreen.videoWidth) return;
      lastSent = t;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.min(MAX_CAPTURE_WIDTH, Math.round(sizeRef.current.width * dpr));
      // Never upscale past the source video's own resolution — pointless, and
      // it just makes the JPEG bigger for no visible gain.
      const w = Math.min(targetW, offscreen.videoWidth);
      const h = Math.round(w * (offscreen.videoHeight / offscreen.videoWidth));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(offscreen, 0, 0, w, h);
      // Visibility pause: if the main window is occluded/minimized, skip
      // frames entirely rather than encoding JPEGs nobody sees.
      if (typeof document !== "undefined" && document.hidden) return;
      sendFrame(canvas.toDataURL("image/jpeg", 0.6));
    };
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      track.detach(offscreen);
      offscreen.remove();
    };
  }, [enabled, participant, kind, sendFrame, revision]);
}

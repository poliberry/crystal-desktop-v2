"use client";

import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { Track, type Room } from "livekit-client";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { uploadToStorage } from "@/lib/storage-upload";

/**
 * How often to publish a fresh still. Slow on purpose: this exists so someone
 * outside the call can see roughly what's on, not to be a second video feed.
 */
const INTERVAL_MS = 15_000;

/** Wide enough to make out a window, small enough to be a cheap upload. */
const WIDTH = 480;

/**
 * Publishes periodic stills of my own screen share, so people who haven't
 * joined the call can see what's on it.
 *
 * The stream itself can't be sampled by anyone who hasn't subscribed to it —
 * that's the whole cost this avoids — so the frame has to come from the
 * sharer's own client. Runs only while actually sharing, and clears the
 * published still on the way out so nothing claims to be live that isn't.
 */
export function useStreamThumbnail(
  room: Room,
  channelId: Id<"channels"> | null,
  sharing: boolean
): void {
  const generateUploadUrl = useMutation(api.channels.generateStreamThumbnailUploadUrl);
  const setThumbnail = useMutation(api.channels.setStreamThumbnail);
  const clearThumbnail = useMutation(api.channels.clearStreamThumbnail);

  // So the interval body always sees the current mutations without being
  // rebuilt (and restarting the timer) on every render.
  const publish = useRef<() => Promise<void>>(async () => {});

  publish.current = async () => {
    if (!channelId) return;
    const track = room.localParticipant
      ?.getTrackPublication(Track.Source.ScreenShare)
      ?.track?.mediaStreamTrack;
    if (!track) return;

    try {
      // ImageCapture would be tidier but isn't available for every track
      // source; drawing the live element's frame works everywhere.
      const video = document.createElement("video");
      video.srcObject = new MediaStream([track]);
      video.muted = true;
      await video.play();
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const height = Math.round((video.videoHeight / video.videoWidth) * WIDTH) || WIDTH;
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, WIDTH, height);
      video.pause();
      video.srcObject = null;

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.6)
      );
      if (!blob) return;

      const storageId = (await uploadToStorage(
        await generateUploadUrl(),
        blob
      )) as Id<"_storage">;
      await setThumbnail({ channelId, storageId });
    } catch {
      // A frame that can't be grabbed or uploaded is not worth reporting —
      // the card falls back to the streamer's avatar.
    }
  };

  useEffect(() => {
    if (!sharing || !channelId) return;
    // One straight away so the card isn't blank for the first interval.
    void publish.current();
    const timer = setInterval(() => void publish.current(), INTERVAL_MS);
    return () => {
      clearInterval(timer);
      void clearThumbnail({ channelId }).catch(() => {});
    };
  }, [sharing, channelId, clearThumbnail]);
}

"use client";

import { useEffect, useState } from "react";

/** Whether a camera/microphone is actually present, so toggle buttons can be
 * disabled with a clear reason instead of silently failing when clicked. */
export function useMediaDeviceAvailability() {
  const [hasCamera, setHasCamera] = useState(true);
  const [hasMicrophone, setHasMicrophone] = useState(true);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;

    const check = () => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          if (cancelled) return;
          setHasCamera(devices.some((d) => d.kind === "videoinput"));
          setHasMicrophone(devices.some((d) => d.kind === "audioinput"));
        })
        .catch(() => {
          // Can't enumerate (e.g. permission not granted yet) — assume
          // available so the real toggle surfaces the actual error instead
          // of us guessing a device away that might exist.
        });
    };

    check();
    navigator.mediaDevices.addEventListener("devicechange", check);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", check);
    };
  }, []);

  return { hasCamera, hasMicrophone };
}

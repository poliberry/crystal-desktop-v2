"use client";

import { useEffect, useState } from "react";

/**
 * `navigator.onLine`, as a hook.
 *
 * Only a coarse signal — the browser reports "online" the moment there's a
 * route to *something*, which isn't the same as being able to reach Convex.
 * The outbox flush driver pairs this with the Convex socket's own connection
 * state; this is the cheap first gate and the thing that fires an event the
 * instant a laptop's wifi comes back.
 */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}

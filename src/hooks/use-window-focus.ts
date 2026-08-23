"use client";

import { useEffect, useState } from "react";

/**
 * Whether this window currently has focus.
 *
 * Used to tell "the channel is on screen" apart from "the reader is actually
 * looking at it" — a desktop app spends a lot of its life as the background
 * window of someone else's afternoon, and marking things read in that state
 * would quietly lose them.
 */
export function useWindowFocus(): boolean {
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    // Read once on mount rather than trusting the initial `true`: the window
    // may already have been in the background when this mounted.
    setFocused(document.hasFocus());

    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return focused;
}

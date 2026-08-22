"use client";

import { useEffect, useState } from "react";

import { onSoundboardActivity } from "@/lib/soundboard";

/**
 * Identities currently playing a soundboard clip, for the highlight ring on
 * call tiles and voice participant rows — the same affordance as the speaking
 * ring, in a different colour.
 *
 * The lifetime is owned by `beginSoundboardActivity`, which ends it when the
 * clip's playback actually finishes, so the ring lasts exactly as long as the
 * sound rather than for a fixed guess. Overlapping clips from one person are
 * ref-counted there too, so this only ever sees the transitions.
 */
export function useSoundboardActivity(): Set<string> {
  const [active, setActive] = useState<Set<string>>(() => new Set());

  useEffect(
    () =>
      onSoundboardActivity((identity, isActive) => {
        setActive((prev) => {
          if (prev.has(identity) === isActive) return prev;
          const next = new Set(prev);
          if (isActive) next.add(identity);
          else next.delete(identity);
          return next;
        });
      }),
    []
  );

  return active;
}

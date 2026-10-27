"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import { getAvatarColor } from "@/lib/avatar-color";

/**
 * The tint to paint behind an avatar.
 *
 * Prefers the colour cached on the user's profile, which arrives in the same
 * query as the avatar itself and so paints on the first frame. Sampling the
 * image locally is only the fallback for avatars nobody has sampled yet
 * (Clerk-provided pictures, rows from before this was stored) — that's the
 * path that used to make the tile flash, because it can't finish until the
 * image has downloaded and been drawn to a canvas.
 */
export function useAvatarAccent(
  imageUrl: string | undefined,
  stored: string | undefined
): string | null {
  const [sampled, setSampled] = useState<string | null>(null);

  useEffect(() => {
    if (!imageUrl || stored) {
      setSampled(null);
      return;
    }
    let cancelled = false;
    void getAvatarColor(imageUrl).then((colour) => {
      if (!cancelled) setSampled(colour);
    });
    return () => {
      cancelled = true;
    };
  }, [imageUrl, stored]);

  return stored ?? sampled;
}

/**
 * Sample my own avatar once and cache the result on my profile, so everyone
 * else gets the colour with the avatar instead of re-deriving it.
 *
 * Runs from `SessionBootstrap`, which means it also backfills accounts whose
 * avatar predates this and re-samples after an avatar change — `setAvatar`
 * clears the cached colour, which brings us back here.
 */
export function useSyncMyAvatarAccent(): void {
  const me = useQuery(api.users.getCurrentUser);
  const setAvatarAccent = useMutation(api.users.setAvatarAccent);
  // Guards against re-sampling the same picture when the query re-runs for
  // an unrelated reason, including the (common) case of an image too neutral
  // to have an accent, where nothing gets stored to stop us.
  const sampledUrl = useRef<string | null>(null);

  const imageUrl = me?.imageUrl;
  const accent = me?.avatarAccent;

  useEffect(() => {
    if (!imageUrl || accent || sampledUrl.current === imageUrl) return;
    sampledUrl.current = imageUrl;
    void getAvatarColor(imageUrl).then((colour) => {
      if (colour) void setAvatarAccent({ accent: colour, sourceUrl: imageUrl }).catch(() => {});
    });
  }, [imageUrl, accent, setAvatarAccent]);
}

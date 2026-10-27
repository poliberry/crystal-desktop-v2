"use client";

import { useCallback } from "react";

import { useAudioPreferences } from "@/components/audio-provider";

/** What a pointer or key event says about how it was made. */
export type GestureEvent = { type: string; detail: number };

/**
 * Whether this event should join a call, given the "double-click to join" setting.
 *
 * With the setting off any click joins. With it on only a double click does, so a stray single click
 * does nothing. A click with `detail === 0` came from the keyboard (Enter or Space on a button, which
 * never produces a double click), and no event at all is a programmatic join; both always join, or
 * keyboard users could not join anything.
 */
export function joinsOn(doubleClickToJoin: boolean, event?: GestureEvent): boolean {
  if (!doubleClickToJoin || !event) return true;
  if (event.type === "dblclick") return true;
  return event.type === "click" && event.detail === 0;
}

/** Handlers for a button that joins a call: spread the result onto it. */
export function useJoinGesture() {
  const { doubleClickToJoin } = useAudioPreferences();
  return useCallback(
    (join: (event: React.MouseEvent) => void) => ({
      onClick: (e: React.MouseEvent) => {
        if (joinsOn(doubleClickToJoin, e)) join(e);
      },
      onDoubleClick: (e: React.MouseEvent) => {
        if (doubleClickToJoin) join(e);
      },
    }),
    [doubleClickToJoin],
  );
}

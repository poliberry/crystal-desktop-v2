"use client";

import dynamic from "next/dynamic";

/**
 * The call screen and the mini player, loaded when a call is first joined instead of with the app.
 *
 * They pull in the grid, the participant and screen-share tiles, the Lounge scene and the soundboard, none of which
 * matters until somebody is in a call. `CallProvider` calls `preloadCallUi` as a join starts, so the code is arriving
 * while the token is fetched and the room connects, and is there by the time the call screen is first shown.
 */
export const CallStage = dynamic(() => import("@/components/call/call-stage").then((m) => m.CallStage), {
  ssr: false,
});
export const CallPip = dynamic(() => import("@/components/call/call-pip").then((m) => m.CallPip), { ssr: false });

/** Start fetching the call UI. Safe to call repeatedly; the bundler caches the modules. */
export function preloadCallUi(): void {
  void import("@/components/call/call-stage");
  void import("@/components/call/call-pip");
}

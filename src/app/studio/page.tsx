"use client";

import { StudioApp } from "@/studio/shell/studio-app";

/**
 * Crystal Studio — the creator workspace. A route of the same app rather than a
 * separate one, so it has Crystal's account, theme and components for free; the
 * desktop app opens it in its own window (see `createOrFocusStudioWindow`).
 */
export default function StudioPage() {
  return (
    <main className="h-full">
      <StudioApp />
    </main>
  );
}

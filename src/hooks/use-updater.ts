"use client";

import { useEffect, useState } from "react";

import { getDesktopAPI } from "@/lib/desktop";
import type { UpdaterState } from "@/types/desktop-api";

const IDLE_STATE: UpdaterState = {
  phase: "idle",
  currentVersion: "",
  availableVersion: null,
  progressPercent: null,
  error: null,
};

/** Subscribes to the main process's updater state (see electron/updater.ts). */
export function useUpdater() {
  const [state, setState] = useState<UpdaterState>(IDLE_STATE);
  const api = getDesktopAPI()?.updater;

  useEffect(() => {
    if (!api) {
      // Plain browser / Next.js dev server — there's no Electron updater to
      // subscribe to at all. Without this, state.phase stays "idle" forever,
      // which UpdatesTab reads as "haven't checked yet" and permanently
      // disables checking instead of showing the GitHub releases fallback.
      setState((prev) => (prev.phase === "unsupported" ? prev : { ...IDLE_STATE, phase: "unsupported" }));
      return;
    }
    void api.getState().then(setState);
    return api.onStateChange(setState);
  }, [api]);

  return {
    state,
    supported: !!api,
    check: () => api?.check().then(setState),
    download: () => api?.download().then(setState),
    install: () => api?.install(),
    openReleases: () => api?.openReleases(),
  };
}

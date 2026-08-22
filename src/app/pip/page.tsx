"use client";

import { useEffect, useState } from "react";

import { WindowControls } from "@/components/window-controls";
import { getDesktopAPI } from "@/lib/desktop";

/**
 * The pop-out video window's entire UI — a passive frame sink. The main
 * window captures the focused call tile's video to a canvas and streams
 * JPEG frames here over IPC (see `electron/main.ts`'s `pip:*` handlers and
 * `FocusedTileViewport` in `src/components/call/call-grid.tsx`); this just
 * draws whatever it receives. No auth, no Convex/LiveKit — this window
 * never talks to either.
 */
export default function PipPage() {
  const [frame, setFrame] = useState<string | null>(null);

  useEffect(() => {
    return getDesktopAPI()?.pip.onFrame(setFrame);
  }, []);

  return (
    <main className="flex h-full w-full flex-col overflow-hidden bg-black">
      <header
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        className="flex h-8 shrink-0 items-center justify-between border-b border-white/10 bg-black/80 pl-2"
      >
        <span className="truncate text-xs text-white/50">Crystal</span>
        <WindowControls className="border-white/10" />
      </header>

      <div className="relative min-h-0 flex-1">
        {frame ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frame} alt="" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-white/40">
            Waiting for video…
          </div>
        )}
      </div>
    </main>
  );
}

"use client";

import { GlobalSearch } from "@/components/home/global-search";
import { UpdateIndicator } from "@/components/update-indicator";
import { WindowControls } from "@/components/window-controls";

export function TopNav() {
  return (
    <header
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      className="relative flex h-10 shrink-0 items-center justify-between gap-2 border-b bg-accent/40 pl-3 z-[99]"
    >
      <div className="flex flex-1 justify-center">
        <GlobalSearch />
      </div>

      <UpdateIndicator />

      <WindowControls className="ml-1 z-[999] pointer-events-auto" />
    </header>
  );
}

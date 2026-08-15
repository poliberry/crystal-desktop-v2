"use client";

import { GlobalSearch } from "@/components/home/global-search";
import { UpdateIndicator } from "@/components/update-indicator";
import { WindowControls } from "@/components/window-controls";

export function TopNav() {
  return (
    <header
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      className="flex h-10 shrink-0 items-center gap-4 border-b bg-background pl-4"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-mark.png" alt="Crystal" className="size-5 shrink-0" />

      <div className="flex flex-1 justify-center">
        <GlobalSearch />
      </div>

      <UpdateIndicator />

      <WindowControls className="ml-1" />
    </header>
  );
}

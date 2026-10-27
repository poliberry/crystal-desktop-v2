"use client";

import { useEffect, useState } from "react";

import { UpdateIndicator } from "@/components/update-indicator";
import { WindowControls } from "@/components/window-controls";
import { getDesktopAPI } from "@/lib/desktop";

/**
 * Studio's title bar, left to right: the app's icon and the window's title (to the right of the macOS traffic lights, which
 * `inset` leaves room for), the active editor's menus, empty space, the editor's action buttons, and the window controls
 * on Windows and Linux.
 *
 * The bar as a whole is the window's drag region, and only what can be clicked opts out. The menus and the buttons are drawn
 * into `setMenuHost` / `setActionsHost` by whichever editor is open, and are no-drag; everything between them is drag,
 * so almost the whole bar moves the window, not a sliver of it.
 */
/** True in the standalone Crystal Studio application, which has no Crystal window to carry the update badge. Read after
 * mount: the page is exported statically, so what the server renders can't know. */
function useStandalone(): boolean {
  const [standalone, setStandalone] = useState(false);
  useEffect(() => setStandalone(getDesktopAPI()?.appKind === "studio"), []);
  return standalone;
}

export function TitleBar({ title, inset, setMenuHost, setActionsHost, account }: { title: string | null; inset?: number; setMenuHost: (el: HTMLDivElement | null) => void; setActionsHost: (el: HTMLDivElement | null) => void; /** The account button, at the right end before the window controls. */ account?: React.ReactNode }) {
  const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;
  const standalone = useStandalone();
  return (
    <header style={{ WebkitAppRegion: "drag", paddingLeft: inset || undefined } as React.CSSProperties} className="flex h-[30px] shrink-0 items-stretch ai-edge-b bg-[var(--ai-body)]">
      <div className="flex w-10 shrink-0 items-center justify-center">
        {/* Crystal Studio's own icon, not Crystal's. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/studio-icon.png" alt="" aria-hidden draggable={false} className="size-[20px] select-none rounded-[5px]" />
      </div>
      <span className="flex max-w-[28%] min-w-0 shrink items-center pr-3 text-[12px] font-medium text-[var(--ai-text)]" title={title ? `Crystal Studio — ${title}` : "Crystal Studio"}>
        <span className="truncate">{title ?? "Crystal Studio"}</span>
      </span>
      <div ref={setMenuHost} data-title-menus className="flex min-w-0 shrink items-stretch" style={noDrag} />
      <div aria-hidden data-title-drag className="min-w-8 flex-1" />
      <div ref={setActionsHost} data-title-actions className="flex shrink-0 items-stretch" style={noDrag} />
      {standalone && <UpdateIndicator />}
      {account}
      <WindowControls />
    </header>
  );
}

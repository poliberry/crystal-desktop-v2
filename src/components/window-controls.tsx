"use client";

import { Maximize2, Minimize2, Minus, X } from "lucide-react";

import { useWindowControls } from "@/hooks/use-window-controls";
import { cn } from "@/lib/utils";

/** Custom minimize/maximize/close buttons for the frameless window — must
 * sit in a `no-drag` region since the titlebar area around it is draggable. */
export function WindowControls({ className }: { className?: string }) {
  const { supported, maximized, minimize, toggleMaximize, close } = useWindowControls();
  if (!supported) return null;

  return (
    <div
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      className={cn("flex items-center border-l", className)}
    >
      <button
        type="button"
        onClick={minimize}
        aria-label="Minimize"
        className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Minus className="size-4" />
      </button>
      <button
        type="button"
        onClick={toggleMaximize}
        aria-label={maximized ? "Restore" : "Maximize"}
        className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      </button>
      <button
        type="button"
        onClick={close}
        aria-label="Close"
        className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-destructive hover:text-white"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

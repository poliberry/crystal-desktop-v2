"use client";

import { CircleArrowDown, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useUpdater } from "@/hooks/use-updater";

/** Topbar update badge: blue while an update is available/downloading, green once it's ready to install. */
export function UpdateIndicator() {
  const { state, download, install } = useUpdater();

  if (state.phase === "available") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              className="text-blue-500 hover:text-blue-400"
              onClick={() => void download()}
              aria-label={`Download update${state.availableVersion ? ` v${state.availableVersion}` : ""}`}
            >
              <CircleArrowDown className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Update {state.availableVersion ? `v${state.availableVersion} ` : ""}available — click to download
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (state.phase === "downloading") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              className="text-blue-500"
              disabled
            >
              <Loader2 className="size-4 animate-spin" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Downloading update{state.progressPercent != null ? ` — ${state.progressPercent}%` : "…"}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (state.phase === "ready") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              className="text-emerald-500 hover:text-emerald-400"
              onClick={() => install()}
              aria-label={`Restart and install update${state.availableVersion ? ` v${state.availableVersion}` : ""}`}
            >
              <RefreshCw className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Update {state.availableVersion ? `v${state.availableVersion} ` : ""}ready — click to restart and install
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return null;
}

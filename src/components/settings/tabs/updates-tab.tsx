"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useUpdater } from "@/hooks/use-updater";
import type { UpdaterPhase } from "@/types/desktop-api";

const PHASE_LABEL: Record<UpdaterPhase, string> = {
  idle: "Not checked yet",
  checking: "Checking for updates…",
  available: "Update available",
  downloading: "Downloading…",
  ready: "Update ready to install",
  "not-available": "Up to date",
  unsupported: "Not available",
  error: "Something went wrong",
};

export function UpdatesTab() {
  const { state, supported, check, download, install, openReleases } = useUpdater();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Updates</CardTitle>
        <CardDescription>
          Crystal checks GitHub releases for new versions. Each channel updates only from its
          own releases, so a Canary install never pulls a Stable build (or the other way
          round).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Current version</span>
          <span className="font-medium">{state.currentVersion || "—"}</span>
        </div>

        {/* Only the main process knows the channel — in a plain browser the
            label is empty and this row is left out rather than guessed at. */}
        {state.channelLabel && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Channel</span>
            <span className="font-medium">{state.channelLabel}</span>
          </div>
        )}

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Status</span>
          <span className="font-medium">
            {PHASE_LABEL[state.phase]}
            {state.phase === "available" && state.availableVersion ? ` (v${state.availableVersion})` : ""}
            {state.phase === "downloading" && state.progressPercent != null
              ? ` (${state.progressPercent}%)`
              : ""}
          </span>
        </div>

        {state.error && <p className="text-sm text-destructive">{state.error}</p>}

        <div className="flex flex-wrap gap-2">
          {state.phase === "available" && <Button onClick={() => void download()}>Download update</Button>}
          {state.phase === "ready" && <Button onClick={() => install()}>Restart and install</Button>}
          <Button
            variant="outline"
            onClick={() => void check()}
            disabled={!supported || state.phase === "checking" || state.phase === "downloading"}
          >
            {state.phase === "checking" ? <Loader2 className="size-4 animate-spin" /> : "Check for updates"}
          </Button>
          {(state.phase === "unsupported" || state.phase === "error") && (
            <Button variant="ghost" onClick={() => void openReleases()}>
              View releases on GitHub
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

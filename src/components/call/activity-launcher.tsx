"use client";

import { useMutation, useQuery } from "convex/react";
import { Clapperboard } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseWatchSource } from "../../../convex/lib/watchTogether";

/**
 * The call bar's Activities panel: start "Watch together" with a link, or see what is already running.
 * Needs Use Activities in the channel — checked by the server when starting, and shown here with its reason
 * rather than hidden, so a member can tell why it is off.
 */
export function ActivityLauncher({
  channelId,
  blockedReason,
  className,
}: {
  channelId: Id<"channels">;
  blockedReason: string | null;
  className?: string;
}) {
  const activity = useQuery(api.voiceActivities.current, { channelId });
  const start = useMutation(api.voiceActivities.startWatch);
  const stop = useMutation(api.voiceActivities.stop);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsed = parseWatchSource(url);
    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await start({ channelId, url });
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <p className="text-sm font-semibold">Activities</p>
      {activity ? (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Clapperboard className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            Watch together is running, hosted by {activity.hostName}.
          </span>
          {activity.allowed && activity.canControl && (
            <Button variant="outline" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => void stop({ channelId }).catch(() => {})}>
              End
            </Button>
          )}
        </div>
      ) : blockedReason ? (
        <p className="mt-1 text-xs text-muted-foreground">{blockedReason}</p>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clapperboard className="size-4 shrink-0" />
            <span>Watch together — a video everyone in the call follows. You control playback.</span>
          </div>
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="YouTube link or a video file (https)"
              className="h-8 text-xs"
            />
            <Button size="sm" className="h-8 shrink-0" disabled={busy || !url.trim()} onClick={() => void submit()}>
              Watch
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

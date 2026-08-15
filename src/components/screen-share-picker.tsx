"use client";

import { useCallback, useEffect, useState } from "react";
import { AppWindow, Loader2, Monitor, Volume2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getDesktopAPI } from "@/lib/desktop";
import { getDefaultAudioChoice, setDefaultAudioChoice } from "@/lib/system-audio-prefs";
import { cn } from "@/lib/utils";
import type { SystemAudioChoice } from "@/hooks/use-room";
import type { AudioApp, ScreenSource } from "@/types/desktop-api";

interface ScreenSharePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShare: (sourceId: string, sourceName: string, audio: SystemAudioChoice) => void;
}

/**
 * Unified "share" picker: choose which screen or app window to share and what
 * audio to include — all in one step. Sources are enumerated by Electron's
 * `desktopCapturer` in the main process. On Linux, the audio can be limited to
 * a specific running application (per-app sharing).
 */
export function ScreenSharePicker({ open, onOpenChange, onShare }: ScreenSharePickerProps) {
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [audioChoice, setAudioChoiceState] = useState<SystemAudioChoice>(() => getDefaultAudioChoice());
  const [apps, setApps] = useState<AudioApp[] | null>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const perAppEnabled = !!getDesktopAPI()?.systemAudioLinux;

  const load = useCallback(async () => {
    const api = getDesktopAPI();
    if (!api?.screenShare) {
      setError("Screen sharing requires the desktop app.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    // Re-read the persisted default fresh on every open — RoomView keeps
    // this component mounted while the dialog is closed, so without this
    // the picker would keep showing whatever choice was active the first
    // time it ever opened, even after the default changed in Settings.
    setAudioChoiceState(getDefaultAudioChoice());
    try {
      const [list, appList]: [ScreenSource[], AudioApp[] | null] = await Promise.all([
        api.screenShare.getSources(),
        api.systemAudioLinux?.listAudioApps().catch(() => null) ?? Promise.resolve([]),
      ]);
      const screens = list.filter((s) => s.type === "screen");
      const windows = list.filter((s) => s.type === "window");
      const ordered = [...screens, ...windows];
      setSources(ordered);
      setSelectedId((prev) =>
        ordered.some((s) => s.id === prev) ? prev : (ordered[0]?.id ?? null)
      );
      setApps(appList);
      // A restored "share this app" choice might point at an app that's
      // since exited or changed identifier — reconcile against the just-
      // loaded list rather than silently sharing no app audio.
      setAudioChoiceState((prev) => {
        if (prev.mode !== "app") return prev;
        if (appList === null) return prev; // Don't reconcile on failure
        if (appList.some((a) => a.id === prev.appId)) return prev;
        const fallback: SystemAudioChoice = appList[0]
          ? { mode: "app", appId: appList[0].id }
          : { mode: "off" };
        setDefaultAudioChoice(fallback);
        return fallback;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const selected = sources.find((s) => s.id === selectedId) ?? null;

  const handleShare = () => {
    if (!selected) return;
    onShare(selected.id, selected.name, audioChoice);
  };

  const setAudioChoice = (choice: SystemAudioChoice) => {
    setAudioChoiceState(choice);
    setDefaultAudioChoice(choice);
  };

  const pickApp = (appId: string) => setAudioChoice({ mode: "app", appId });
  const appId = audioChoice.mode === "app" ? audioChoice.appId : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Share your screen</DialogTitle>
          <DialogDescription>
            Choose what to share. You can also include audio in the same step.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : sources.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            No shareable screens or windows found.
          </div>
        ) : (
          <ScrollArea className="max-h-[45vh]">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {sources.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={cn(
                    "group flex flex-col gap-2 overflow-hidden rounded-lg border bg-muted/30 p-2 text-left transition-colors",
                    "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                    selectedId === s.id
                      ? "border-primary ring-primary/30 ring-2"
                      : "hover:border-foreground/40"
                  )}
                >
                  <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded bg-muted/60">
                    {s.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.thumbnail} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                        {s.type === "screen" ? <Monitor className="size-6" /> : <AppWindow className="size-6" />}
                        No preview
                      </span>
                    )}
                  </div>
                  <span className="truncate text-xs font-medium">{s.name}</span>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}

        <div className="space-y-2 rounded-md border bg-muted/30 px-3 py-3">
          <div className="flex items-center gap-2">
            <Volume2 className="size-4 text-muted-foreground" />
            <Label className="text-sm font-normal">Audio</Label>
          </div>
          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="audio-choice"
                checked={audioChoice.mode === "off"}
                onChange={() => setAudioChoice({ mode: "off" })}
              />
              Don&apos;t share audio
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="audio-choice"
                checked={audioChoice.mode === "system"}
                onChange={() => setAudioChoice({ mode: "system" })}
              />
              Share system audio (all apps)
              <span className="block text-xs text-muted-foreground">
                Apps playing sound (not this app) will be heard in the room.
              </span>
            </label>
            {perAppEnabled && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="audio-choice"
                  checked={audioChoice.mode === "app"}
                  onChange={() => {
                    const first = apps?.[0];
                    setAudioChoice(first ? { mode: "app", appId: first.id } : { mode: "app", appId: "" });
                  }}
                />
                Share a specific app&apos;s audio
              </label>
            )}
          </div>

          {audioChoice.mode === "app" && (
            <ScrollArea className="max-h-44 rounded-md border bg-background/40 p-1">
              {(apps?.length ?? 0) === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  No audio-playing apps detected. Start some audio and try again.
                </p>
              ) : (
                apps?.map((app) => (
                  <label
                    key={app.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50"
                  >
                    <input
                      type="radio"
                      name="audio-app"
                      checked={appId === app.id}
                      onChange={() => pickApp(app.id)}
                    />
                    <span className="truncate">{app.name}</span>
                    {app.streams > 1 && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {app.streams} streams
                      </span>
                    )}
                  </label>
                ))
              )}
            </ScrollArea>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleShare} disabled={!selected || loading}>
            Start sharing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

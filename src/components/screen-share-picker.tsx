"use client";

import { useCallback, useEffect, useState } from "react";
import { AppWindow, Gauge, Loader2, Monitor, RefreshCw, Volume2 } from "lucide-react";

import { useAudioPreferences } from "@/components/audio-provider";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getDesktopAPI, getPlatform } from "@/lib/desktop";
import {
  STREAM_FRAME_RATES,
  STREAM_RESOLUTIONS,
  type StreamFrameRate,
  type StreamResolutionKey,
  type SystemAudioChoice,
} from "@/lib/audio-prefs";
import { cn } from "@/lib/utils";
import type { AudioApp, ScreenSource } from "@/types/desktop-api";

interface ScreenSharePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShare: (sourceId: string, sourceName: string, audio: SystemAudioChoice) => void;
  /**
   * "change" re-opens the picker against an already-running share: the
   * selection is seeded from what's actually live and the confirm button
   * applies to it in place instead of restarting the share.
   */
  mode?: "start" | "change";
  currentSourceId?: string | null;
  currentAudio?: SystemAudioChoice;
}

/** Encodes an audio choice as a single `<Select>` value. */
function audioChoiceToValue(choice: SystemAudioChoice): string {
  return choice.mode === "app" ? `app:${choice.appId}` : choice.mode;
}

function valueToAudioChoice(value: string): SystemAudioChoice {
  if (value === "system") return { mode: "system" };
  if (value.startsWith("app:")) return { mode: "app", appId: value.slice("app:".length) };
  return { mode: "off" };
}

/**
 * Unified "share" picker: choose which screen or app window to share, what
 * audio to include, and at what quality — all in one step, and re-openable
 * mid-share to change any of them without dropping the stream.
 *
 * Per-app audio is Linux-only. It relies on PipeWire/PulseAudio being able to
 * duplicate-link an individual application's streams into a virtual sink;
 * macOS (ScreenCaptureKit captures the whole system output) and Windows
 * (WASAPI loopback captures the whole default device) have no equivalent, so
 * the option is hidden rather than offered and silently ignored.
 */
export function ScreenSharePicker({
  open,
  onOpenChange,
  onShare,
  mode = "start",
  currentSourceId,
  currentAudio,
}: ScreenSharePickerProps) {
  const { quality, setQuality, shareAudio, setShareAudio } = useAudioPreferences();

  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [audioChoice, setAudioChoiceState] = useState<SystemAudioChoice>({ mode: "off" });
  const [apps, setApps] = useState<AudioApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const perAppEnabled = getPlatform() === "linux" && !!getDesktopAPI()?.systemAudioLinux;

  const loadApps = useCallback(async () => {
    if (!perAppEnabled) return [] as AudioApp[];
    const list = await getDesktopAPI()
      ?.systemAudioLinux?.listAudioApps()
      .catch(() => [] as AudioApp[]);
    setApps(list ?? []);
    return list ?? [];
  }, [perAppEnabled]);

  const load = useCallback(async () => {
    const api = getDesktopAPI();
    if (!api?.screenShare) {
      setError("Screen sharing requires the desktop app.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    // Re-read the persisted default fresh on every open — this component
    // stays mounted while the dialog is closed, so without this the picker
    // would keep showing whatever was active the first time it opened. While
    // changing a live share, what's *actually* going out wins over the saved
    // default.
    const seedAudio = mode === "change" && currentAudio ? currentAudio : shareAudio;
    setAudioChoiceState(seedAudio);

    try {
      const [list, appList] = await Promise.all([api.screenShare.getSources(), loadApps()]);
      const screens = list.filter((s) => s.type === "screen");
      const windows = list.filter((s) => s.type === "window");
      const ordered = [...screens, ...windows];
      setSources(ordered);
      setSelectedId((prev) => {
        const preferred = mode === "change" ? (currentSourceId ?? prev) : prev;
        return ordered.some((s) => s.id === preferred) ? preferred! : (ordered[0]?.id ?? null);
      });

      // A restored "share this app" choice might point at an app that's since
      // exited or changed identifier — reconcile against the just-loaded list
      // rather than silently sharing no app audio.
      if (seedAudio.mode === "app" && !appList.some((a) => a.id === seedAudio.appId)) {
        const fallback: SystemAudioChoice = appList[0]
          ? { mode: "app", appId: appList[0].id }
          : { mode: "system" };
        setAudioChoiceState(fallback);
        setShareAudio(fallback);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
    // `shareAudio` is read as a seed, not tracked — re-running on every
    // preference change would fight the user's in-dialog selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadApps, mode, currentAudio, currentSourceId, setShareAudio]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const selected = sources.find((s) => s.id === selectedId) ?? null;

  const setAudioChoice = (choice: SystemAudioChoice) => {
    setAudioChoiceState(choice);
    setShareAudio(choice);
  };

  const handleConfirm = () => {
    if (!selected) return;
    onShare(selected.id, selected.name, audioChoice);
  };

  const isChanging = mode === "change";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isChanging ? "Change what you're sharing" : "Share your screen"}</DialogTitle>
          <DialogDescription>
            {isChanging
              ? "Switch screens, change the audio source, or adjust the quality without ending your stream."
              : "Choose what to share. You can also set the audio and quality in the same step."}
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
          <ScrollArea className="max-h-[38vh]">
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
                        {s.type === "screen" ? (
                          <Monitor className="size-6" />
                        ) : (
                          <AppWindow className="size-6" />
                        )}
                        No preview
                      </span>
                    )}
                  </div>
                  <span className="truncate text-xs font-medium">
                    {s.name}
                    {isChanging && s.id === currentSourceId ? " (current)" : ""}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}

        <div className="grid gap-3 rounded-md border bg-muted/30 px-3 py-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Volume2 className="size-4 text-muted-foreground" />
              <Label className="text-sm font-normal">Audio</Label>
              {perAppEnabled && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-6"
                  title="Refresh the list of apps playing audio"
                  onClick={() => void loadApps()}
                >
                  <RefreshCw className="size-3.5" />
                </Button>
              )}
            </div>
            <Select
              value={audioChoiceToValue(audioChoice)}
              onValueChange={(value) => setAudioChoice(valueToAudioChoice(value))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select audio" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Don&apos;t share audio</SelectItem>
                <SelectItem value="system">System audio (all apps)</SelectItem>
                {perAppEnabled && (
                  <SelectGroup>
                    <SelectLabel>A specific app</SelectLabel>
                    {apps.length === 0 ? (
                      <SelectItem value="app:" disabled>
                        No apps playing audio
                      </SelectItem>
                    ) : (
                      apps.map((app) => (
                        <SelectItem key={app.id} value={`app:${app.id}`}>
                          {app.name}
                          {app.streams > 1 ? ` (${app.streams} streams)` : ""}
                        </SelectItem>
                      ))
                    )}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Gauge className="size-4 text-muted-foreground" />
              <Label className="text-sm font-normal">Quality</Label>
            </div>
            <div className="flex gap-2">
              <Select
                value={quality.resolution}
                onValueChange={(value) =>
                  setQuality({ ...quality, resolution: value as StreamResolutionKey })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STREAM_RESOLUTIONS.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={String(quality.frameRate)}
                onValueChange={(value) =>
                  setQuality({ ...quality, frameRate: Number(value) as StreamFrameRate })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STREAM_FRAME_RATES.map((fps) => (
                    <SelectItem key={fps} value={String(fps)}>
                      {fps} fps
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {audioChoice.mode === "system" && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Apps playing sound (other than Crystal) will be heard in the call.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selected || loading}>
            {isChanging ? "Apply" : "Start sharing"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

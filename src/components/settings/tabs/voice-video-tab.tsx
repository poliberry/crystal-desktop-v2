"use client";

import { useCallback, useEffect, useState } from "react";
import { Gamepad2, Headphones, Mic, RefreshCw } from "lucide-react";

import { useAudioPreferences } from "@/components/audio-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useRichPresenceStatus } from "@/hooks/use-rich-presence";
import { getDesktopAPI, getPlatform } from "@/lib/desktop";
import {
  STREAM_FRAME_RATES,
  STREAM_RESOLUTIONS,
  type StreamFrameRate,
  type StreamResolutionKey,
  type SystemAudioChoice,
} from "@/lib/audio-prefs";
import { BUILTIN_SOUNDS, playSound } from "@/lib/soundboard";
import { JoinSoundPicker } from "@/components/settings/join-sound-picker";
import { playUiSound } from "@/lib/ui-sounds";
import type { AudioApp } from "@/types/desktop-api";

type SystemAudioStatus =
  | { kind: "unsupported" }
  | { kind: "linux"; available: boolean; recorder: string | null; running: boolean }
  | { kind: "mac"; running: boolean; helper: boolean }
  | { kind: "other" };

/** `""` is our "OS default" sentinel; `<Select>` needs a non-empty value. */
const DEFAULT_DEVICE = "__default__";

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
}

function audioChoiceToValue(choice: SystemAudioChoice): string {
  return choice.mode === "app" ? `app:${choice.appId}` : choice.mode;
}

function valueToAudioChoice(value: string): SystemAudioChoice {
  if (value === "system") return { mode: "system" };
  if (value.startsWith("app:")) return { mode: "app", appId: value.slice("app:".length) };
  return { mode: "off" };
}

export function VoiceVideoTab() {
  const {
    inputs,
    outputs,
    inputDeviceId,
    outputDeviceId,
    setInputDeviceId,
    setOutputDeviceId,
    labelsAvailable,
    refreshDevices,
    quality,
    setQuality,
    shareAudio,
    setShareAudio,
    soundboardVolume,
    setSoundboardVolume,
    uiSoundVolume,
    setUiSoundVolume,
    richPresenceEnabled,
    setRichPresenceEnabled,
  } = useAudioPreferences();

  const [status, setStatus] = useState<SystemAudioStatus>({ kind: "other" });
  const [apps, setApps] = useState<AudioApp[]>([]);
  const richPresence = useRichPresenceStatus();

  const perAppEnabled = getPlatform() === "linux" && !!getDesktopAPI()?.systemAudioLinux;

  // Device labels are blank until a capture has been permitted once — ask on
  // mount so this panel isn't a list of "Microphone 1 / Microphone 2".
  useEffect(() => {
    void refreshDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadApps = useCallback(async () => {
    if (!perAppEnabled) return;
    const list = await getDesktopAPI()
      ?.systemAudioLinux?.listAudioApps()
      .catch(() => [] as AudioApp[]);
    setApps(list ?? []);
  }, [perAppEnabled]);

  useEffect(() => {
    const api = getDesktopAPI();
    if (!api) {
      setStatus({ kind: "unsupported" });
      return;
    }
    const platform = getPlatform();
    if (platform === "linux" && api.systemAudioLinux) {
      void api.systemAudioLinux
        .info()
        .then((info) =>
          setStatus({
            kind: "linux",
            available: true,
            recorder: info.recorder,
            running: info.running,
          })
        )
        .catch(() => setStatus({ kind: "linux", available: false, recorder: null, running: false }));
      void loadApps();
    } else if (platform === "darwin" && api.systemAudioMac) {
      void api.systemAudioMac
        .info()
        .then((info) => setStatus({ kind: "mac", running: info.running, helper: !!info.helper }))
        .catch(() => setStatus({ kind: "mac", running: false, helper: false }));
    } else {
      setStatus({ kind: "other" });
    }
  }, [loadApps]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Audio devices</CardTitle>
          <CardDescription>
            Used everywhere in the app, including calls already in progress. The same pickers are
            on the user card next to the mute button.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-2 text-sm font-normal">
              <Mic className="size-4 text-muted-foreground" />
              Input device
            </Label>
            <Select
              value={inputDeviceId || DEFAULT_DEVICE}
              onValueChange={(value) => setInputDeviceId(value === DEFAULT_DEVICE ? "" : value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_DEVICE}>System default</SelectItem>
                {inputs.map((device) => (
                  <SelectItem key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-2 text-sm font-normal">
              <Headphones className="size-4 text-muted-foreground" />
              Output device
            </Label>
            <Select
              value={outputDeviceId || DEFAULT_DEVICE}
              onValueChange={(value) => setOutputDeviceId(value === DEFAULT_DEVICE ? "" : value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_DEVICE}>System default</SelectItem>
                {outputs.map((device) => (
                  <SelectItem key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void refreshDevices()}>
              <RefreshCw className="size-3.5" />
              Refresh devices
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void playSound(BUILTIN_SOUNDS[0].url, {
                  volume: 0.8,
                  outputDeviceId: outputDeviceId || undefined,
                })
              }
            >
              Test output
            </Button>
            {!labelsAvailable && (
              <span className="text-xs text-muted-foreground">
                Grant microphone access to see device names.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stream quality</CardTitle>
          <CardDescription>
            Resolution and frame rate for your screen shares. Changing this while sharing
            re-captures at the new setting.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-sm font-normal">Resolution</Label>
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
                    {r.label} ({r.width}×{r.height})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-normal">Frame rate</Label>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Default sharing audio</CardTitle>
          <CardDescription>
            What to include by default the next time you share your screen. You can always change
            it per-share.
            {perAppEnabled
              ? " Sharing one app's audio is only possible on Linux, where PipeWire can tap an individual application."
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label className="text-sm font-normal">Audio</Label>
              <Select
                value={audioChoiceToValue(shareAudio)}
                onValueChange={(value) => setShareAudio(valueToAudioChoice(value))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
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
                          </SelectItem>
                        ))
                      )}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </div>
            {perAppEnabled && (
              <Button variant="outline" size="icon" onClick={() => void loadApps()}>
                <RefreshCw className="size-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Soundboard</CardTitle>
          <CardDescription>
            How loud soundboard clips play for you — this only affects what you hear.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Slider
            value={[Math.round(soundboardVolume * 100)]}
            min={0}
            max={100}
            step={5}
            onValueChange={([value]) => setSoundboardVolume((value ?? 0) / 100)}
          />
          <span className="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
            {Math.round(soundboardVolume * 100)}%
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void playSound(BUILTIN_SOUNDS[0].url, {
                volume: soundboardVolume,
                outputDeviceId: outputDeviceId || undefined,
              })
            }
          >
            Preview
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Join sound</CardTitle>
          <CardDescription>
            Played to everyone in a call when you join it. You can pick any soundboard clip from
            any server you&apos;re in, and override it per server from that server&apos;s profile.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JoinSoundPicker />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>App sounds</CardTitle>
          <CardDescription>
            The chimes for joining a call, muting, ringing and new messages. Set this to zero to
            turn them off entirely.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Slider
            value={[Math.round(uiSoundVolume * 100)]}
            min={0}
            max={100}
            step={5}
            onValueChange={([value]) => setUiSoundVolume((value ?? 0) / 100)}
          />
          <span className="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
            {Math.round(uiSoundVolume * 100)}%
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              playUiSound("callJoin", {
                volume: uiSoundVolume,
                outputDeviceId: outputDeviceId || undefined,
              })
            }
          >
            Preview
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gamepad2 className="size-4" />
            Rich Presence
          </CardTitle>
          <CardDescription>
            Show the game you&apos;re playing (matched against Discord&apos;s public detectables
            list) and the music you&apos;re listening to on your profile card.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="rich-presence" className="font-normal">
              Share my activity
            </Label>
            <Switch
              id="rich-presence"
              checked={richPresenceEnabled}
              onCheckedChange={setRichPresenceEnabled}
            />
          </div>
          {richPresence ? (
            <>
              <StatusRow
                label="Known games"
                value={
                  richPresence.detectableCount > 0
                    ? richPresence.detectableCount.toLocaleString()
                    : "Downloading…"
                }
              />
              <StatusRow
                label="Game IPC socket"
                value={richPresence.ipcPath ?? "No free slot"}
              />
              <StatusRow label="Connected games" value={String(richPresence.ipcClients)} />
            </>
          ) : (
            <p className="text-muted-foreground">Requires the desktop app.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>System audio</CardTitle>
          <CardDescription>
            Diagnostics for sharing other apps&apos; audio during a screen share.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {status.kind === "unsupported" && (
            <p className="text-muted-foreground">Requires the desktop app.</p>
          )}
          {status.kind === "other" && (
            <p className="text-muted-foreground">
              Handled automatically when you start a screen share on this platform.
            </p>
          )}
          {status.kind === "linux" && (
            <>
              <StatusRow
                label="PulseAudio/PipeWire"
                value={status.available ? "Available" : "Not available"}
              />
              <StatusRow label="Recorder" value={status.recorder ?? "Not found"} />
              <StatusRow label="Currently sharing" value={status.running ? "Yes" : "No"} />
            </>
          )}
          {status.kind === "mac" && (
            <>
              <StatusRow
                label="ScreenCaptureKit helper"
                value={status.helper ? "Bundled" : "Not bundled"}
              />
              <StatusRow label="Currently sharing" value={status.running ? "Yes" : "No"} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

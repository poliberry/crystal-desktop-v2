"use client";

import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getDesktopAPI, getPlatform } from "@/lib/desktop";
import { getDefaultAudioChoice, setDefaultAudioChoice } from "@/lib/system-audio-prefs";
import type { SystemAudioChoice } from "@/hooks/use-room";
import type { AudioApp } from "@/types/desktop-api";

type Status =
  | { kind: "unsupported" }
  | { kind: "linux"; available: boolean; recorder: string | null; running: boolean }
  | { kind: "mac"; running: boolean; helper: boolean }
  | { kind: "other" };

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function VoiceVideoTab() {
  const [status, setStatus] = useState<Status>({ kind: "other" });
  const [apps, setApps] = useState<AudioApp[]>([]);
  const [choice, setChoiceState] = useState<SystemAudioChoice>(() => getDefaultAudioChoice());

  const perAppEnabled = !!getDesktopAPI()?.systemAudioLinux && getPlatform() === "linux";

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
          setStatus({ kind: "linux", available: true, recorder: info.recorder, running: info.running })
        )
        .catch(() => setStatus({ kind: "linux", available: false, recorder: null, running: false }));
      void api.systemAudioLinux.listAudioApps().then(setApps).catch(() => {});
    } else if (platform === "darwin" && api.systemAudioMac) {
      void api.systemAudioMac
        .info()
        .then((info) => setStatus({ kind: "mac", running: info.running, helper: !!info.helper }))
        .catch(() => setStatus({ kind: "mac", running: false, helper: false }));
    } else {
      setStatus({ kind: "other" });
    }
  }, []);

  const choose = (next: SystemAudioChoice) => {
    setChoiceState(next);
    setDefaultAudioChoice(next);
  };

  return (
    <div className="space-y-6">
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
              <StatusRow label="PulseAudio/PipeWire" value={status.available ? "Available" : "Not available"} />
              <StatusRow label="Recorder" value={status.recorder ?? "Not found"} />
              <StatusRow label="Currently sharing" value={status.running ? "Yes" : "No"} />
            </>
          )}
          {status.kind === "mac" && (
            <>
              <StatusRow label="ScreenCaptureKit helper" value={status.helper ? "Bundled" : "Not bundled"} />
              <StatusRow label="Currently sharing" value={status.running ? "Yes" : "No"} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Default sharing audio</CardTitle>
          <CardDescription>
            What to include by default the next time you share your screen. You can always change it per-share.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Volume2 className="size-4" />
            <Label className="text-sm font-normal text-foreground">Audio</Label>
          </div>
          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="default-audio-choice"
                checked={choice.mode === "off"}
                onChange={() => choose({ mode: "off" })}
              />
              Don&apos;t share audio
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="default-audio-choice"
                checked={choice.mode === "system"}
                onChange={() => choose({ mode: "system" })}
              />
              Share system audio (all apps)
            </label>
            {perAppEnabled && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="default-audio-choice"
                  checked={choice.mode === "app"}
                  onChange={() => {
                    const first = apps[0];
                    choose(first ? { mode: "app", appId: first.id } : { mode: "app", appId: "" });
                  }}
                />
                Share a specific app&apos;s audio
              </label>
            )}
          </div>

          {choice.mode === "app" && perAppEnabled && (
            <ScrollArea className="max-h-44 rounded-md border bg-background/40 p-1">
              {apps.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  No audio-playing apps detected right now.
                </p>
              ) : (
                apps.map((app) => (
                  <label
                    key={app.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50"
                  >
                    <input
                      type="radio"
                      name="default-audio-app"
                      checked={choice.mode === "app" && choice.appId === app.id}
                      onChange={() => choose({ mode: "app", appId: app.id })}
                    />
                    <span className="truncate">{app.name}</span>
                  </label>
                ))
              )}
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

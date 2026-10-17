"use client";

import { useConvex } from "convex/react";
import { BellRing, Download, Share } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canPromptInstall, disablePush, enablePush, isIos, isStandalone, onInstallAvailabilityChange, promptInstall, pushState, pwaSupported, type PushState } from "@/lib/pwa";

/**
 * Settings → Notifications, on the web: notifications on this device, and installing Crystal as an app.
 * Not shown in the desktop app, which uses native notifications.
 */
export function WebAppSettings() {
  const convex = useConvex();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installable, setInstallable] = useState(false);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    void pushState().then(setState);
    setStandalone(isStandalone());
    setInstallable(canPromptInstall());
    const off = onInstallAvailabilityChange(() => setInstallable(canPromptInstall()));
    return () => {
      off();
    };
  }, []);

  if (!pwaSupported() && state !== "needs-install") return null;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(state === "on" ? await disablePush(convex) : await enablePush(convex));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change notifications.");
    } finally {
      setBusy(false);
    }
  };

  const description: Record<PushState, string> = {
    on: "This device gets a notification for messages, mentions and calls, even when Crystal is closed.",
    off: "Get a notification for messages, mentions and calls on this device, even when Crystal is closed.",
    denied: "Notifications are blocked for Crystal in this browser. Allow them in the browser's site settings, then come back.",
    "needs-install": "On iPhone and iPad, notifications work once Crystal is on your home screen: tap Share, then “Add to Home Screen”, and open it from there.",
    unsupported: "This browser can't show notifications from websites.",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BellRing className="size-4" /> This device</CardTitle>
        <CardDescription>Notifications and installing Crystal as an app.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Push notifications</p>
            <p className="mt-1 text-xs text-muted-foreground">{state ? description[state] : "Checking…"}</p>
            {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          </div>
          {(state === "on" || state === "off") && (
            <Button variant={state === "on" ? "outline" : "default"} onClick={toggle} disabled={busy}>
              {state === "on" ? "Turn off" : "Turn on"}
            </Button>
          )}
        </div>
        {!standalone && (installable || isIos()) && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Install Crystal</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {installable ? "Add Crystal to your home screen or dock. It opens in its own window, like any other app." : "Tap the Share button, then “Add to Home Screen”."}
              </p>
            </div>
            {installable ? (
              <Button variant="outline" onClick={() => void promptInstall().then(() => setInstallable(canPromptInstall()))}>
                <Download className="size-4" /> Install
              </Button>
            ) : (
              <Share className="size-5 text-muted-foreground" />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

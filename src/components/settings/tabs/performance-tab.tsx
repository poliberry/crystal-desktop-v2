"use client";

import { Cpu, Loader2, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";

import { SettingRow, SettingsGroup } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getDesktopAPI } from "@/lib/desktop";
import type { GpuSettings } from "@/types/desktop-api";

/**
 * How hard the app leans on the graphics card.
 *
 * Hardware acceleration is what lets Chromium draw the interface (blurred panels, video, animations) on the GPU. It is the
 * right default, but on some Linux setups — certain drivers, Wayland, hybrid graphics — it is also what makes the whole
 * window freeze and the cursor smear across the screen. Turning it off draws everything on the processor instead: slower
 * and warmer, but it cannot take the display down with it.
 *
 * Chromium reads the setting only as it starts, so the choice is saved here at once and applied by a restart. That restart
 * is offered, not forced: someone in a call shouldn't be dropped because they ticked a box.
 */
export function PerformanceTab() {
  const gpu = getDesktopAPI()?.gpu;
  const [settings, setSettings] = useState<GpuSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!gpu) return;
    void gpu.get().then(setSettings).catch(() => {});
  }, [gpu]);

  if (!gpu) {
    return (
      <SettingsGroup>
        <SettingRow
          icon={Cpu}
          title="Hardware acceleration"
          description="This setting is part of the desktop app. The browser decides this for itself."
        />
      </SettingsGroup>
    );
  }

  const off = settings ? settings.saved || settings.forcedByEnv : false;
  const restartNeeded = !!settings && !settings.forcedByEnv && settings.saved !== settings.runningWithout;

  const change = async (accelerate: boolean) => {
    setSaving(true);
    try {
      setSettings(await gpu.setDisabled(!accelerate));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsGroup title="Graphics">
      <SettingRow
        icon={Cpu}
        title="Hardware acceleration"
        description="Draw the app on your graphics card. Turn this off if the app freezes, the screen glitches, or the cursor smears across the display — it is slower, but it avoids graphics driver problems."
      >
        {saving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        <Switch
          checked={!off}
          disabled={!settings || saving || settings.forcedByEnv}
          onCheckedChange={(checked) => void change(checked)}
          aria-label="Hardware acceleration"
        />
      </SettingRow>

      {settings?.forcedByEnv && (
        <p className="px-1 text-xs text-muted-foreground">
          Turned off by the <code className="rounded bg-muted px-1">CRYSTAL_DISABLE_GPU</code> environment variable, which this setting can&apos;t override. Remove the variable to turn it back on.
        </p>
      )}

      {restartNeeded && (
        <SettingRow
          icon={RotateCw}
          title="Restart to apply"
          description={
            settings.saved
              ? "Hardware acceleration will be off the next time Crystal starts."
              : "Hardware acceleration will be back on the next time Crystal starts."
          }
        >
          <Button
            size="sm"
            disabled={restarting}
            onClick={() => {
              setRestarting(true);
              void gpu.relaunch();
            }}
          >
            {restarting ? <Loader2 className="size-4 animate-spin" /> : "Restart now"}
          </Button>
        </SettingRow>
      )}
    </SettingsGroup>
  );
}

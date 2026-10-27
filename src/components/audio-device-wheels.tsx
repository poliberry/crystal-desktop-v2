"use client";

import { Headphones, Mic, Sparkles } from "lucide-react";

import { useAudioPreferences } from "@/components/audio-provider";
import { Switch } from "@/components/ui/switch";
import { WheelPicker as Wheel, type WheelItem } from "@/components/ui/wheel-picker";

/** `""` is our "OS default" sentinel; a wheel row needs a real value. */
const DEFAULT_VALUE = "__default__";

/**
 * The input and output pickers as two side-by-side wheels, for the user card to
 * unfold above its own row.
 *
 * Same preferences as {@link AudioDeviceMenuItems} and Settings → Voice &
 * Video: choosing here is the app-wide choice, not a per-call one.
 */
export function AudioDeviceWheels() {
  const {
    inputs,
    outputs,
    inputDeviceId,
    outputDeviceId,
    setInputDeviceId,
    setOutputDeviceId,
    noiseSuppression,
    setNoiseSuppression,
    noiseSuppressionSupported,
  } = useAudioPreferences();

  const toItems = (devices: { deviceId: string; label: string }[]): WheelItem[] => [
    { value: DEFAULT_VALUE, label: "System default" },
    ...devices.map((device) => ({
      value: device.deviceId,
      label: device.label || "Unknown device",
    })),
  ];

  return (
    <div className="px-3 pt-3 pb-1">
      <div className="flex gap-3">
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          <Mic className="size-3.5" />
          Input
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          <Headphones className="size-3.5" />
          Output
        </div>
      </div>

      <div className="mt-1 flex gap-3">
        <Wheel
          label="Input device"
          items={toItems(inputs)}
          value={inputDeviceId || DEFAULT_VALUE}
          onChange={(value) => setInputDeviceId(value === DEFAULT_VALUE ? "" : value)}
        />
        <Wheel
          label="Output device"
          items={toItems(outputs)}
          value={outputDeviceId || DEFAULT_VALUE}
          onChange={(value) => setOutputDeviceId(value === DEFAULT_VALUE ? "" : value)}
        />
      </div>

      {noiseSuppressionSupported && (
        // Sits under the input wheel's column of the card because it is what
        // the microphone gets processed by — switching mic and cleaning it up
        // are the same decision.
        <div className="mt-1 flex items-center gap-2 px-1 py-1 text-xs text-muted-foreground">
          <Sparkles className="size-3.5" />
          <span id="noise-suppression-label">Noise suppression</span>
          <Switch
            aria-labelledby="noise-suppression-label"
            checked={noiseSuppression}
            onCheckedChange={setNoiseSuppression}
            className="ml-auto"
          />
        </div>
      )}
    </div>
  );
}

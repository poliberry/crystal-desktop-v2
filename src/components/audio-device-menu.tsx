"use client";

import { Headphones, Mic } from "lucide-react";

import { useAudioPreferences } from "@/components/audio-provider";
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/** `""` is our "OS default" sentinel; the radio group needs a real value. */
const DEFAULT_VALUE = "__default__";

/**
 * The input/output device pickers shared by the mini call bar's user card and
 * the in-call control bar. Rendered inside a `<DropdownMenuContent>` by the
 * caller so each site controls its own trigger and placement.
 *
 * Selecting a device writes the app-wide preference rather than a per-call
 * one, so it sticks across calls and is the same value Settings → Voice &
 * Video edits.
 */
export function AudioDeviceMenuItems() {
  const {
    inputs,
    outputs,
    inputDeviceId,
    outputDeviceId,
    setInputDeviceId,
    setOutputDeviceId,
  } = useAudioPreferences();

  return (
    <>
      <DropdownMenuLabel className="flex items-center gap-2">
        <Mic className="size-3.5" />
        Input device
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={inputDeviceId || DEFAULT_VALUE}
        onValueChange={(value) => setInputDeviceId(value === DEFAULT_VALUE ? "" : value)}
      >
        <DropdownMenuRadioItem value={DEFAULT_VALUE}>System default</DropdownMenuRadioItem>
        {inputs.map((device) => (
          <DropdownMenuRadioItem key={device.deviceId} value={device.deviceId}>
            <span className="truncate">{device.label}</span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>

      <DropdownMenuSeparator />

      <DropdownMenuLabel className="flex items-center gap-2">
        <Headphones className="size-3.5" />
        Output device
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={outputDeviceId || DEFAULT_VALUE}
        onValueChange={(value) => setOutputDeviceId(value === DEFAULT_VALUE ? "" : value)}
      >
        <DropdownMenuRadioItem value={DEFAULT_VALUE}>System default</DropdownMenuRadioItem>
        {outputs.map((device) => (
          <DropdownMenuRadioItem key={device.deviceId} value={device.deviceId}>
            <span className="truncate">{device.label}</span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

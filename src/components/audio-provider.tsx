"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  AUDIO_PREFERENCES_STORAGE_KEY,
  DEFAULT_AUDIO_PREFERENCES,
  readAudioPreferences,
  writeAudioPreferences,
  type AudioPreferences,
  type StreamQuality,
  type SystemAudioChoice,
} from "@/lib/audio-prefs";
import { isNoiseSuppressionSupported } from "@/lib/noise-filter";
import { playUiSound, type UiSound } from "@/lib/ui-sounds";

export interface AudioDeviceOption {
  deviceId: string;
  label: string;
}

interface AudioPreferencesContextValue extends AudioPreferences {
  inputs: AudioDeviceOption[];
  outputs: AudioDeviceOption[];
  /** Whether device *labels* are readable yet — Chromium hides them until
   * microphone permission has been granted at least once. */
  labelsAvailable: boolean;
  hasMicrophone: boolean;
  hasCamera: boolean;
  setInputDeviceId: (deviceId: string) => void;
  setOutputDeviceId: (deviceId: string) => void;
  setMuted: (muted: boolean) => void;
  toggleMuted: () => void;
  setDeafened: (deafened: boolean) => void;
  toggleDeafened: () => void;
  setNoiseSuppression: (enabled: boolean) => void;
  toggleNoiseSuppression: () => void;
  /** Whether the Krisp filter can run in this renderer at all — false hides
   * the toggle rather than offering a switch that does nothing. */
  noiseSuppressionSupported: boolean;
  setQuality: (quality: StreamQuality) => void;
  setShareAudio: (choice: SystemAudioChoice) => void;
  setParticipantVolume: (volume: number) => void;
  setStreamVolume: (volume: number) => void;
  setSoundboardVolume: (volume: number) => void;
  setUiSoundVolume: (volume: number) => void;
  setRichPresenceEnabled: (enabled: boolean) => void;
  /** Re-enumerate devices, prompting for microphone access first so labels
   * are populated. Called when a device dropdown is opened. */
  refreshDevices: () => Promise<void>;
  /** Play one of the app's own effects at the user's configured volume. */
  playCue: (sound: UiSound) => void;
}

const AudioPreferencesContext = createContext<AudioPreferencesContextValue | null>(null);

function toOptions(devices: MediaDeviceInfo[], kind: MediaDeviceKind): AudioDeviceOption[] {
  return devices
    .filter((d) => d.kind === kind && d.deviceId !== "communications")
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `${kind === "audioinput" ? "Microphone" : "Speaker"} ${i + 1}`,
    }));
}

/**
 * Owns the app-wide audio settings — input/output device, global mute and
 * deafen, screen-share quality — for every window.
 *
 * Deliberately knows nothing about LiveKit: a call reads these values and
 * applies them (see `useRoom`), which is what makes mute/deafen meaningful
 * *before* joining a call and what makes them survive switching calls. The
 * Settings window mounts this same provider, so changing a device there
 * writes to the shared storage key and the main window's active call picks it
 * up through the `storage` event below.
 */
export function AudioPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<AudioPreferences>(DEFAULT_AUDIO_PREFERENCES);
  const [inputs, setInputs] = useState<AudioDeviceOption[]>([]);
  const [outputs, setOutputs] = useState<AudioDeviceOption[]>([]);
  const [labelsAvailable, setLabelsAvailable] = useState(false);
  const [hasMicrophone, setHasMicrophone] = useState(true);
  const [hasCamera, setHasCamera] = useState(true);
  // Resolved after mount: it reads the user agent, which isn't available
  // while the shell is being prerendered.
  const [noiseSuppressionSupported, setNoiseSuppressionSupported] = useState(false);

  useEffect(() => {
    setPrefs(readAudioPreferences());
    setNoiseSuppressionSupported(isNoiseSuppressionSupported());
  }, []);

  const enumerate = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    setInputs(toOptions(devices, "audioinput"));
    setOutputs(toOptions(devices, "audiooutput"));
    setHasMicrophone(devices.some((d) => d.kind === "audioinput"));
    setHasCamera(devices.some((d) => d.kind === "videoinput"));
    setLabelsAvailable(devices.some((d) => d.kind === "audioinput" && !!d.label));
  }, []);

  useEffect(() => {
    void enumerate();
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    const onChange = () => void enumerate();
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onChange);
  }, [enumerate]);

  const refreshDevices = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    if (!labelsAvailable) {
      // Labels stay blank until a capture has been permitted once; grab a
      // throwaway stream purely to unlock them.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        // Permission denied — fall through and list the (unlabelled) devices.
      }
    }
    await enumerate();
  }, [enumerate, labelsAvailable]);

  /** Apply a patch, persist it, and let the other window know. `storage`
   * only fires in *other* windows, so this never echoes back to us. */
  const update = useCallback(
    (patch: Partial<AudioPreferences> | ((prev: AudioPreferences) => Partial<AudioPreferences>)) => {
      setPrefs((prev) => {
        const next = { ...prev, ...(typeof patch === "function" ? patch(prev) : patch) };
        writeAudioPreferences(next);
        return next;
      });
    },
    []
  );

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== AUDIO_PREFERENCES_STORAGE_KEY) return;
      setPrefs(readAudioPreferences());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Refs so the setters below can read the current volume/device without
  // being rebuilt (and re-triggering their consumers) on every change.
  const soundContext = useRef({ volume: prefs.uiSoundVolume, outputDeviceId: prefs.outputDeviceId });
  soundContext.current = { volume: prefs.uiSoundVolume, outputDeviceId: prefs.outputDeviceId };

  const cue = useCallback((sound: UiSound) => {
    playUiSound(sound, {
      volume: soundContext.current.volume,
      outputDeviceId: soundContext.current.outputDeviceId || undefined,
    });
  }, []);

  const setMuted = useCallback(
    (muted: boolean) => {
      // Unmuting while deafened is the same gesture as undeafening in every
      // other client — being able to talk but not hear is never what's meant.
      update(muted ? { muted } : { muted: false, deafened: false });
      cue(muted ? "mute" : "unmute");
    },
    [update, cue]
  );

  const setDeafened = useCallback(
    (deafened: boolean) => {
      // Deafening always mutes; undeafening restores whatever the mute state
      // was beforehand rather than blindly unmuting.
      update((prev) =>
        deafened
          ? { deafened: true, mutedBeforeDeafen: prev.muted, muted: true }
          : { deafened: false, muted: prev.mutedBeforeDeafen }
      );
      cue(deafened ? "deafen" : "undeafen");
    },
    [update, cue]
  );

  const value = useMemo<AudioPreferencesContextValue>(
    () => ({
      ...prefs,
      inputs,
      outputs,
      labelsAvailable,
      hasMicrophone,
      hasCamera,
      noiseSuppressionSupported,
      setInputDeviceId: (inputDeviceId) => update({ inputDeviceId }),
      setOutputDeviceId: (outputDeviceId) => update({ outputDeviceId }),
      setMuted,
      toggleMuted: () => setMuted(!prefs.muted),
      setDeafened,
      toggleDeafened: () => setDeafened(!prefs.deafened),
      setNoiseSuppression: (noiseSuppression) => update({ noiseSuppression }),
      toggleNoiseSuppression: () => update({ noiseSuppression: !prefs.noiseSuppression }),
      setQuality: (quality) => update({ quality }),
      setShareAudio: (shareAudio) => update({ shareAudio }),
      setParticipantVolume: (participantVolume) => update({ participantVolume }),
      setStreamVolume: (streamVolume) => update({ streamVolume }),
      setSoundboardVolume: (soundboardVolume) => update({ soundboardVolume }),
      setUiSoundVolume: (uiSoundVolume) => update({ uiSoundVolume }),
      setRichPresenceEnabled: (richPresenceEnabled) => update({ richPresenceEnabled }),
      refreshDevices,
      playCue: cue,
    }),
    [
      prefs,
      inputs,
      outputs,
      labelsAvailable,
      hasMicrophone,
      hasCamera,
      noiseSuppressionSupported,
      update,
      setMuted,
      setDeafened,
      refreshDevices,
      cue,
    ]
  );

  return (
    <AudioPreferencesContext.Provider value={value}>{children}</AudioPreferencesContext.Provider>
  );
}

export function useAudioPreferences(): AudioPreferencesContextValue {
  const ctx = useContext(AudioPreferencesContext);
  if (!ctx) {
    throw new Error("useAudioPreferences must be used within <AudioPreferencesProvider>");
  }
  return ctx;
}

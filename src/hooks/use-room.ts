"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  createLocalScreenTracks,
  type RemoteParticipant,
} from "livekit-client";

import {
  isSystemAudioSharing,
  stopSystemAudio,
  toggleSystemAudio as toggleSystemAudioLib,
} from "@/lib/system-audio";
import { getDesktopAPI, isElectron } from "@/lib/desktop";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "disconnected";

/** What audio to share alongside a screen share. */
export type SystemAudioChoice =
  | { mode: "off" }
  | { mode: "system" }
  | { mode: "app"; appId: string };

export interface ConnectOptions {
  url: string;
  token: string;
}

export function useRoom() {
  const [room] = useState(
    () =>
      new Room({
        adaptiveStream: true,
        dynacast: true,
      })
  );

  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenShares, setScreenShares] = useState<string[]>([]);
  const [systemAudioSharing, setSystemAudioSharing] = useState(false);

  const screenSharingRef = useRef(false);
  const connectedRef = useRef(false);

  const syncLocalTracks = useCallback(() => {
    const local = room.localParticipant;
    if (!local) return;
    setCameraEnabled(local.isCameraEnabled);
    setMicrophoneEnabled(local.isMicrophoneEnabled);
  }, [room]);

  const syncScreenSharing = useCallback(() => {
    const local = room.localParticipant;
    if (!local) return;
    const pub = local.getTrackPublication(Track.Source.ScreenShare);
    const sharing = !!pub && !pub.isMuted;
    screenSharingRef.current = sharing;
    setScreenSharing(sharing);
  }, [room]);

  const syncScreenShares = useCallback(() => {
    const sharing: string[] = [];
    const local = room.localParticipant;
    if (local) {
      const pub = local.getTrackPublication(Track.Source.ScreenShare);
      if (pub && !pub.isMuted) sharing.push(local.identity);
    }
    for (const p of room.remoteParticipants.values()) {
      const pub = p.getTrackPublication(Track.Source.ScreenShare);
      if (pub && !pub.isMuted) sharing.push(p.identity);
    }
    setScreenShares(sharing);
  }, [room]);

  useEffect(() => {
    const refreshParticipants = () => {
      setParticipants(Array.from(room.remoteParticipants.values()));
    };
    const onParticipantsChanged = () => {
      refreshParticipants();
      syncScreenShares();
    };
    const onConnected = () => {
      setStatus("connected");
      connectedRef.current = true;
      // `room.remoteParticipants` is already populated with everyone present
      // at connect time, but `ParticipantConnected` only fires for people who
      // join *after* us — without this, a joiner's participant list stays
      // empty until someone else connects or disconnects.
      refreshParticipants();
      syncLocalTracks();
      syncScreenSharing();
      syncScreenShares();
    };
    const onDisconnected = () => {
      connectedRef.current = false;
      setStatus("disconnected");
      setScreenSharing(false);
      setScreenShares([]);
      setSystemAudioSharing(false);
    };
    const onTrackPublished = () => {
      syncLocalTracks();
      syncScreenSharing();
      syncScreenShares();
    };
    const onTrackUnpublished = () => {
      syncLocalTracks();
      syncScreenSharing();
      syncScreenShares();
    };
    const onTrackMuted = (pub: { source?: Track.Source }) => {
      if (pub.source === Track.Source.Microphone) syncLocalTracks();
      if (pub.source === Track.Source.Camera) syncLocalTracks();
      if (pub.source === Track.Source.ScreenShare) {
        syncScreenSharing();
        syncScreenShares();
      }
    };
    const onTrackUnmuted = (pub: { source?: Track.Source }) => {
      if (pub.source === Track.Source.Microphone) syncLocalTracks();
      if (pub.source === Track.Source.Camera) syncLocalTracks();
      if (pub.source === Track.Source.ScreenShare) {
        syncScreenSharing();
        syncScreenShares();
      }
    };
    const onError = (err: Error) => {
      setError(err.message || String(err));
    };

    room
      .on(RoomEvent.ParticipantConnected, onParticipantsChanged)
      .on(RoomEvent.ParticipantDisconnected, onParticipantsChanged)
      .on(RoomEvent.Connected, onConnected)
      .on(RoomEvent.Disconnected, onDisconnected)
      .on(RoomEvent.LocalTrackPublished, onTrackPublished)
      .on(RoomEvent.LocalTrackUnpublished, onTrackUnpublished)
      .on(RoomEvent.TrackMuted, onTrackMuted)
      .on(RoomEvent.TrackUnmuted, onTrackUnmuted)
      .on(RoomEvent.TrackPublished, onTrackUnpublished)
      .on(RoomEvent.TrackUnpublished, onTrackUnpublished)
      .on(RoomEvent.Disconnected, onParticipantsChanged)
      .on(RoomEvent.MediaDevicesError, onError);

    return () => {
      room
        .off(RoomEvent.ParticipantConnected, onParticipantsChanged)
        .off(RoomEvent.ParticipantDisconnected, onParticipantsChanged)
        .off(RoomEvent.Connected, onConnected)
        .off(RoomEvent.Disconnected, onDisconnected)
        .off(RoomEvent.LocalTrackPublished, onTrackPublished)
        .off(RoomEvent.LocalTrackUnpublished, onTrackUnpublished)
        .off(RoomEvent.TrackMuted, onTrackMuted)
        .off(RoomEvent.TrackUnmuted, onTrackUnmuted)
        .off(RoomEvent.TrackPublished, onTrackUnpublished)
        .off(RoomEvent.TrackUnpublished, onTrackUnpublished)
        .off(RoomEvent.MediaDevicesError, onError);
    };
  }, [room, syncLocalTracks, syncScreenSharing, syncScreenShares]);

  const connect = useCallback(
    async ({ url, token }: ConnectOptions) => {
      setStatus("connecting");
      setError(null);
      try {
        await room.connect(url, token, { autoSubscribe: true });
        await room.startAudio();
        // Only the microphone is enabled by default. The camera stays off and
        // its permission is only requested when the user toggles it on.
        await room.localParticipant.setMicrophoneEnabled(true);
        syncLocalTracks();
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [room, syncLocalTracks]
  );

  const disconnect = useCallback(async () => {
    if (isSystemAudioSharing()) {
      await toggleSystemAudioLib(room);
      setSystemAudioSharing(false);
    }
    await room.disconnect();
  }, [room]);

  const toggleCamera = useCallback(async () => {
    const local = room.localParticipant;
    const next = !local.isCameraEnabled;
    try {
      await local.setCameraEnabled(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      syncLocalTracks();
    }
  }, [room, syncLocalTracks]);

  const toggleMicrophone = useCallback(async () => {
    const local = room.localParticipant;
    const next = !local.isMicrophoneEnabled;
    try {
      await local.setMicrophoneEnabled(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      syncLocalTracks();
    }
  }, [room, syncLocalTracks]);

  const stopScreenShare = useCallback(async () => {
    const local = room.localParticipant;
    if (!screenSharingRef.current) return;
    const pub = local.getTrackPublication(Track.Source.ScreenShare);
    // Capture the track before unpublishing: LiveKit clears `publication.track`
    // during `unpublishTrack`, so reading it after the await is undefined.
    const track = pub?.track;
    if (track) {
      await local.unpublishTrack(track);
      track.stop();
    }
    // System audio is only started from the share picker, so stopping the
    // share stops it too.
    if (isSystemAudioSharing()) {
      await stopSystemAudio(room);
      setSystemAudioSharing(false);
    }
  }, [room]);

  /**
   * Start sharing a specific screen/window (chosen in the picker) plus the
   * chosen audio. The Electron main process is told the chosen source id
   * *before* `getDisplayMedia` runs, so its display-media handler resolves to
   * that exact source. Video and audio are kicked off in parallel so the
   * remote side hears audio as soon as the capture pipeline is ready instead
   * of waiting for the screen-share video to finish publishing first.
   */
  const startScreenShare = useCallback(
    async (sourceId: string, choice: SystemAudioChoice) => {
      const local = room.localParticipant;
      if (screenSharingRef.current) await stopScreenShare();

      const applyAudio = async () => {
        const api = getDesktopAPI();
        if (choice.mode === "off") {
          if (isSystemAudioSharing()) {
            await stopSystemAudio(room);
            setSystemAudioSharing(false);
          }
          return;
        }
        if (choice.mode === "app") {
          await api?.systemAudioLinux?.setMode("app", [choice.appId]);
        } else {
          await api?.systemAudioLinux?.setMode("system", []);
        }
        if (!isSystemAudioSharing()) {
          const res = await toggleSystemAudioLib(room);
          setSystemAudioSharing(res.sharing);
          if (res.error) setError(res.error);
        } else {
          setSystemAudioSharing(true);
        }
      };

      try {
        if (isElectron()) {
          await getDesktopAPI()?.screenShare?.setSource(sourceId);
        }
        // No `deviceId` constraint: Chromium rejects `exact` deviceId in
        // `getDisplayMedia`. Electron's handler picks the source selected via
        // the `screen-share:set-source` side-channel above.
        const tracks = await createLocalScreenTracks({ audio: false });
        const videoTrack = tracks.find((t) => t.kind === Track.Kind.Video) ?? tracks[0];
        await Promise.all([
          local.publishTrack(videoTrack, { source: Track.Source.ScreenShare }),
          applyAudio(),
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [room, stopScreenShare]
  );

  const toggleScreenShare = useCallback(async () => {
    if (screenSharingRef.current) {
      await stopScreenShare();
    }
  }, [stopScreenShare]);

  return {
    room,
    status,
    error,
    setError,
    participants,
    cameraEnabled,
    microphoneEnabled,
    screenSharing,
    screenShares,
    systemAudioSharing,
    connect,
    disconnect,
    toggleCamera,
    toggleMicrophone,
    toggleScreenShare,
    startScreenShare,
  };
}

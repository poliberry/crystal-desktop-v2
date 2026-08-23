"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  createLocalScreenTracks,
  type LocalVideoTrack,
  type Participant,
  type RemoteParticipant,
  type RemoteTrackPublication,
} from "livekit-client";

import { useAudioPreferences } from "@/components/audio-provider";
import {
  isSystemAudioSharing,
  stopSystemAudio,
  toggleSystemAudio as toggleSystemAudioLib,
} from "@/lib/system-audio";
import { getDesktopAPI, isElectron } from "@/lib/desktop";
import { applyNoiseSuppression, localMicrophoneTrack } from "@/lib/noise-filter";
import {
  resolveStreamResolution,
  type StreamQuality,
  type SystemAudioChoice,
} from "@/lib/audio-prefs";
import {
  BUILTIN_SOUNDS,
  JOIN_SOUND_TOPIC,
  SOUNDBOARD_TOPIC,
  beginSoundboardActivity,
  findBuiltinSound,
  isPlayableSoundUrl,
  measureSoundDuration,
  playSound,
  resolveJoinSoundUrl,
  SOUNDBOARD_FALLBACK_MS,
  stopAllSounds,
  type JoinSoundPacket,
  type SoundboardClip,
  type SoundboardPacket,
} from "@/lib/soundboard";
import { decodeStreamView, encodeStreamView, STREAM_VIEW_TOPIC } from "@/lib/stream-view";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "disconnected";

export type { SystemAudioChoice };

export interface ConnectOptions {
  url: string;
  token: string;
}

/** Screen-share video/audio publications get their own manual subscription
 * gating (see `useRoom`) so a screen share isn't downloaded until a viewer
 * explicitly clicks "Watch" — unlike mic/camera, which stay auto-subscribed. */
function isScreenShareSource(source: Track.Source | undefined) {
  return (
    source === Track.Source.ScreenShare ||
    source === Track.Source.ScreenShareAudio
  );
}

/** LiveKit wants a concrete device id; our preferences use `""` to mean "let
 * the OS decide", which is spelled `"default"` in `enumerateDevices`. */
function toDeviceId(preferred: string): string {
  return preferred || "default";
}

export function useRoom() {
  const [room] = useState(
    () =>
      new Room({
        adaptiveStream: true,
        dynacast: true,
      })
  );

  const audio = useAudioPreferences();
  const {
    inputDeviceId,
    outputDeviceId,
    muted,
    deafened,
    quality,
    noiseSuppression,
    soundboardVolume,
    setMuted,
    playCue,
  } = audio;

  const [participants, setParticipants] = useState<RemoteParticipant[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenShares, setScreenShares] = useState<string[]>([]);
  const [systemAudioSharing, setSystemAudioSharing] = useState(false);
  /** Source id of the screen/window currently being shared, so the quality
   * and "change screen" controls can re-capture the same target. */
  const [screenShareSourceId, setScreenShareSourceId] = useState<string | null>(null);
  /** Audio currently going out with the share, so the picker can open
   * pre-filled with what's actually live rather than the saved default. */
  const [screenShareAudio, setScreenShareAudioState] = useState<SystemAudioChoice>({ mode: "off" });

  const screenSharingRef = useRef(false);
  const connectedRef = useRef(false);
  const screenShareSourceIdRef = useRef<string | null>(null);

  // Preferences are read inside stable callbacks and event handlers, where a
  // dependency on the live value would mean re-subscribing every change.
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const deafenedRef = useRef(deafened);
  deafenedRef.current = deafened;
  const qualityRef = useRef(quality);
  qualityRef.current = quality;
  const soundboardVolumeRef = useRef(soundboardVolume);
  soundboardVolumeRef.current = soundboardVolume;
  const outputDeviceIdRef = useRef(outputDeviceId);
  outputDeviceIdRef.current = outputDeviceId;
  const noiseSuppressionRef = useRef(noiseSuppression);
  noiseSuppressionRef.current = noiseSuppression;

  /**
   * Play a clip and highlight whoever triggered it for exactly as long as it
   * lasts.
   *
   * A deafened listener doesn't hear the clip, but should still see who
   * played it for the same length of time everyone else does — so the
   * duration is read from the file's metadata instead of from playback.
   */
  const highlightWhilePlaying = useCallback(
    (identity: string, url: string, deafened: boolean) => {
      const end = beginSoundboardActivity(identity);
      if (deafened) {
        void measureSoundDuration(url).then((durationMs) => {
          setTimeout(end, durationMs ?? SOUNDBOARD_FALLBACK_MS);
        });
        return;
      }
      void playSound(url, {
        volume: soundboardVolumeRef.current,
        outputDeviceId: outputDeviceIdRef.current || undefined,
        onEnded: end,
      });
    },
    []
  );

  const syncLocalTracks = useCallback(() => {
    const local = room.localParticipant;
    if (!local) return;
    setCameraEnabled(local.isCameraEnabled);
    setMicrophoneEnabled(local.isMicrophoneEnabled);
  }, [room]);

  /**
   * Bring the live microphone in line with the noise-suppression preference.
   *
   * Called both when the preference changes and whenever a mic track is
   * published, because a track captured while muted (or before the plugin had
   * loaded) arrives without the filter attached.
   */
  const syncNoiseFilter = useCallback(() => {
    void applyNoiseSuppression(localMicrophoneTrack(room), noiseSuppressionRef.current);
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

  /**
   * Deafen is implemented by dropping the *subscription* to every remote
   * microphone rather than zeroing volumes: it actually stops the audio being
   * downloaded and decoded, and it can't be defeated by a component
   * re-attaching a track. Screen-share audio is deliberately untouched —
   * subscribing to that is the "Watch" action's job, and a deafened viewer
   * watching a stream still expects to hear it.
   */
  const applyDeafen = useCallback(() => {
    const isDeafened = deafenedRef.current;
    for (const participant of room.remoteParticipants.values()) {
      for (const pub of participant.trackPublications.values()) {
        if (pub.source !== Track.Source.Microphone) continue;
        (pub as RemoteTrackPublication).setSubscribed(!isDeafened);
      }
    }
  }, [room]);

  useEffect(() => {
    const refreshParticipants = () => {
      setParticipants(Array.from(room.remoteParticipants.values()));
    };
    const onParticipantsChanged = () => {
      refreshParticipants();
      syncScreenShares();
      // Someone joining while we're deafened must not start streaming audio.
      applyDeafen();
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
      setScreenShareSourceId(null);
      screenShareSourceIdRef.current = null;
      setScreenShareAudioState({ mode: "off" });
    };
    const onTrackPublished = () => {
      syncLocalTracks();
      syncScreenSharing();
      syncScreenShares();
      syncNoiseFilter();
    };
    const onTrackUnpublished = () => {
      syncLocalTracks();
      syncScreenSharing();
      syncScreenShares();
    };
    // Screen-share publications default to LiveKit's `autoSubscribe: true`
    // behavior like everything else — immediately override that here so a
    // newly-published remote screen share doesn't start downloading until the
    // viewer explicitly watches it. Remote microphones get the same treatment
    // while deafened.
    const onRemoteTrackPublished = (publication: RemoteTrackPublication) => {
      if (isScreenShareSource(publication.source)) {
        publication.setSubscribed(false);
      } else if (publication.source === Track.Source.Microphone && deafenedRef.current) {
        publication.setSubscribed(false);
      }
    };
    const onTrackMuted = (pub: { source?: Track.Source }) => {
      if (pub.source === Track.Source.Microphone) syncLocalTracks();
      if (pub.source === Track.Source.Camera) syncLocalTracks();
      if (pub.source === Track.Source.ScreenShare) {
        syncScreenSharing();
        syncScreenShares();
      }
    };
    const onTrackUnmuted = onTrackMuted;
    const onError = (err: Error) => {
      setError(err.message || String(err));
    };

    // A soundboard hit travels as a data packet, not an audio track — every
    // participant plays the clip locally at their own volume. Deafened
    // listeners simply don't.
    const onDataReceived = (
      payload: Uint8Array,
      participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string
    ) => {
      if (!participant) return;

      if (topic === JOIN_SOUND_TOPIC) {
        // Someone's arrival chime. Treated exactly like a soundboard press,
        // ring included — from a viewer's side it's the same event: that
        // person made a sound.
        try {
          const join = JSON.parse(new TextDecoder().decode(payload)) as JoinSoundPacket;
          if (join?.kind !== "joinsound") return;
          const joinUrl = resolveJoinSoundUrl(join.soundId, join.url);
          if (joinUrl) {
            highlightWhilePlaying(participant.identity, joinUrl, deafenedRef.current);
          }
        } catch {
          /* malformed packet */
        }
        return;
      }

      if (topic === STREAM_VIEW_TOPIC) {
        // Somebody opened, or closed, the stream we're publishing. Purely a
        // cue for us — nothing about the call changes.
        const view = decodeStreamView(payload);
        if (view) playCue(view.watching ? "viewerJoin" : "viewerLeave");
        return;
      }

      if (topic !== SOUNDBOARD_TOPIC) return;
      let packet: SoundboardPacket;
      try {
        packet = JSON.parse(new TextDecoder().decode(payload)) as SoundboardPacket;
      } catch {
        return;
      }
      if (packet?.kind !== "soundboard") return;
      // Built-ins resolve from the id alone, so a packet can never point us at
      // an arbitrary URL for a clip we already ship.
      const url = findBuiltinSound(packet.soundId)?.url ?? packet.url;
      if (!url || !isPlayableSoundUrl(url)) return;

      highlightWhilePlaying(participant.identity, url, deafenedRef.current);
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
      .on(RoomEvent.TrackPublished, onRemoteTrackPublished)
      .on(RoomEvent.TrackUnpublished, onTrackUnpublished)
      .on(RoomEvent.Disconnected, onParticipantsChanged)
      .on(RoomEvent.DataReceived, onDataReceived)
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
        .off(RoomEvent.TrackPublished, onRemoteTrackPublished)
        .off(RoomEvent.TrackUnpublished, onTrackUnpublished)
        .off(RoomEvent.Disconnected, onParticipantsChanged)
        .off(RoomEvent.DataReceived, onDataReceived)
        .off(RoomEvent.MediaDevicesError, onError);
    };
  }, [
    room,
    applyDeafen,
    highlightWhilePlaying,
    playCue,
    syncLocalTracks,
    syncNoiseFilter,
    syncScreenSharing,
    syncScreenShares,
  ]);

  const connect = useCallback(
    async ({ url, token }: ConnectOptions) => {
      setStatus("connecting");
      setError(null);
      try {
        await room.connect(url, token, { autoSubscribe: true });
        // A screen share already in progress when we join is already present
        // in `remoteParticipants` at this point, but `TrackPublished` only
        // fires for publications that happen *after* we've connected — apply
        // the same "don't auto-download screen shares" gate to those too.
        for (const p of room.remoteParticipants.values()) {
          for (const pub of p.trackPublications.values()) {
            if (isScreenShareSource(pub.source)) pub.setSubscribed(false);
          }
        }
        await room.startAudio();

        // Join with whatever devices and mute state the user has set globally
        // — the mute/deafen buttons in the user card apply outside a call
        // precisely so they decide how you enter the next one.
        await room
          .switchActiveDevice("audioinput", toDeviceId(inputDeviceId))
          .catch(() => {});
        await room
          .switchActiveDevice("audiooutput", toDeviceId(outputDeviceId))
          .catch(() => {});
        applyDeafen();
        // Deafen is a purely local decision, so nothing about the published
        // tracks reveals it — participant attributes are how the rest of the
        // room finds out (see ParticipantTile).
        await room.localParticipant
          .setAttributes({ deafened: deafenedRef.current ? "1" : "0" })
          .catch(() => {});

        // Only the microphone is enabled by default. The camera stays off and
        // its permission is only requested when the user toggles it on.
        //
        // Noise suppression isn't passed as a capture option here: LiveKit
        // attaches capture-time processors inside `createLocalTracks`, before
        // it gives the track an AudioContext, and an audio processor without
        // one throws. Attaching after the track is published works instead —
        // that's what `syncNoiseFilter` does off `LocalTrackPublished`.
        await room.localParticipant.setMicrophoneEnabled(!mutedRef.current);
        syncLocalTracks();
      } catch (err) {
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [room, applyDeafen, inputDeviceId, outputDeviceId, syncLocalTracks]
  );

  const disconnect = useCallback(async () => {
    if (isSystemAudioSharing()) {
      await toggleSystemAudioLib(room);
      setSystemAudioSharing(false);
    }
    await room.disconnect();
  }, [room]);

  // --- live preference application ---------------------------------------

  // Switching the mic mid-call republishes the track on the new device;
  // switching the speaker re-points every attached audio element.
  useEffect(() => {
    if (!connectedRef.current) return;
    void room.switchActiveDevice("audioinput", toDeviceId(inputDeviceId)).catch(() => {});
  }, [room, inputDeviceId]);

  useEffect(() => {
    if (!connectedRef.current) return;
    void room.switchActiveDevice("audiooutput", toDeviceId(outputDeviceId)).catch(() => {});
  }, [room, outputDeviceId]);

  // Toggling this mid-call is instant: the filter stays attached and is
  // bypassed, so nobody hears the track being republished.
  useEffect(() => {
    if (!connectedRef.current) return;
    syncNoiseFilter();
  }, [noiseSuppression, syncNoiseFilter]);

  useEffect(() => {
    if (!connectedRef.current) return;
    room.localParticipant
      .setMicrophoneEnabled(!muted)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(syncLocalTracks);
  }, [room, muted, syncLocalTracks]);

  useEffect(() => {
    applyDeafen();
    // A clip already playing when the user deafens should stop, not finish.
    if (deafened) stopAllSounds();
    if (!connectedRef.current) return;
    void room.localParticipant
      .setAttributes({ deafened: deafened ? "1" : "0" })
      .catch(() => {});
  }, [room, applyDeafen, deafened]);

  // --- local media -------------------------------------------------------

  const toggleCamera = useCallback(async () => {
    const local = room.localParticipant;
    const next = !local.isCameraEnabled;
    try {
      await local.setCameraEnabled(next);
      playCue(next ? "cameraOn" : "cameraOff");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      syncLocalTracks();
    }
  }, [room, syncLocalTracks, playCue]);

  /** Flips the *global* mute preference; the effect above applies it to the
   * room. Keeping one source of truth is what lets the user-card buttons work
   * identically in and out of a call. */
  const toggleMicrophone = useCallback(() => {
    setMuted(!mutedRef.current);
  }, [setMuted]);

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
    screenSharingRef.current = false;
    screenShareSourceIdRef.current = null;
    setScreenShareSourceId(null);
    setScreenShareAudioState({ mode: "off" });
    playCue("screenShareStop");
  }, [room, playCue]);

  /**
   * Capture `sourceId` at `quality` and publish it as the screen-share video,
   * replacing any existing one. The Electron main process is told the chosen
   * source id *before* `getDisplayMedia` runs, so its display-media handler
   * resolves to that exact source.
   */
  const publishScreenVideo = useCallback(
    async (sourceId: string, streamQuality: StreamQuality) => {
      const local = room.localParticipant;

      if (isElectron()) {
        await getDesktopAPI()?.screenShare?.setSource(sourceId);
      }

      // Drop the outgoing track first: LiveKit allows only one publication per
      // source, so publishing the replacement before unpublishing the old one
      // would be rejected.
      const existing = local.getTrackPublication(Track.Source.ScreenShare)?.track;
      if (existing) {
        await local.unpublishTrack(existing);
        existing.stop();
      }

      // No `deviceId` constraint: Chromium rejects `exact` deviceId in
      // `getDisplayMedia`. Electron's handler picks the source selected via
      // the `screen-share:set-source` side-channel above.
      const tracks = await createLocalScreenTracks({
        audio: false,
        resolution: resolveStreamResolution(streamQuality),
      });
      const videoTrack =
        (tracks.find((t) => t.kind === Track.Kind.Video) as LocalVideoTrack | undefined) ??
        tracks[0];
      await local.publishTrack(videoTrack, { source: Track.Source.ScreenShare });

      screenShareSourceIdRef.current = sourceId;
      setScreenShareSourceId(sourceId);
    },
    [room]
  );

  /**
   * Apply an audio choice to the *current* share without touching the video.
   * On Linux the capture backend can be re-targeted live (`setMode` reconciles
   * which apps are duplicate-linked into the virtual sink), so switching
   * between system audio and a specific app — or between two apps — never
   * interrupts the stream.
   */
  const setScreenShareAudio = useCallback(
    async (choice: SystemAudioChoice) => {
      const api = getDesktopAPI();
      try {
        if (choice.mode === "off") {
          if (isSystemAudioSharing()) {
            await stopSystemAudio(room);
            setSystemAudioSharing(false);
          }
          setScreenShareAudioState(choice);
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
        setScreenShareAudioState(choice);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [room]
  );

  /** Start (or restart) a screen share with the given source and audio. */
  const startScreenShare = useCallback(
    async (sourceId: string, choice: SystemAudioChoice) => {
      try {
        // Video and audio are kicked off in parallel so the remote side hears
        // audio as soon as the capture pipeline is ready instead of waiting
        // for the screen-share video to finish publishing first.
        await Promise.all([
          publishScreenVideo(sourceId, qualityRef.current),
          setScreenShareAudio(choice),
        ]);
        playCue("screenShareStart");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [publishScreenVideo, setScreenShareAudio, playCue]
  );

  /** Swap which screen/window is being shared, keeping audio as-is. */
  const changeScreenShareSource = useCallback(
    async (sourceId: string) => {
      if (!screenSharingRef.current) return;
      try {
        await publishScreenVideo(sourceId, qualityRef.current);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [publishScreenVideo]
  );

  // Changing the quality preference has to re-capture, since the constraints
  // are baked into the display-media request — but only while actually
  // sharing; otherwise the new value just applies to the next share.
  // Deliberately keyed on the two primitive fields rather than the "quality"
  // object, whose identity also changes when preferences are re-read after a
  // *different* setting is edited in the Settings window.
  const { resolution, frameRate } = quality;
  useEffect(() => {
    const sourceId = screenShareSourceIdRef.current;
    if (!screenSharingRef.current || !sourceId) return;
    void publishScreenVideo(sourceId, { resolution, frameRate }).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [publishScreenVideo, resolution, frameRate]);

  const toggleScreenShare = useCallback(async () => {
    if (screenSharingRef.current) {
      await stopScreenShare();
    }
  }, [stopScreenShare]);

  // --- soundboard --------------------------------------------------------

  /**
   * Broadcast a soundboard clip to everyone in the call and play it locally.
   * Outside a call it still plays locally, which is what makes the picker's
   * preview work.
   */
  const playSoundboardClip = useCallback(
    async (clip: SoundboardClip) => {
      if (connectedRef.current) {
        const packet: SoundboardPacket = {
          kind: "soundboard",
          soundId: clip.id,
          name: clip.name,
          ...(clip.builtin ? {} : { url: clip.url }),
        };
        const payload = new TextEncoder().encode(JSON.stringify(packet));
        await room.localParticipant
          .publishData(payload, { reliable: true, topic: SOUNDBOARD_TOPIC })
          .catch((err: unknown) => {
            setError(err instanceof Error ? err.message : String(err));
          });
      }
      // The SFU doesn't echo a packet back to its sender, so this covers both
      // playing the clip and highlighting ourselves.
      highlightWhilePlaying(room.localParticipant.identity, clip.url, deafenedRef.current);
    },
    [room, highlightWhilePlaying]
  );

  /**
   * Announce this user's join sound to everyone already in the room.
   *
   * Broadcast by the joiner rather than looked up by each listener: the
   * choice can point at a clip from any server, and the joiner is the only
   * one guaranteed to be able to resolve it. Late arrivals don't receive it,
   * which is correct — you don't hear the chime of someone who was already
   * there.
   */
  /**
   * Tell a streamer we've started (or stopped) watching them.
   *
   * Addressed to that one participant — see src/lib/stream-view.ts for why the
   * viewer has to volunteer this rather than the publisher observing it. Never
   * sent to ourselves: watching your own preview is not an audience.
   */
  const notifyStreamView = useCallback(
    async (publisherIdentity: string, watching: boolean) => {
      if (!connectedRef.current) return;
      if (publisherIdentity === room.localParticipant.identity) return;
      await room.localParticipant
        .publishData(encodeStreamView(watching), {
          reliable: true,
          topic: STREAM_VIEW_TOPIC,
          destinationIdentities: [publisherIdentity],
        })
        // Deliberately swallowed: failing to tell someone you're watching is
        // not a reason to fail to watch.
        .catch(() => {});
    },
    [room]
  );

  const broadcastJoinSound = useCallback(
    async (soundId: string, url?: string) => {
      if (!connectedRef.current) return;

      // Play locally first, and independently of the publish below. The SFU
      // doesn't echo a packet back to its sender, so this is the only way the
      // joiner hears their own sound and sees their own ring — and doing it
      // before the await means a slow or failed publish can't swallow it.
      const resolved = resolveJoinSoundUrl(soundId, url);
      if (resolved) {
        highlightWhilePlaying(room.localParticipant.identity, resolved, deafenedRef.current);
      }

      const packet: JoinSoundPacket = { kind: "joinsound", soundId, ...(url ? { url } : {}) };
      await room.localParticipant
        .publishData(new TextEncoder().encode(JSON.stringify(packet)), {
          reliable: true,
          topic: JOIN_SOUND_TOPIC,
        })
        .catch(() => {});
    },
    [room, highlightWhilePlaying]
  );

  // --- remote screen-share subscriptions ---------------------------------

  /** Moves a remote participant's screen-share video + audio publications to
   * the given subscription state together, as one "watch" action. */
  const setScreenShareSubscribed = useCallback(
    (participantIdentity: string, subscribed: boolean) => {
      const participant: Participant | undefined =
        room.getParticipantByIdentity(participantIdentity);
      if (!participant || participant === room.localParticipant) return;
      for (const pub of participant.trackPublications.values()) {
        if (isScreenShareSource(pub.source)) {
          (pub as RemoteTrackPublication).setSubscribed(subscribed);
        }
      }
    },
    [room]
  );

  const subscribeToScreenShare = useCallback(
    (participantIdentity: string) =>
      setScreenShareSubscribed(participantIdentity, true),
    [setScreenShareSubscribed]
  );

  const unsubscribeFromScreenShare = useCallback(
    (participantIdentity: string) =>
      setScreenShareSubscribed(participantIdentity, false),
    [setScreenShareSubscribed]
  );

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
    screenShareSourceId,
    screenShareAudio,
    systemAudioSharing,
    builtinSounds: BUILTIN_SOUNDS,
    connect,
    disconnect,
    toggleCamera,
    toggleMicrophone,
    toggleScreenShare,
    startScreenShare,
    changeScreenShareSource,
    setScreenShareAudio,
    playSoundboardClip,
    broadcastJoinSound,
    notifyStreamView,
    subscribeToScreenShare,
    unsubscribeFromScreenShare,
  };
}

export type RoomController = ReturnType<typeof useRoom>;

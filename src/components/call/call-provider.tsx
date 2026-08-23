"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useAudioPreferences } from "@/components/audio-provider";
import { IncomingCall } from "@/components/call/incoming-call";
import { ScreenSharePicker } from "@/components/screen-share-picker";
import { usePipFrameStream } from "@/hooks/use-pip-frame-stream";
import { usePipWindow } from "@/hooks/use-pip-window";
import { useRoom, type RoomController } from "@/hooks/use-room";
import { useStreamThumbnail } from "@/hooks/use-stream-thumbnail";
import type { SystemAudioChoice } from "@/lib/audio-prefs";

export type ActiveCall =
  | { kind: "dm"; conversationId: Id<"conversations">; roomName: string }
  | { kind: "channel"; channelId: Id<"channels">; communityId: Id<"communities">; roomName: string };

/** Which of a participant's videos something is showing. */
export type CallVideoKind = "screen" | "camera";

/** What the pop-out window is currently showing. */
export interface PoppedOutSource {
  identity: string;
  kind: CallVideoKind;
}

interface CallContextValue {
  controller: RoomController;
  activeCall: ActiveCall | null;
  /** Whether the full call screen is currently the focused content, vs. just
   * the persistent mini bar while the user browses elsewhere. */
  expanded: boolean;
  /** `ring` (default true) rings the other members. Holding Shift on the
   * call button skips it and just connects. */
  joinDmCall: (conversationId: Id<"conversations">, options?: { ring?: boolean }) => Promise<void>;
  /** `watchIdentity` asks the call UI to open that participant's screen share
   * as soon as it appears — used by the activity feed's "join and watch". */
  joinChannelCall: (
    channelId: Id<"channels">,
    communityId: Id<"communities">,
    options?: { watchIdentity?: string }
  ) => Promise<void>;
  /** Whose share to open on arrival, consumed once by the call UI. */
  watchIntent: string | null;
  clearWatchIntent: () => void;
  leaveCall: () => Promise<void>;
  expand: () => void;
  collapse: () => void;
  /** Display name of the currently-shared screen/window, if any — read by the
   * "Sharing" indicator above the mini call bar (user-card.tsx), so it's
   * visible even when the full call screen isn't. */
  sharedSourceName: string | null;
  /** Opens the source picker and starts a share on selection — lives here
   * (not in room-view.tsx) so the mini call bar's "Share screen" button
   * works without first expanding to the full call screen. */
  openSharePicker: () => void;
  /** Re-opens the same picker against a share that's already running, so the
   * screen, audio source and quality can each be changed in place. */
  openShareSettings: () => void;
  /** Set when joinDmCall/joinChannelCall fails before a call is ever
   * established — activeCall stays null in that case, so CallStage never
   * mounts to show it; whatever called join is responsible for rendering
   * this (see home-layout.tsx). */
  joinError: string | null;
  dismissJoinError: () => void;
  /**
   * Identities whose screen share we're subscribed to.
   *
   * Lifted out of `CallGrid` (where it used to be local state) because the
   * mini player has to show and stop watching streams while the full call
   * screen is collapsed — and because "what am I watching" outliving the view
   * that happens to be drawing it is the honest model.
   */
  watchedShares: string[];
  /** `replace` drops every other watched stream, which is what the tile's
   * "Watch" does; without it the stream is added alongside them ("Add"). */
  watchShare: (identity: string, options?: { replace?: boolean }) => void;
  unwatchShare: (identity: string) => void;
  /** What the pop-out window is showing, or null when it's closed. */
  poppedOut: PoppedOutSource | null;
  /** False in a browser, where there's no second window to open. */
  popOutSupported: boolean;
  popOut: (source: PoppedOutSource & { title: string }) => Promise<void>;
  closePopOut: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

function sameCall(a: ActiveCall, kind: "dm", id: Id<"conversations">): boolean;
function sameCall(a: ActiveCall, kind: "channel", id: Id<"channels">): boolean;
function sameCall(a: ActiveCall, kind: "dm" | "channel", id: string): boolean {
  if (a.kind !== kind) return false;
  return a.kind === "dm" ? a.conversationId === id : a.channelId === id;
}

/**
 * Owns the single LiveKit `Room` instance for the whole app (main window
 * only — mounted around `HomeLayout`, not in the root layout, so the
 * Settings window never opens a call of its own). Because the room lives
 * here instead of inside whatever view happens to be showing it, navigating
 * to another conversation, the friends list, or a different community no
 * longer disconnects the call — it just collapses the full call screen back
 * to the mini bar (see the "Voice Connected" section of
 * `src/components/home/user-card.tsx`). The call only actually ends via
 * `leaveCall()`, an explicit action.
 *
 * Handles both DM calls and community voice channels through the same
 * single-active-call model (you can only be in one call at a time, like
 * Discord) — `joinDmCall`/`joinChannelCall` both leave whatever's currently
 * active before joining the new one.
 */
export function CallProvider({ children }: { children: React.ReactNode }) {
  const controller = useRoom();
  const { status, connect, disconnect, screenSharing } = controller;
  const joinDmAction = useAction(api.callTokens.join);
  const leaveDmAction = useAction(api.callTokens.leave);
  const joinChannelAction = useAction(api.channelCalls.join);
  const leaveChannelAction = useAction(api.channelCalls.leave);
  const setVoiceState = useMutation(api.channels.setVoiceState);
  const ringConversation = useMutation(api.calls.ring);
  const cancelRings = useMutation(api.calls.cancelRings);
  const { muted, deafened, setMuted, setDeafened, playCue } = useAudioPreferences();

  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [sharedSourceName, setSharedSourceName] = useState<string | null>(null);
  const [sharePickerOpen, setSharePickerOpen] = useState(false);
  // "change" reuses the picker against the live share rather than starting a
  // new one — see `handleShare` below.
  const [sharePickerMode, setSharePickerMode] = useState<"start" | "change">("start");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [watchIntent, setWatchIntent] = useState<string | null>(null);
  const [watchedShares, setWatchedShares] = useState<string[]>([]);
  const [poppedOut, setPoppedOut] = useState<PoppedOutSource | null>(null);
  const activeCallRef = useRef<ActiveCall | null>(null);
  activeCallRef.current = activeCall;

  const { screenShares, subscribeToScreenShare, unsubscribeFromScreenShare, notifyStreamView } =
    controller;

  const watchShare = useCallback(
    (identity: string, options?: { replace?: boolean }) => {
      if (options?.replace) {
        // "Watch" replaces the whole watch set — unsubscribe whichever streams
        // are being dropped so they stop being downloaded and decoded.
        for (const other of watchedShares) {
          if (other !== identity) {
            unsubscribeFromScreenShare(other);
            void notifyStreamView(other, false);
          }
        }
        setWatchedShares([identity]);
      } else {
        setWatchedShares((prev) => (prev.includes(identity) ? prev : [...prev, identity]));
      }
      subscribeToScreenShare(identity);
      // Only on a genuine change: re-clicking a stream you're already watching
      // shouldn't chime at the person streaming it again.
      if (!watchedShares.includes(identity)) void notifyStreamView(identity, true);
    },
    [watchedShares, subscribeToScreenShare, unsubscribeFromScreenShare, notifyStreamView]
  );

  const unwatchShare = useCallback(
    (identity: string) => {
      setWatchedShares((prev) => prev.filter((i) => i !== identity));
      unsubscribeFromScreenShare(identity);
      void notifyStreamView(identity, false);
    },
    [unsubscribeFromScreenShare, notifyStreamView]
  );

  /**
   * The screen-share chime, for other people's shares.
   *
   * `use-room.ts` already plays this pair for your own share, at the moment you
   * start or stop it. Everyone else's arrives as a change to `screenShares`,
   * which is the only signal a viewer gets — so it's diffed here rather than
   * hooked to a LiveKit event, which would also fire for track republishes
   * (a quality change re-publishes the track) and chime for nothing.
   *
   * Seeded on the first run instead of chiming: walking into a call where two
   * people are already sharing is not two people starting to share.
   */
  const knownSharesRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const remote = new Set(
      screenShares.filter((identity) => identity !== controller.room.localParticipant.identity)
    );
    const known = knownSharesRef.current;
    knownSharesRef.current = remote;
    if (!known) return;

    for (const identity of remote) if (!known.has(identity)) playCue("screenShareStart");
    for (const identity of known) if (!remote.has(identity)) playCue("screenShareStop");
  }, [screenShares, controller.room, playCue]);

  // Leaving a call has to forget who was sharing in it, or rejoining would
  // diff against the last call's roster.
  useEffect(() => {
    if (!activeCall) knownSharesRef.current = null;
  }, [activeCall]);

  // A share that ends (they stopped sharing, or left) drops out of the watch
  // set, so a later re-share starts unwatched rather than silently resuming.
  useEffect(() => {
    const stale = watchedShares.filter((identity) => !screenShares.includes(identity));
    if (stale.length === 0) return;
    for (const identity of stale) unsubscribeFromScreenShare(identity);
    setWatchedShares((prev) => prev.filter((identity) => screenShares.includes(identity)));
  }, [watchedShares, screenShares, unsubscribeFromScreenShare]);

  // --- pop-out window ------------------------------------------------------
  // Owned here rather than by whichever tile happens to be on screen: the mini
  // player and the focused tile both pop things out, and a per-component
  // `usePipWindow` would close the window the moment that component unmounted
  // — i.e. clicking the mini player to open the call would kill the pop-out it
  // had just created.
  const pip = usePipWindow();

  const popOut = useCallback(
    async (source: PoppedOutSource & { title: string }) => {
      const opened = await pip.open({ title: source.title, width: 480, height: 270 });
      if (opened) setPoppedOut({ identity: source.identity, kind: source.kind });
    },
    [pip]
  );

  const closePopOut = useCallback(() => {
    pip.close();
    setPoppedOut(null);
  }, [pip]);

  // The window has its own close button, so "is it open" is not ours to assume.
  useEffect(() => {
    if (!pip.isOpen) setPoppedOut(null);
  }, [pip.isOpen]);

  const poppedOutParticipant =
    poppedOut === null
      ? null
      : poppedOut.identity === controller.room.localParticipant.identity
        ? controller.room.localParticipant
        : (controller.participants.find((p) => p.identity === poppedOut.identity) ?? null);

  // Nothing left to show — the participant left, or stopped sharing what was
  // popped out. Better to close the window than leave a frozen last frame in it.
  useEffect(() => {
    if (!poppedOut) return;
    const gone =
      !poppedOutParticipant ||
      (poppedOut.kind === "screen" && !screenShares.includes(poppedOut.identity));
    if (gone) closePopOut();
  }, [poppedOut, poppedOutParticipant, screenShares, closePopOut]);

  usePipFrameStream({
    participant: poppedOutParticipant,
    kind: poppedOut?.kind ?? "camera",
    enabled: !!poppedOut,
    size: pip.size,
    sendFrame: pip.sendFrame,
  });

  const joinSound = useQuery(
    api.soundboard.myJoinSound,
    activeCall?.kind === "channel" ? { communityId: activeCall.communityId } : {}
  );
  // Keyed on the room so switching calls re-announces, but reconnecting
  // within one doesn't chime twice.
  const announcedForRoom = useRef<string | null>(null);

  // Bumped whenever the user navigates away (collapse) or a new join
  // starts, so an in-flight joinDmCall/joinChannelCall can tell it's been
  // superseded/abandoned by the time it resolves and avoid clobbering
  // whatever's on screen now.
  const joinGenerationRef = useRef(0);

  const leaveActiveCall = useCallback(async () => {
    const current = activeCallRef.current;
    if (!current) return;
    await disconnect();
    if (current.kind === "dm") {
      await leaveDmAction({ conversationId: current.conversationId }).catch(() => {});
      // An abandoned call shouldn't keep ringing people.
      await cancelRings({ conversationId: current.conversationId }).catch(() => {});
    } else {
      await leaveChannelAction({ channelId: current.channelId }).catch(() => {});
    }
    setActiveCall(null);
    setSharedSourceName(null);
    // Cleared so rejoining this same room chimes again; without it the ref
    // still holds the room name from the first join.
    announcedForRoom.current = null;
    playCue("callLeave");
  }, [disconnect, leaveDmAction, leaveChannelAction, playCue, cancelRings]);

  const joinDmCall = useCallback(
    async (conversationId: Id<"conversations">, options?: { ring?: boolean }) => {
      if (activeCallRef.current && sameCall(activeCallRef.current, "dm", conversationId)) {
        setExpanded(true);
        return;
      }

      const myGeneration = ++joinGenerationRef.current;
      setJoinError(null);
      if (activeCallRef.current) await leaveActiveCall();

      try {
        const { url, token, roomName } = await joinDmAction({ conversationId });
        await connect({ url, token });

        if (joinGenerationRef.current !== myGeneration) {
          // Superseded (navigated away, or a different join started) while
          // we were connecting — leave immediately instead of surfacing a
          // call for something the user's no longer looking at.
          await disconnect();
          await leaveDmAction({ conversationId }).catch(() => {});
          return;
        }

        setActiveCall({ kind: "dm", conversationId, roomName });
        setExpanded(true);
        playCue("callJoin");
        // Ring after connecting, so a recipient who answers instantly finds
        // someone already in the room.
        if (options?.ring !== false) {
          void ringConversation({ conversationId }).catch(() => {});
        }
      } catch (err) {
        await disconnect();
        await leaveDmAction({ conversationId }).catch(() => {});
        if (joinGenerationRef.current === myGeneration) {
          setJoinError(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [connect, disconnect, joinDmAction, leaveActiveCall, leaveDmAction, playCue, ringConversation]
  );

  const joinChannelCall = useCallback(
    async (
      channelId: Id<"channels">,
      communityId: Id<"communities">,
      options?: { watchIdentity?: string }
    ) => {
      // Set before the early return: asking to watch someone in a call you're
      // already in should still open their share.
      if (options?.watchIdentity) setWatchIntent(options.watchIdentity);
      if (activeCallRef.current && sameCall(activeCallRef.current, "channel", channelId)) {
        setExpanded(true);
        return;
      }

      const myGeneration = ++joinGenerationRef.current;
      setJoinError(null);
      if (activeCallRef.current) await leaveActiveCall();

      try {
        const { url, token, roomName } = await joinChannelAction({ channelId });
        await connect({ url, token });

        if (joinGenerationRef.current !== myGeneration) {
          await disconnect();
          await leaveChannelAction({ channelId }).catch(() => {});
          return;
        }

        setActiveCall({ kind: "channel", channelId, communityId, roomName });
        setExpanded(true);
        playCue("callJoin");
      } catch (err) {
        await disconnect();
        await leaveChannelAction({ channelId }).catch(() => {});
        if (joinGenerationRef.current === myGeneration) {
          setJoinError(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [connect, disconnect, joinChannelAction, leaveActiveCall, leaveChannelAction, playCue]
  );

  const leaveCall = useCallback(async () => {
    await leaveActiveCall();
    setExpanded(false);
  }, [leaveActiveCall]);

  // Safety net: if LiveKit drops the connection for any reason other than an
  // explicit leaveCall() (network blip, server-side kick), reflect that here
  // instead of getting stuck showing a call that isn't actually connected.
  useEffect(() => {
    if (status === "disconnected" && activeCallRef.current) {
      const current = activeCallRef.current;
      setActiveCall(null);
      setExpanded(false);
      if (current.kind === "dm") {
        void leaveDmAction({ conversationId: current.conversationId }).catch(() => {});
      } else {
        void leaveChannelAction({ channelId: current.channelId }).catch(() => {});
      }
    }
  }, [status, leaveDmAction, leaveChannelAction]);

  // Mirror the live call state onto the Convex participant row so the voice
  // channel list can show mute / deafen / streaming badges to people who
  // aren't in this call — LiveKit only reports on rooms you're connected to.
  // DM calls have no such list, so they're skipped.
  const me = useQuery(api.users.getCurrentUser);
  useEffect(() => {
    if (activeCall?.kind !== "channel" || status !== "connected") return;
    void setVoiceState({
      channelId: activeCall.channelId,
      muted,
      deafened,
      streaming: screenSharing,
    }).catch(() => {});
  }, [activeCall, status, muted, deafened, screenSharing, setVoiceState]);

  // Publish stills of my own share alongside that state, so the voice channel
  // list and the activity feed can show what's on it — see useStreamThumbnail.
  useStreamThumbnail(
    controller.room,
    activeCall?.kind === "channel" ? activeCall.channelId : null,
    screenSharing && status === "connected"
  );

  // --- moderation, applied to ourselves -----------------------------------
  // Server mute/deafen and disconnect are recorded on our own participant row
  // and enforced here rather than at the SFU. Reading it back means the state
  // survives a reconnect, and a row that disappears is how a disconnect (or a
  // kick/ban/timeout that removes us) reaches this client.
  const voiceRoster = useQuery(
    api.channels.listVoiceParticipants,
    activeCall?.kind === "channel" ? { channelId: activeCall.channelId } : "skip"
  );
  const myVoiceRow = voiceRoster?.find((p) => p.id === me?._id);

  useEffect(() => {
    if (activeCall?.kind !== "channel" || status !== "connected") return;
    if (!voiceRoster || !me) return;

    if (!myVoiceRow) {
      void leaveCall();
      return;
    }
    if (myVoiceRow.serverMuted && !muted) setMuted(true);
    if (myVoiceRow.serverDeafened && !deafened) setDeafened(true);
  }, [activeCall, status, voiceRoster, myVoiceRow, me, muted, deafened, setMuted, setDeafened, leaveCall]);

  useEffect(() => {
    if (!activeCall || status !== "connected" || joinSound === undefined) return;
    if (announcedForRoom.current === activeCall.roomName) return;
    announcedForRoom.current = activeCall.roomName;
    if (joinSound) {
      void controller.broadcastJoinSound(joinSound.soundId, joinSound.soundUrl ?? undefined);
    }
  }, [activeCall, status, joinSound, controller]);

  const expand = useCallback(() => setExpanded(true), []);
  const collapse = useCallback(() => {
    joinGenerationRef.current++;
    setExpanded(false);
  }, []);
  const dismissJoinError = useCallback(() => setJoinError(null), []);

  // Unmounting (e.g. signing out) would otherwise leave the LiveKit Room
  // connected — local mic/camera still active — and the participant row
  // stale. Reads activeCallRef at unmount time deliberately; disconnect/
  // leaveDmAction/leaveChannelAction are stable across renders.
  useEffect(() => {
    return () => {
      const current = activeCallRef.current;
      if (!current) return;
      void disconnect();
      if (current.kind === "dm") {
        void leaveDmAction({ conversationId: current.conversationId }).catch(() => {});
      } else {
        void leaveChannelAction({ channelId: current.channelId }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guards handleShare's post-await setSharedSourceName below against a
  // share that's already ended by the time startScreenShare resolves (OS
  // stopped it, user toggled off, track ended on its own) — bumped both here
  // and at the start of every handleShare call, so a stale continuation can
  // tell it's no longer the current attempt and skip resurrecting the name.
  const shareAttemptIdRef = useRef(0);

  // Covers every way sharing can stop (ControlBar toggle, source picker
  // cancel, track ending on its own) — not just leaveCall().
  useEffect(() => {
    if (!screenSharing) {
      setSharedSourceName(null);
      shareAttemptIdRef.current++;
    }
  }, [screenSharing]);

  const openSharePicker = useCallback(() => {
    setSharePickerMode("start");
    setSharePickerOpen(true);
  }, []);

  const openShareSettings = useCallback(() => {
    setSharePickerMode("change");
    setSharePickerOpen(true);
  }, []);

  const handleShare = useCallback(
    async (sourceId: string, sourceName: string, audio: SystemAudioChoice) => {
      const changing = sharePickerMode === "change" && controller.screenSharing;
      setSharePickerOpen(false);
      const attemptId = ++shareAttemptIdRef.current;
      try {
        if (changing) {
          // Apply only what actually differs: re-capturing video for an
          // audio-only change would blink the stream for every viewer, and
          // re-applying the same audio would tear down and rebuild the
          // capture pipeline for nothing.
          if (sourceId !== controller.screenShareSourceId) {
            await controller.changeScreenShareSource(sourceId);
          }
          const current = controller.screenShareAudio;
          const audioChanged =
            current.mode !== audio.mode ||
            (audio.mode === "app" && current.mode === "app" && current.appId !== audio.appId);
          if (audioChanged) await controller.setScreenShareAudio(audio);
        } else {
          await controller.startScreenShare(sourceId, audio);
        }
        if (shareAttemptIdRef.current === attemptId) setSharedSourceName(sourceName);
      } catch {
        // error surfaced via controller.error
      }
    },
    [controller, sharePickerMode]
  );

  return (
    <CallContext.Provider
      value={{
        controller,
        activeCall,
        expanded,
        joinDmCall,
        joinChannelCall,
        watchIntent,
        clearWatchIntent: () => setWatchIntent(null),
        leaveCall,
        expand,
        collapse,
        sharedSourceName,
        openSharePicker,
        openShareSettings,
        joinError,
        dismissJoinError,
        watchedShares,
        watchShare,
        unwatchShare,
        poppedOut,
        popOutSupported: pip.isSupported,
        popOut,
        closePopOut,
      }}
    >
      {children}
      <IncomingCall />
      <ScreenSharePicker
        open={sharePickerOpen}
        onOpenChange={setSharePickerOpen}
        mode={sharePickerMode}
        currentSourceId={controller.screenShareSourceId}
        currentAudio={controller.screenShareAudio}
        onShare={(sourceId, sourceName, audio) => void handleShare(sourceId, sourceName, audio)}
      />
    </CallContext.Provider>
  );
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within <CallProvider>");
  return ctx;
}

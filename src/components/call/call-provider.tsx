"use client";

import { useAction } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ScreenSharePicker } from "@/components/screen-share-picker";
import { useRoom, type RoomController, type SystemAudioChoice } from "@/hooks/use-room";

export type ActiveCall =
  | { kind: "dm"; conversationId: Id<"conversations">; roomName: string }
  | { kind: "channel"; channelId: Id<"channels">; communityId: Id<"communities">; roomName: string };

interface CallContextValue {
  controller: RoomController;
  activeCall: ActiveCall | null;
  /** Whether the full call screen is currently the focused content, vs. just
   * the persistent mini bar while the user browses elsewhere. */
  expanded: boolean;
  joinDmCall: (conversationId: Id<"conversations">) => Promise<void>;
  joinChannelCall: (channelId: Id<"channels">, communityId: Id<"communities">) => Promise<void>;
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
  /** Set when joinDmCall/joinChannelCall fails before a call is ever
   * established — activeCall stays null in that case, so CallStage never
   * mounts to show it; whatever called join is responsible for rendering
   * this (see home-layout.tsx). */
  joinError: string | null;
  dismissJoinError: () => void;
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

  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [sharedSourceName, setSharedSourceName] = useState<string | null>(null);
  const [sharePickerOpen, setSharePickerOpen] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const activeCallRef = useRef<ActiveCall | null>(null);
  activeCallRef.current = activeCall;

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
    } else {
      await leaveChannelAction({ channelId: current.channelId }).catch(() => {});
    }
    setActiveCall(null);
    setSharedSourceName(null);
  }, [disconnect, leaveDmAction, leaveChannelAction]);

  const joinDmCall = useCallback(
    async (conversationId: Id<"conversations">) => {
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
      } catch (err) {
        await disconnect();
        await leaveDmAction({ conversationId }).catch(() => {});
        if (joinGenerationRef.current === myGeneration) {
          setJoinError(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [connect, disconnect, joinDmAction, leaveActiveCall, leaveDmAction]
  );

  const joinChannelCall = useCallback(
    async (channelId: Id<"channels">, communityId: Id<"communities">) => {
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
      } catch (err) {
        await disconnect();
        await leaveChannelAction({ channelId }).catch(() => {});
        if (joinGenerationRef.current === myGeneration) {
          setJoinError(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [connect, disconnect, joinChannelAction, leaveActiveCall, leaveChannelAction]
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

  const openSharePicker = useCallback(() => setSharePickerOpen(true), []);

  const handleShare = useCallback(
    async (sourceId: string, sourceName: string, audio: SystemAudioChoice) => {
      setSharePickerOpen(false);
      const attemptId = ++shareAttemptIdRef.current;
      try {
        await controller.startScreenShare(sourceId, audio);
        if (shareAttemptIdRef.current === attemptId) setSharedSourceName(sourceName);
      } catch {
        // error surfaced via controller.error
      }
    },
    [controller]
  );

  return (
    <CallContext.Provider
      value={{
        controller,
        activeCall,
        expanded,
        joinDmCall,
        joinChannelCall,
        leaveCall,
        expand,
        collapse,
        sharedSourceName,
        openSharePicker,
        joinError,
        dismissJoinError,
      }}
    >
      {children}
      <ScreenSharePicker
        open={sharePickerOpen}
        onOpenChange={setSharePickerOpen}
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

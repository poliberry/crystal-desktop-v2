"use client";

import { useAction, useMutation } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useRoom, type RoomController } from "@/hooks/use-room";

interface ActiveCall {
  conversationId: Id<"conversations">;
  roomName: string;
}

interface CallContextValue {
  controller: RoomController;
  activeCall: ActiveCall | null;
  /** Whether the full call screen is currently the focused content, vs. just
   * the persistent mini bar while the user browses elsewhere. */
  expanded: boolean;
  joinCall: (conversationId: Id<"conversations">) => Promise<void>;
  leaveCall: () => Promise<void>;
  expand: () => void;
  collapse: () => void;
  /** Set when `joinCall` fails before a call is ever established — `activeCall`
   * stays null in that case, so `CallStage` never mounts to show it; whatever
   * called `joinCall` (see home-layout.tsx) is responsible for rendering it. */
  joinError: string | null;
  dismissJoinError: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

/**
 * Owns the single LiveKit `Room` instance for the whole app (main window
 * only — mounted around `HomeLayout`, not in the root layout, so the
 * Settings window never opens a call of its own). Because the room lives
 * here instead of inside whatever view happens to be showing it, navigating
 * to another conversation or the friends list no longer disconnects the
 * call — it just collapses the full call screen back to the mini bar
 * (see `src/components/home/call-mini-bar.tsx`). The call only actually
 * ends via `leaveCall()`, an explicit action.
 */
export function CallProvider({ children }: { children: React.ReactNode }) {
  const controller = useRoom();
  const { status, connect, disconnect } = controller;
  const joinCallAction = useAction(api.callTokens.join);
  const leaveCallMutation = useMutation(api.calls.leave);

  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const activeCallRef = useRef<ActiveCall | null>(null);
  activeCallRef.current = activeCall;

  // Bumped whenever the user navigates away (collapse) or a new joinCall
  // starts, so an in-flight joinCall can tell it's been superseded/abandoned
  // by the time it resolves and avoid clobbering whatever's on screen now.
  const joinGenerationRef = useRef(0);

  const joinCall = useCallback(
    async (conversationId: Id<"conversations">) => {
      if (activeCallRef.current?.conversationId === conversationId) {
        setExpanded(true);
        return;
      }

      const myGeneration = ++joinGenerationRef.current;
      setJoinError(null);

      if (activeCallRef.current) {
        const previous = activeCallRef.current;
        await disconnect();
        await leaveCallMutation({ conversationId: previous.conversationId }).catch(() => {});
        setActiveCall(null);
      }

      try {
        const { url, token, roomName } = await joinCallAction({ conversationId });
        await connect({ url, token });

        if (joinGenerationRef.current !== myGeneration) {
          // The user navigated away (or started a different join) while we
          // were connecting — leave immediately instead of surfacing a call
          // for something they're no longer looking at.
          await disconnect();
          await leaveCallMutation({ conversationId }).catch(() => {});
          return;
        }

        setActiveCall({ conversationId, roomName });
        setExpanded(true);
      } catch (err) {
        await disconnect();
        await leaveCallMutation({ conversationId }).catch(() => {});
        if (joinGenerationRef.current === myGeneration) {
          setJoinError(err instanceof Error ? err.message : String(err));
        }
      }
    },
    [connect, disconnect, joinCallAction, leaveCallMutation]
  );

  const leaveCall = useCallback(async () => {
    const current = activeCallRef.current;
    if (!current) return;
    await disconnect();
    await leaveCallMutation({ conversationId: current.conversationId }).catch(() => {});
    setActiveCall(null);
    setExpanded(false);
  }, [disconnect, leaveCallMutation]);

  // Safety net: if LiveKit drops the connection for any reason other than an
  // explicit leaveCall() (network blip, server-side kick), reflect that here
  // instead of getting stuck showing a call that isn't actually connected.
  useEffect(() => {
    if (status === "disconnected" && activeCallRef.current) {
      const current = activeCallRef.current;
      setActiveCall(null);
      setExpanded(false);
      void leaveCallMutation({ conversationId: current.conversationId }).catch(() => {});
    }
  }, [status, leaveCallMutation]);

  const expand = useCallback(() => setExpanded(true), []);
  const collapse = useCallback(() => {
    joinGenerationRef.current++;
    setExpanded(false);
  }, []);
  const dismissJoinError = useCallback(() => setJoinError(null), []);

  // Unmounting (e.g. signing out) would otherwise leave the LiveKit Room
  // connected — local mic/camera still active — and the callParticipants row
  // stale. Reads activeCallRef at unmount time deliberately; disconnect/
  // leaveCallMutation are stable across renders.
  useEffect(() => {
    return () => {
      const current = activeCallRef.current;
      if (!current) return;
      void disconnect();
      void leaveCallMutation({ conversationId: current.conversationId }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <CallContext.Provider
      value={{ controller, activeCall, expanded, joinCall, leaveCall, expand, collapse, joinError, dismissJoinError }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within <CallProvider>");
  return ctx;
}

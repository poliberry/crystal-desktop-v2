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
  const activeCallRef = useRef<ActiveCall | null>(null);
  activeCallRef.current = activeCall;

  const joinCall = useCallback(
    async (conversationId: Id<"conversations">) => {
      if (activeCallRef.current?.conversationId === conversationId) {
        setExpanded(true);
        return;
      }
      if (activeCallRef.current) {
        const previous = activeCallRef.current;
        await disconnect();
        await leaveCallMutation({ conversationId: previous.conversationId }).catch(() => {});
        setActiveCall(null);
      }
      const { url, token, roomName } = await joinCallAction({ conversationId });
      await connect({ url, token });
      setActiveCall({ conversationId, roomName });
      setExpanded(true);
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
  const collapse = useCallback(() => setExpanded(false), []);

  return (
    <CallContext.Provider value={{ controller, activeCall, expanded, joinCall, leaveCall, expand, collapse }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within <CallProvider>");
  return ctx;
}

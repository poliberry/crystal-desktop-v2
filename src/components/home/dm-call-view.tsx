"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { RoomView, type RoomController } from "@/components/room-view";
import { Button } from "@/components/ui/button";
import { useRoom } from "@/hooks/use-room";

interface DmCallViewProps {
  conversationId: Id<"conversations">;
  onBack: () => void;
}

export function DmCallView({ conversationId, onBack }: DmCallViewProps) {
  const controller = useRoom();
  const { status, error, connect, disconnect } = controller;
  const joinCall = useAction(api.callTokens.join);
  const leaveCall = useMutation(api.calls.leave);
  const conversation = useQuery(api.conversations.get, { conversationId });
  const [joinError, setJoinError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const { url, token } = await joinCall({ conversationId });
        await connect({ url, token });
      } catch (err) {
        setJoinError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [joinCall, connect, conversationId]);

  // Single cleanup path: leaving the call (whichever way this view is
  // unmounted) disconnects LiveKit and drops the caller's callParticipants
  // row so the "N in call" indicator updates for the rest of the group.
  useEffect(() => {
    return () => {
      void disconnect();
      void leaveCall({ conversationId });
    };
  }, [disconnect, leaveCall, conversationId]);

  const roomName = conversation
    ? conversation.type === "group"
      ? conversation.name || conversation.members.map((m) => m.name).join(", ")
      : (conversation.members[0]?.name ?? "Call")
    : "Call";

  const isConnected = status === "connected" || status === "connecting";

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center border-b bg-background/60 px-2 py-1.5">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Back to chat
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {isConnected ? (
          <RoomView roomName={roomName} controller={controller as RoomController} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            {joinError || error ? (
              <>
                <p className="text-destructive">{joinError || error}</p>
                <Button variant="secondary" size="sm" onClick={onBack}>
                  Back to chat
                </Button>
              </>
            ) : (
              <>
                <Loader2 className="size-5 animate-spin" />
                Connecting…
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useQuery } from "convex/react";
import { ArrowLeft, Loader2 } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { useCall } from "@/components/call/call-provider";
import { RoomView, type RoomController } from "@/components/room-view";
import { Button } from "@/components/ui/button";

/** The full call screen. Rendered whenever the active call is "expanded" —
 * collapsing (via the back button) doesn't disconnect, it just hands the
 * content pane back to whatever the user was browsing; the call keeps
 * running in the background, shown as the mini bar in NavSidebar. */
export function CallStage() {
  const { activeCall, controller, collapse, leaveCall } = useCall();
  const { status, error } = controller;
  const conversation = useQuery(
    api.conversations.get,
    activeCall ? { conversationId: activeCall.conversationId } : "skip"
  );

  if (!activeCall) return null;

  const roomName = conversation
    ? conversation.type === "group"
      ? conversation.name || conversation.members.map((m) => m.name).join(", ")
      : (conversation.members[0]?.name ?? "Call")
    : "Call";

  const isConnected = status === "connected" || status === "connecting";

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center border-b bg-background/60 px-2 py-1.5">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={collapse}>
          <ArrowLeft className="size-4" />
          Back to chat
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {isConnected ? (
          <RoomView roomName={roomName} controller={controller as RoomController} onLeave={() => void leaveCall()} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            {error ? (
              <>
                <p className="text-destructive">{error}</p>
                <Button variant="secondary" size="sm" onClick={collapse}>
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

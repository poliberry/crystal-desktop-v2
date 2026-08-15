"use client";

import { ArrowLeft, Loader2 } from "lucide-react";

import { useCall } from "@/components/call/call-provider";
import { useCallTitle } from "@/components/call/use-call-title";
import { RoomView, type RoomController } from "@/components/room-view";
import { Button } from "@/components/ui/button";

/** The full call screen. Rendered whenever the active call is "expanded" —
 * collapsing (via the back button) doesn't disconnect, it just hands the
 * content pane back to whatever the user was browsing; the call keeps
 * running in the background, shown as the mini bar in NavSidebar. */
export function CallStage() {
  const { activeCall, controller, collapse, leaveCall } = useCall();
  const { status, error } = controller;
  const roomName = useCallTitle(activeCall);

  if (!activeCall) return null;

  const isConnected = status === "connected" || status === "connecting";

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center border-b bg-background/60 px-2 py-1.5">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={collapse}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {isConnected ? (
          <RoomView roomName={roomName} controller={controller as RoomController} onLeave={leaveCall} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            {error ? (
              <>
                <p className="text-destructive">{error}</p>
                <Button variant="secondary" size="sm" onClick={collapse}>
                  Back
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

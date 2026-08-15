"use client";

import { useQuery } from "convex/react";
import { Mic, MicOff, MonitorUp, PhoneOff, Radio, ScreenShareOff, Video, VideoOff } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { useCall } from "@/components/call/call-provider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Persistent "you're still on a call" card shown above the user card while
 * an active call is running but collapsed (the user is browsing elsewhere).
 * Clicking the label re-expands the full call screen; the icon row lets you
 * mute/toggle without leaving whatever you're doing. */
export function CallMiniBar() {
  const { activeCall, controller, expanded, expand, leaveCall } = useCall();
  const conversation = useQuery(
    api.conversations.get,
    activeCall ? { conversationId: activeCall.conversationId } : "skip"
  );

  if (!activeCall) return null;

  const title = conversation
    ? conversation.type === "group"
      ? conversation.name || conversation.members.map((m) => m.name).join(", ")
      : (conversation.members[0]?.name ?? "Call")
    : "Call";

  const { cameraEnabled, microphoneEnabled, screenSharing, toggleCamera, toggleMicrophone, toggleScreenShare } =
    controller;

  return (
    <div className="mx-2 mt-2 space-y-1.5 rounded-lg border bg-gradient-to-b from-emerald-500/10 to-transparent p-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={expand}
          disabled={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
        >
          <Radio className="size-4 shrink-0 text-emerald-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-emerald-500">Voice Connected</p>
            <p className="truncate text-xs text-muted-foreground">{title}</p>
          </div>
        </button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
              onClick={() => void leaveCall()}
            >
              <PhoneOff className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Leave call</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex items-center justify-center gap-1.5">
        <Button
          variant="secondary"
          size="icon"
          className="size-8"
          onClick={() => void toggleMicrophone()}
        >
          {microphoneEnabled ? <Mic className="size-4" /> : <MicOff className="size-4 text-destructive" />}
        </Button>
        <Button variant="secondary" size="icon" className="size-8" onClick={() => void toggleCamera()}>
          {cameraEnabled ? <Video className="size-4" /> : <VideoOff className="size-4 text-destructive" />}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              className="size-8"
              onClick={() => {
                // Starting a share needs the source picker in the full call
                // screen — there's no room for it in this mini bar.
                if (screenSharing) void toggleScreenShare();
                else expand();
              }}
            >
              {screenSharing ? <ScreenShareOff className="size-4" /> : <MonitorUp className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{screenSharing ? "Stop sharing" : "Share screen"}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

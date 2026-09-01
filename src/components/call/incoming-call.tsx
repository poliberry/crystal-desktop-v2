"use client";

import { useMutation, useQuery } from "convex/react";
import { Phone, PhoneOff, Users } from "lucide-react";
import { useEffect, useMemo } from "react";

import { api } from "../../../convex/_generated/api";
import { useAudioPreferences } from "@/components/audio-provider";
import { useCall } from "@/components/call/call-provider";
import { useMyPresence } from "@/hooks/use-presence";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { pickRingSound, startUiSoundLoop } from "@/lib/ui-sounds";

/**
 * The "someone is calling you" panel.
 *
 * Mounted once app-wide rather than per-conversation: a call can arrive while
 * you're looking at anything, so this can't live inside the chat view it
 * belongs to. Only the first ring is shown — a second simultaneous caller
 * queues behind it rather than stacking panels over each other.
 */
export function IncomingCall() {
  const rings = useQuery(api.calls.listIncomingRings) ?? [];
  const dismissRing = useMutation(api.calls.dismissRing);
  const { joinDmCall, activeCall } = useCall();
  const { uiSoundVolume, outputDeviceId } = useAudioPreferences();
  const { manualStatus } = useMyPresence();
  // Do Not Disturb / Busy still shows the panel — it just doesn't ring out.
  const silenced = manualStatus === "dnd" || manualStatus === "busy";

  const ring = rings[0];
  // Don't ring at someone who's already in that very call — they answered
  // from somewhere else, and the row is about to be cleared anyway.
  const active = ring && !(activeCall?.kind === "dm" && activeCall.conversationId === ring.conversationId);

  // Rolled per call rather than per render, so adjusting the volume mid-ring
  // doesn't re-roll which ringtone is playing.
  const ringSound = useMemo(() => pickRingSound(), [ring?.id]);

  useEffect(() => {
    if (!active || silenced) return;
    return startUiSoundLoop(ringSound, {
      volume: uiSoundVolume,
      outputDeviceId: outputDeviceId || undefined,
    });
  }, [active, silenced, ringSound, uiSoundVolume, outputDeviceId]);

  if (!ring || !active) return null;

  const accept = () => {
    void joinDmCall(ring.conversationId);
  };

  const decline = () => {
    void dismissRing({ conversationId: ring.conversationId }).catch(() => {});
  };

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-80 overflow-hidden rounded-xl border border-border/60 bg-card/95 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-3 p-4">
        <span className="relative flex shrink-0">
          {/* The pulse is the whole affordance here — a static card reads as
              a notification rather than something waiting on you. */}
          <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/40" />
          <Avatar className="relative size-12">
            <AvatarImage src={ring.callerImageUrl} alt={ring.callerName} />
            <AvatarFallback>{ring.callerName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
        </span>

        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold">{ring.title}</p>
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            {ring.isGroup ? (
              <>
                <Users className="size-3" />
                {ring.callerName} is calling
              </>
            ) : (
              "Incoming call"
            )}
          </p>
        </div>
      </div>

      <div className="flex gap-2 border-t border-border/50 p-3">
        <Button variant="secondary" className="flex-1" onClick={decline}>
          <PhoneOff className="size-4" />
          Decline
        </Button>
        <Button className="flex-1 bg-emerald-600 text-white hover:bg-emerald-600/90" onClick={accept}>
          <Phone className="size-4" />
          Accept
        </Button>
      </div>
    </div>
  );
}

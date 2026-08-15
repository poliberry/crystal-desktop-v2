"use client";

import { useQuery } from "convex/react";
import { RoomEvent, type Room } from "livekit-client";
import { useEffect, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface VoiceChannelParticipantsProps {
  channelId: Id<"channels">;
  /** The live room, only when the current user happens to be connected to
   * THIS channel's call — lets this show a live "who's speaking" ring. Every
   * other voice channel only knows who's connected (via Convex bookkeeping,
   * so it shows regardless of whether you're connected yourself) but has no
   * live audio-level data to ring around a speaker. */
  liveRoom: Room | null;
}

/** The small "who's in this voice channel" avatar list Discord shows under
 * a voice channel row. */
export function VoiceChannelParticipants({ channelId, liveRoom }: VoiceChannelParticipantsProps) {
  const participants = useQuery(api.channels.listVoiceParticipants, { channelId }) ?? [];
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!liveRoom) {
      setSpeaking(new Set());
      return;
    }
    const update = () => setSpeaking(new Set(liveRoom.activeSpeakers.map((p) => p.identity)));
    update();
    liveRoom.on(RoomEvent.ActiveSpeakersChanged, update);
    return () => {
      liveRoom.off(RoomEvent.ActiveSpeakersChanged, update);
    };
  }, [liveRoom]);

  if (participants.length === 0) return null;

  return (
    <div className="mt-0.5 mb-1 ml-6 flex flex-col gap-1">
      {participants.map((p) => (
        <div key={p.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Avatar
            size="sm"
            className={cn(
              "size-5 ring-2 ring-transparent transition-shadow",
              speaking.has(p.id) && "ring-emerald-500"
            )}
          >
            <AvatarImage src={p.imageUrl} alt={p.name} />
            <AvatarFallback className="text-[8px]">{p.name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="truncate">{p.name}</span>
        </div>
      ))}
    </div>
  );
}

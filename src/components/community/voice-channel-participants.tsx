"use client";

import { useQuery } from "convex/react";
import { HeadphoneOff, MicOff } from "lucide-react";
import { RoomEvent, type Room } from "livekit-client";
import { useEffect, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  ACTIVITY_ICON,
  RichPresenceCards,
  topActivity,
} from "@/components/rich-presence-card";
import { useCall } from "@/components/call/call-provider";
import { StreamPreviewCard } from "@/components/call/stream-preview-card";
import { PROFILE_POPOVER_CLASS, UserProfileContent } from "@/components/community/member-profile-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSoundboardActivity } from "@/hooks/use-soundboard-activity";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { RichPresenceActivity } from "@/types/desktop-api";

export interface VoiceParticipant {
  id: Id<"users">;
  name: string;
  username: string;
  imageUrl?: string;
  muted: boolean;
  deafened: boolean;
  streaming: boolean;
  serverMuted: boolean;
  serverDeafened: boolean;
  /** A recent still of their screen share, published by their own client —
   * only present while `streaming`. */
  streamThumbnailUrl?: string;
  activities?: RichPresenceActivity[];
}

interface VoiceChannelParticipantsProps {
  channelId: Id<"channels">;
  /** The channel's community, so a clicked member resolves to their profile
   * *here* — server nickname, avatar and roles included. */
  communityId: Id<"communities">;
  /** The live room, only when the current user happens to be connected to
   * THIS channel's call — lets this show a live "who's speaking" ring. Every
   * other voice channel only knows who's connected (via Convex bookkeeping,
   * so it shows regardless of whether you're connected yourself) but has no
   * live audio-level data to ring around a speaker. */
  liveRoom: Room | null;
}

/**
 * Box art for the headline activity (or the generic glyph), with a count of
 * anything else the user has going on.
 */
export function ActivityBadge({
  activities,
  className,
}: {
  activities: RichPresenceActivity[] | undefined;
  className?: string;
}) {
  const activity = topActivity(activities);
  if (!activity) return null;
  const Icon = ACTIVITY_ICON[activity.type];
  const extra = (activities?.length ?? 0) - 1;

  return (
    <span className={cn("flex shrink-0 items-center gap-0.5", className)}>
      {activity.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={activity.imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="size-3.5 shrink-0 rounded-[3px] object-cover"
        />
      ) : (
        <Icon className="size-3.5 shrink-0 text-emerald-500" />
      )}
      {extra > 0 && (
        <span className="text-[10px] font-semibold leading-none text-emerald-500">+{extra}</span>
      )}
    </span>
  );
}

/** One row: avatar, name, then whatever state applies. */
function ParticipantRow({
  participant,
  speaking,
  soundboardActive = false,
  interactive = true,
  communityId,
  onWatchStream,
}: {
  participant: VoiceParticipant;
  speaking: boolean;
  /** Same affordance as `speaking`, in a different colour. */
  soundboardActive?: boolean;
  /** False inside the channel hover card, which already shows the activity
   * and must not nest a tooltip inside a tooltip. */
  interactive?: boolean;
  /** Which community's profile to resolve the clicked member against.
   * Omitted inside the channel hover card, where the row isn't clickable. */
  communityId?: Id<"communities">;
  /** Join this channel's call and open this member's share. Omitted where
   * there's nowhere to navigate from. */
  onWatchStream?: () => void;
}) {
  const row = (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Avatar
        size="sm"
        className={cn(
          "size-5 ring-2 ring-transparent transition-shadow",
          // Soundboard wins while active: it's momentary, so it reads as an
          // event rather than a state.
          soundboardActive ? "ring-sky-500" : speaking && "ring-emerald-500"
        )}
      >
        <AvatarImage src={participant.imageUrl} alt={participant.name} />
        <AvatarFallback className="text-[8px]">
          {participant.name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <span className={cn("truncate", participant.deafened && "opacity-60")}>
        {participant.name}
      </span>

      <span className="ml-auto flex shrink-0 items-center gap-1">
        <ActivityBadge activities={participant.activities} />
        {participant.streaming && (
          <span className="rounded-[3px] bg-destructive px-1 text-[9px] font-bold leading-[14px] tracking-wide text-white">
            LIVE
          </span>
        )}
        {/* Deafened implies muted, so showing both glyphs would be noise. */}
        {participant.deafened ? (
          <HeadphoneOff className="size-3.5 text-destructive" aria-label="Deafened" />
        ) : (
          participant.muted && <MicOff className="size-3.5 text-destructive" aria-label="Muted" />
        )}
      </span>
    </div>
  );

  if (!interactive) return row;

  // Hovering shows what they're playing; clicking opens the same profile card
  // as the member list and message authors, so the roster is a way *into*
  // someone rather than a dead end.
  const trigger = (
    <PopoverTrigger asChild>
      <button type="button" className="-mx-1 w-full rounded px-1 text-left hover:bg-accent/40">
        {row}
      </button>
    </PopoverTrigger>
  );

  return (
    <Popover>
      {participant.activities?.length || participant.streaming ? (
        <HoverCard>
          <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
          <HoverCardContent side="right" className="w-72">
            <div className="mb-1.5 flex items-center gap-2 px-0.5">
              <Avatar size="sm" className="size-5">
                <AvatarImage src={participant.imageUrl} alt={participant.name} />
                <AvatarFallback className="text-[8px]">
                  {participant.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="truncate text-sm font-semibold">{participant.name}</span>
            </div>
            {participant.streaming && (
              <StreamPreviewCard
                name={participant.name}
                imageUrl={participant.imageUrl}
                thumbnailUrl={participant.streamThumbnailUrl}
                className="mb-1.5"
                onWatch={onWatchStream}
              />
            )}
            <RichPresenceCards activities={participant.activities} />
          </HoverCardContent>
        </HoverCard>
      ) : (
        trigger
      )}
      <PopoverContent
        side="right"
        align="start"
        className={PROFILE_POPOVER_CLASS}
      >
        <UserProfileContent
          userId={participant.id}
          communityId={communityId}
          name={participant.name}
          username={participant.username}
          imageUrl={participant.imageUrl}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Hover card for a voice channel row itself: everyone currently in it, with
 * their state and whatever they're playing. Renders the row untouched when
 * the channel is empty, so hovering an idle channel shows nothing.
 *
 * Shares `listVoiceParticipants` with the list below — Convex dedupes
 * identical query subscriptions, so this costs no extra round trip.
 */
export function VoiceChannelHoverCard({
  channelId,
  communityId,
  channelName,
  children,
}: {
  channelId: Id<"channels">;
  communityId: Id<"communities">;
  channelName: string;
  children: React.ReactNode;
}) {
  const participants = (useQuery(api.channels.listVoiceParticipants, { channelId }) ??
    []) as VoiceParticipant[];
  const { joinChannelCall } = useCall();

  if (participants.length === 0) return <>{children}</>;

  return (
    <HoverCard>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="right" className="w-76 max-h-[70vh] overflow-y-auto">
        <p className="mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {channelName} — {participants.length}
        </p>
        <div className="flex flex-col gap-2.5">
          {participants.map((p) => (
            <div key={p.id} className="flex flex-col gap-1.5">
              <ParticipantRow participant={p} speaking={false} interactive={false} />
              {p.streaming && (
                <StreamPreviewCard
                  name={p.name}
                  imageUrl={p.imageUrl}
                  thumbnailUrl={p.streamThumbnailUrl}
                  onWatch={() =>
                    void joinChannelCall(channelId, communityId, { watchIdentity: p.id })
                  }
                />
              )}
              <RichPresenceCards activities={p.activities} />
            </div>
          ))}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

/** The small "who's in this voice channel" avatar list Discord shows under
 * a voice channel row. */
export function VoiceChannelParticipants({
  channelId,
  communityId,
  liveRoom,
}: VoiceChannelParticipantsProps) {
  const participants = (useQuery(api.channels.listVoiceParticipants, { channelId }) ??
    []) as VoiceParticipant[];
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());
  // Only meaningful for the channel we're actually connected to — the packet
  // that drives this never reaches us for any other room.
  const soundboardActive = useSoundboardActivity();
  const { joinChannelCall } = useCall();

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
    <div className="mt-0.5 mb-1 ml-6 mr-2 flex flex-col gap-1">
      {participants.map((p) => (
        <ParticipantRow
          key={p.id}
          participant={p}
          communityId={communityId}
          speaking={speaking.has(p.id)}
          soundboardActive={!!liveRoom && soundboardActive.has(p.id)}
          onWatchStream={() =>
            void joinChannelCall(channelId, communityId, { watchIdentity: p.id })
          }
        />
      ))}
    </div>
  );
}

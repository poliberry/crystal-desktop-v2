"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowRight, MessageSquare, PhoneCall, Volume2 } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSmoothScrollRef } from "@/hooks/use-smooth-scroll";
import { useNavigation } from "@/components/home/navigation-context";
import { RichPresenceCards } from "@/components/rich-presence-card";
import { StreamPreviewCard } from "@/components/call/stream-preview-card";
import { useCall } from "@/components/call/call-provider";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar";
import type { RichPresenceActivity } from "@/types/desktop-api";

/**
 * "Active now": the calls you could walk into and what your friends are up to.
 *
 * Deliberately only the two things you might act on. Calls come from servers
 * the user is in and their own group DMs, because joining is the point of
 * listing them; activities come from friends only, since a thousand-member
 * server playing games is noise rather than a feed.
 */
export function ActivityFeed() {
  const smoothRef = useSmoothScrollRef<HTMLDivElement>();
  const nav = useNavigation();
  const { joinChannelCall, joinDmCall } = useCall();
  const getOrCreateDirect = useMutation(api.conversations.getOrCreateDirect);
  const data = useQuery(api.presence.activeNow);

  /** Message or ring a friend from the feed. The DM may not exist yet, which
   * is the only reason this needs a mutation rather than a navigation. */
  const openDm = async (userId: Id<"users">, call: boolean) => {
    const conversationId = await getOrCreateDirect({ friendId: userId });
    if (call) await joinDmCall(conversationId);
    else nav.openConversation(conversationId);
  };

  const calls = data?.calls ?? [];
  const activities = data?.activities ?? [];
  const empty = calls.length === 0 && activities.length === 0;

  return (
    <aside className="hidden w-72 shrink-0 flex-col border-l p-4 lg:flex">
      <h2 className="mb-3 text-sm font-semibold">Active now</h2>

      {empty ? (
        <div className="rounded-lg bg-accent/30 p-4">
          <p className="text-sm font-medium">It&apos;s quiet for now</p>
          <p className="mt-1 text-xs text-muted-foreground">
            When your friends start a call or fire up a game, it&apos;ll show up here.
          </p>
        </div>
      ) : (
        /* Deliberately a plain scroller rather than shadcn's ScrollArea:
           Radix wraps its viewport's children in a `display: table` div, which
           sizes to its content instead of the column — the stream stills and
           media cards inside pushed straight out past the edge. */
        <div ref={smoothRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-w-0 flex-col gap-2 pr-1">
            {calls.map((call) => (
              <div key={call.key} className="rounded-lg bg-accent/30 p-3">
                {/* Hovering offers the two things worth doing with a call —
                    joining it, or going to where it's happening — rather than
                    guessing which one a click meant. */}
                <HoverCard openDelay={150} closeDelay={100}>
                  <HoverCardTrigger asChild>
                    <div className="cursor-default">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                        <Volume2 className="size-3.5 shrink-0" />
                        <span className="truncate">{call.name}</span>
                      </p>
                      {call.context && (
                        <p className="truncate text-[11px] text-muted-foreground">
                          {call.context}
                        </p>
                      )}
                    </div>
                  </HoverCardTrigger>
                  <HoverCardContent side="left" align="start" className="w-48 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (call.conversationId) {
                          void joinDmCall(call.conversationId as Id<"conversations">, {
                            ring: false,
                          });
                        } else if (call.communityId && call.channelId) {
                          void joinChannelCall(
                            call.channelId as Id<"channels">,
                            call.communityId as Id<"communities">
                          );
                        }
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <PhoneCall className="size-3.5 shrink-0" />
                      Join call
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (call.conversationId) {
                          nav.openConversation(call.conversationId as Id<"conversations">);
                        } else if (call.communityId && call.channelId) {
                          nav.openCommunity(
                            call.communityId as Id<"communities">,
                            call.channelId as Id<"channels">
                          );
                        }
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <ArrowRight className="size-3.5 shrink-0" />
                      {call.conversationId ? "Open conversation" : "Go to server"}
                    </button>
                  </HoverCardContent>
                </HoverCard>
                <div className="mt-2 flex items-center gap-2">
                  <AvatarGroup data-size="sm">
                    {call.participants.map((participant) => (
                      <Avatar key={participant.userId} size="sm" title={participant.name}>
                        <AvatarImage src={participant.imageUrl} alt={participant.name} />
                        <AvatarFallback className="text-[8px]">
                          {participant.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                    {call.participantCount > call.participants.length && (
                      <AvatarGroupCount className="text-[10px]">
                        +{call.participantCount - call.participants.length}
                      </AvatarGroupCount>
                    )}
                  </AvatarGroup>
                  <span className="text-[11px] text-muted-foreground">
                    {call.participantCount} in voice
                  </span>
                </div>

              {/* One card per stream: clicking joins the call and opens that
                  share, rather than dropping you in to hunt for it. */}
              {call.participants
                .filter((participant) => participant.streaming)
                .map((participant) => (
                  <StreamPreviewCard
                    key={participant.userId}
                    name={participant.name}
                    imageUrl={participant.imageUrl}
                    thumbnailUrl={participant.streamThumbnailUrl}
                    className="mt-2"
                    onWatch={
                      call.communityId && call.channelId
                        ? () =>
                            void joinChannelCall(
                              call.channelId as Id<"channels">,
                              call.communityId as Id<"communities">,
                              { watchIdentity: participant.userId }
                            )
                        : undefined
                    }
                  />
                ))}
              </div>
            ))}

            {/* The same card the profile popovers use, under whose name it
                belongs — an activity without a face beside it doesn't say who
                is doing it. */}
            {activities.map((entry) => (
              <HoverCard key={entry.userId} openDelay={150} closeDelay={100}>
                <HoverCardTrigger asChild>
                  <div className="cursor-default space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Avatar size="sm">
                        <AvatarImage src={entry.imageUrl} alt={entry.name} />
                        <AvatarFallback className="text-[9px]">
                          {entry.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">{entry.name}</p>
                    </div>
                    <RichPresenceCards activities={entry.activities as RichPresenceActivity[]} />
                  </div>
                </HoverCardTrigger>
                <HoverCardContent side="left" align="start" className="w-44 p-1">
                  <button
                    type="button"
                    onClick={() => void openDm(entry.userId as Id<"users">, false)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <MessageSquare className="size-3.5 shrink-0" />
                    Message
                  </button>
                  <button
                    type="button"
                    onClick={() => void openDm(entry.userId as Id<"users">, true)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <PhoneCall className="size-3.5 shrink-0" />
                    Call
                  </button>
                </HoverCardContent>
              </HoverCard>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

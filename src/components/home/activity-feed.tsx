"use client";

import { useQuery } from "convex/react";
import { Volume2 } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useNavigation } from "@/components/home/navigation-context";
import {
  ACTIVITY_ICON,
  ACTIVITY_VERB,
  topActivity,
} from "@/components/rich-presence-card";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  const nav = useNavigation();
  const data = useQuery(api.presence.activeNow);
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
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-2 pr-2">
            {calls.map((call) => (
              <button
                key={call.key}
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
                className="rounded-lg bg-accent/30 p-3 text-left hover:bg-accent/60"
              >
                <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                  <Volume2 className="size-3.5 shrink-0" />
                  <span className="truncate">{call.name}</span>
                </p>
                {call.context && (
                  <p className="truncate text-[11px] text-muted-foreground">{call.context}</p>
                )}
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
              </button>
            ))}

            {activities.map((entry) => {
              const list = entry.activities as RichPresenceActivity[];
              const activity = topActivity(list);
              if (!activity) return null;
              const Icon = ACTIVITY_ICON[activity.type];
              return (
                <div key={entry.userId} className="flex items-center gap-2.5 rounded-lg p-2">
                  {activity.imageUrl ? (
                    <img
                      src={activity.imageUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="size-9 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <Avatar className="size-9 shrink-0">
                      <AvatarImage src={entry.imageUrl} alt={entry.name} />
                      <AvatarFallback>{entry.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{entry.name}</p>
                    <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <Icon className="size-3 shrink-0 text-emerald-500" />
                      <span className="truncate">
                        {ACTIVITY_VERB[activity.type]} {activity.name}
                      </span>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </aside>
  );
}

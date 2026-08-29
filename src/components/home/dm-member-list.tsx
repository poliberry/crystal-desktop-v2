"use client";

import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MemberProfileCard } from "@/components/community/member-profile-card";
import { ProfilePopoverContent } from "@/components/profile/profile-popover";
import { usePreloadedCosmetics } from "@/hooks/use-preloaded-cosmetics";
import { Nameplate } from "@/components/profile/nameplate";
import {
  ActivityStatusIcon,
  activitySummary,
  topActivity,
} from "@/components/rich-presence-card";
import type { RichPresenceActivity } from "@/types/desktop-api";
import {
  Avatar,
  AvatarDecoration,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { PresenceBadge } from "@/components/presence-dot";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type FriendStatus } from "@/lib/presence";

interface DmMemberListProps {
  conversationId: Id<"conversations">;
}

interface DmMember {
  userId: Id<"users">;
  name: string;
  username: string;
  imageUrl?: string;
  bio?: string;
  customStatus?: string;
  nameplateUrl?: string;
  avatarDecoration?: string;
  isBirthday?: boolean;
  bannerUrl?: string;
  borderGradientStart?: string;
  borderGradientEnd?: string;
  status: FriendStatus;
  activities?: RichPresenceActivity[];
}

/** Group DM equivalent of the community MemberList — simpler, since DMs have
 * no roles: just who's online and who isn't. */
export function DmMemberList({ conversationId }: DmMemberListProps) {
  const members = (useQuery(api.conversations.listMembersWithPresence, { conversationId }) ??
    []) as DmMember[];
  usePreloadedCosmetics(members);
  const online = members.filter((m) => m.status !== "offline");
  const offline = members.filter((m) => m.status === "offline");

  return (
    <div className="flex w-56 shrink-0 flex-col border-l bg-background/40">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-2">
          {online.length > 0 && <DmMemberGroup label="Online" members={online} />}
          {offline.length > 0 && <DmMemberGroup label="Offline" members={offline} />}
        </div>
      </ScrollArea>
    </div>
  );
}

function DmMemberGroup({ label, members }: { label: string; members: DmMember[] }) {
  return (
    <div>
      <p className="px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label} — {members.length}
      </p>
      <div className="mt-1 flex flex-col gap-0.5">
        {members.map((member) => (
          <Popover key={member.userId}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="group/member relative flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/40"
              >
                <Avatar size="sm">
                  <AvatarImage src={member.imageUrl} alt={member.name} />
                  <AvatarFallback>{member.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  <AvatarDecoration value={member.avatarDecoration} />
                  <PresenceBadge
                    status={member.status}
                    isBirthday={member.isBirthday}
                    decorated={!!member.avatarDecoration}
                  />
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{member.name}</p>
                  {member.status !== "offline" &&
                    (!!member.customStatus || !!member.activities?.length) && (
                      <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground leading-tight">
                        <ActivityStatusIcon activities={member.activities} />
                        <span className="truncate">
                          {member.customStatus ?? activitySummary(topActivity(member.activities))}
                        </span>
                      </p>
                    )}
                </div>
                <Nameplate url={member.nameplateUrl} className="pointer-events-none absolute inset-0 h-full w-full rounded-md object-cover opacity-0 transition-opacity group-hover/member:opacity-10" />
              </button>
            </PopoverTrigger>
            <ProfilePopoverContent userId={member.userId} side="left">
              <MemberProfileCard member={member} reserveFrameRoom={false} />
            </ProfilePopoverContent>
          </Popover>
        ))}
      </div>
    </div>
  );
}

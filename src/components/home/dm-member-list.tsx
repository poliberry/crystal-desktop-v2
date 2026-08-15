"use client";

import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MemberProfileCard } from "@/components/community/member-profile-card";
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { STATUS_DOT_CLASS, type FriendStatus } from "@/lib/presence";

interface DmMemberListProps {
  conversationId: Id<"conversations">;
}

interface DmMember {
  userId: Id<"users">;
  name: string;
  username: string;
  imageUrl?: string;
  bio?: string;
  status: FriendStatus;
}

/** Group DM equivalent of the community MemberList — simpler, since DMs have
 * no roles: just who's online and who isn't. */
export function DmMemberList({ conversationId }: DmMemberListProps) {
  const members = (useQuery(api.conversations.listMembersWithPresence, { conversationId }) ??
    []) as DmMember[];
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
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/40"
              >
                <Avatar size="sm">
                  <AvatarImage src={member.imageUrl} alt={member.name} />
                  <AvatarFallback>{member.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  <AvatarBadge className={STATUS_DOT_CLASS[member.status]} />
                </Avatar>
                <p className="truncate text-sm">{member.name}</p>
              </button>
            </PopoverTrigger>
            <PopoverContent side="left" align="start" className="w-80">
              <MemberProfileCard member={member} />
            </PopoverContent>
          </Popover>
        ))}
      </div>
    </div>
  );
}

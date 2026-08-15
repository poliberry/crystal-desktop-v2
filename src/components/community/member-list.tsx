"use client";

import { useQuery } from "convex/react";
import { Crown } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MemberProfileCard } from "@/components/community/member-profile-card";
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { STATUS_DOT_CLASS, type FriendStatus } from "@/lib/presence";

interface MemberListProps {
  communityId: Id<"communities">;
}

interface MemberRole {
  id: Id<"roles">;
  name: string;
  color?: string;
  position: number;
  hoist: boolean;
}

interface Member {
  userId: Id<"users">;
  name: string;
  username: string;
  imageUrl?: string;
  bio?: string;
  isOwner: boolean;
  status: FriendStatus;
  roles: MemberRole[];
}

interface Group {
  key: string;
  label: string;
  color?: string;
  /** Sort key — a role's position for hoisted groups, or a sentinel that
   * always sorts the generic "Online"/"Offline" buckets last. */
  position: number;
  members: Member[];
}

function highestRole(roles: MemberRole[], onlyHoisted: boolean): MemberRole | undefined {
  return [...roles]
    .filter((r) => (onlyHoisted ? r.hoist : true))
    .sort((a, b) => b.position - a.position)[0];
}

/** Groups members the way Discord's member list does: one bucket per hoisted
 * role (highest-positioned hoisted role a member has, sorted by role
 * position), a generic "Online" bucket for everyone else who's online, and a
 * single "Offline" bucket for everyone else regardless of roles. */
function buildGroups(members: Member[]): Group[] {
  const online = members.filter((m) => m.status !== "offline");
  const offline = members.filter((m) => m.status === "offline");

  const hoistGroups = new Map<string, Group>();
  const plainOnline: Member[] = [];

  for (const member of online) {
    const hoisted = highestRole(member.roles, true);
    if (hoisted) {
      const existing = hoistGroups.get(hoisted.id);
      if (existing) existing.members.push(member);
      else {
        hoistGroups.set(hoisted.id, {
          key: hoisted.id,
          label: hoisted.name,
          color: hoisted.color,
          position: hoisted.position,
          members: [member],
        });
      }
    } else {
      plainOnline.push(member);
    }
  }

  const groups = Array.from(hoistGroups.values()).sort((a, b) => b.position - a.position);
  if (plainOnline.length > 0) {
    groups.push({ key: "online", label: "Online", position: -1, members: plainOnline });
  }
  if (offline.length > 0) {
    groups.push({ key: "offline", label: "Offline", position: -2, members: offline });
  }
  return groups;
}

export function MemberList({ communityId }: MemberListProps) {
  const members = (useQuery(api.communities.listMembers, { communityId }) ?? []) as Member[];
  const groups = buildGroups(members);

  return (
    <div className="flex w-56 shrink-0 flex-col border-l bg-background/40">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-2">
          {groups.map((group) => (
            <div key={group.key}>
              <p
                className="px-2 text-xs font-semibold tracking-wide uppercase text-muted-foreground"
                style={group.color ? { color: group.color } : undefined}
              >
                {group.label} — {group.members.length}
              </p>
              <div className="mt-1 flex flex-col gap-0.5">
                {group.members.map((member) => {
                  const colorRole = highestRole(
                    member.roles.filter((r) => r.color),
                    false
                  );
                  return (
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
                          <p
                            className="truncate text-sm"
                            style={colorRole?.color ? { color: colorRole.color } : undefined}
                          >
                            {member.name}
                          </p>
                          {member.isOwner && <Crown className="size-3 shrink-0 text-amber-500" />}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="left" align="start" className="w-80">
                        <MemberProfileCard member={member} />
                      </PopoverContent>
                    </Popover>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

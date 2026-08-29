"use client";

import { useQuery } from "convex/react";
import { usePreloadedCosmetics } from "@/hooks/use-preloaded-cosmetics";
import { Crown } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MemberContextMenu } from "@/components/community/member-context-menu";
import { Nameplate } from "@/components/profile/nameplate";
import { MemberProfileCard } from "@/components/community/member-profile-card";
import { ProfilePopoverContent } from "@/components/profile/profile-popover";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useCachedQuery } from "@/hooks/use-cached-query";
import { type FriendStatus } from "@/lib/presence";
import { cn } from "@/lib/utils";

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
  customStatus?: string;
  nameplateUrl?: string;
  avatarDecoration?: string;
  isBirthday?: boolean;
  bannerUrl?: string;
  borderGradientStart?: string;
  borderGradientEnd?: string;
  isOwner: boolean;
  status: FriendStatus;
  activities?: RichPresenceActivity[];
  /** Epoch ms an active timeout expires, if there is one. */
  timeoutUntil?: number;
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

function MemberListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-1">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <Skeleton className="h-3 flex-1" style={{ maxWidth: `${50 + (i % 3) * 20}%` }} />
        </div>
      ))}
    </div>
  );
}

export function MemberList({ communityId }: MemberListProps) {
  const rawMembers = useCachedQuery(
    api.communities.listMembers,
    communityId ? { communityId } : "skip",
    communityId ? `communities.listMembers:${communityId}` : null
  );
  const community = useQuery(api.communities.get, communityId ? { communityId } : "skip");
  const me = useQuery(api.users.getCurrentUser);
  const members = (rawMembers ?? []) as Member[];
  // A list of people is the set of profile cards about to be opened.
  usePreloadedCosmetics(members);
  const groups = buildGroups(members);

  return (
    <div className="flex w-56 shrink-0 flex-col py-2">
      <ScrollArea className="min-h-0 flex-1">
        {rawMembers === undefined ? (
          <MemberListSkeleton />
        ) : (
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
                    const isOffline = member.status === "offline";
                    return (
                      <Popover key={member.userId}>
                        <MemberContextMenu
                          communityId={communityId}
                          userId={member.userId}
                          name={member.name}
                          isSelf={member.userId === me?._id}
                          timeoutUntil={member.timeoutUntil}
                        >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className={cn(
                              "group/member relative flex items-center gap-2 rounded-md px-2 py-1.5 max-w-52 text-left hover:bg-accent/40",
                              isOffline && "opacity-50 hover:opacity-80"
                            )}
                          >
                            <Avatar size="default">
                              <AvatarImage src={member.imageUrl} alt={member.name} className="rounded-md" />
                              <AvatarFallback>{member.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                              <AvatarDecoration value={member.avatarDecoration} />
                              <PresenceBadge
                                status={member.status}
                                isBirthday={member.isBirthday}
                                decorated={!!member.avatarDecoration}
                              />
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <p
                                className="truncate text-sm leading-tight flex flex-row items-center gap-1"
                                style={colorRole?.color ? { color: colorRole.color } : undefined}
                              >
                                  {member.name} {member.isOwner ? <Crown size={12} className="text-yellow-400" /> : ""}
                              </p>
                              {/* Custom status wins the line when set;
                                  otherwise the activity fills it, and either
                                  way the activity glyph sits to its left. */}
                              {!isOffline && (!!member.customStatus || !!member.activities?.length) && (
                                <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground leading-tight">
                                    <ActivityStatusIcon activities={member.activities} />
                                  <span className="truncate">
                                    {member.customStatus ??
                                      activitySummary(topActivity(member.activities))}
                                  </span>
                                </p>
                              )}
                            </div>
                            <Nameplate url={member.nameplateUrl} className="fade-mask-l pointer-events-none absolute inset-0 h-full w-full rounded-md object-cover opacity-20" />
                          </button>
                        </PopoverTrigger>
                        </MemberContextMenu>
                        <ProfilePopoverContent
                          userId={member.userId}
                          communityId={communityId}
                          side="left"
                        >
                          <MemberProfileCard
                            reserveFrameRoom={false}
                            member={member}
                            communityId={communityId}
                            communityName={community?.name}
                          />
                        </ProfilePopoverContent>
                      </Popover>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

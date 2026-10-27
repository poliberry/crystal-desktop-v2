"use client";

import { useMutation, useQuery } from "convex/react";
import { ChevronDown, UserX } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CommunitySettingsMembersTabProps {
  communityId: Id<"communities">;
  canManageRoles: boolean;
  canKick: boolean;
}

export function CommunitySettingsMembersTab({
  communityId,
  canManageRoles,
  canKick,
}: CommunitySettingsMembersTabProps) {
  const members = useQuery(api.communities.listMembers, { communityId }) ?? [];
  const roles = useQuery(api.roles.list, { communityId }) ?? [];
  const assign = useMutation(api.roles.assign);
  const unassign = useMutation(api.roles.unassign);
  const kick = useMutation(api.communities.kickMember);

  const assignableRoles = roles.filter((r) => !r.isEveryone);

  return (
    <div className="space-y-1">
      {members.map((member) => {
        const memberRoleIds = new Set(member.roles.map((r) => r.id));
        return (
          <div
            key={member.userId}
            className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/40"
          >
            <Avatar size="sm">
              <AvatarImage src={member.imageUrl} alt={member.name} />
              <AvatarFallback>{member.name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-medium">{member.name}</p>
                {member.isOwner && (
                  <Badge variant="secondary" className="text-[10px]">
                    Owner
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-muted-foreground">@{member.username}</span>
                {member.roles.map((role) => (
                  <Badge
                    key={role.id}
                    variant="outline"
                    className="text-[10px]"
                    style={role.color ? { borderColor: role.color, color: role.color } : undefined}
                  >
                    {role.name}
                  </Badge>
                ))}
              </div>
            </div>

            {canManageRoles && assignableRoles.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1 text-xs">
                    Roles
                    <ChevronDown className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel>Assign roles</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {assignableRoles.map((role) => (
                    <label
                      key={role.id}
                      className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-accent/60"
                    >
                      <Checkbox
                        checked={memberRoleIds.has(role.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            void assign({ communityId, userId: member.userId, roleId: role.id });
                          } else {
                            void unassign({ communityId, userId: member.userId, roleId: role.id });
                          }
                        }}
                      />
                      {role.name}
                    </label>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {canKick && !member.isOwner && (
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (confirm(`Kick ${member.name}?`)) void kick({ communityId, userId: member.userId });
                }}
              >
                <UserX className="size-4" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

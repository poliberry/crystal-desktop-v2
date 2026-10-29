"use client";

import { useMutation, useQuery } from "convex/react";
import { ChevronDown, ShieldCheck, UserX } from "lucide-react";
import { useState } from "react";

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

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  PERMISSIONS,
  UNENFORCED_PERMISSIONS,
  bitsHas,
} from "@/lib/permissions";

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
  const [viewing, setViewing] = useState<{ userId: Id<"users">; name: string } | null>(null);

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

            {canManageRoles && (
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                title="View permissions"
                aria-label={`View ${member.name}'s permissions`}
                onClick={() => setViewing({ userId: member.userId, name: member.name })}
              >
                <ShieldCheck className="size-4" />
              </Button>
            )}

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
      <MemberPermissionsDialog
        communityId={communityId}
        member={viewing}
        onOpenChange={(open) => !open && setViewing(null)}
      />
    </div>
  );
}

/**
 * Everything a member can do community-wide, grouped as in the role editor, with the roles that
 * grant each one. Read-only: permissions are changed on the role, and per channel under Channels.
 */
function MemberPermissionsDialog({
  communityId,
  member,
  onOpenChange,
}: {
  communityId: Id<"communities">;
  member: { userId: Id<"users">; name: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const data = useQuery(
    api.roles.memberPermissions,
    member ? { communityId, userId: member.userId } : "skip",
  );
  const administrator = !!data && (data.isOwner || data.roles.some((r) => bitsHas(r.permissions, PERMISSIONS.ADMINISTRATOR)));

  return (
    <Dialog open={!!member} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{member?.name}&apos;s permissions</DialogTitle>
          <DialogDescription>
            {data?.isOwner
              ? "The owner can do everything in this community."
              : administrator
                ? "Has Administrator, which grants every permission and bypasses channel overwrites."
                : "What they can do across the community, from their roles. Channels can change this for a role or a person."}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-3">
          {data === undefined ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : data === null ? (
            <p className="py-6 text-center text-sm text-muted-foreground">You can&apos;t see this member&apos;s permissions.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1">
                {data.roles.map((role) => (
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
              {PERMISSION_GROUPS.map((group) => (
                <div key={group.title} className="space-y-1">
                  <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {group.title}
                  </p>
                  {group.keys.map((key) => {
                    const grantedBy = data.roles.filter((r) => bitsHas(r.permissions, PERMISSIONS[key]));
                    const has = data.isOwner || administrator || grantedBy.length > 0;
                    return (
                      <div key={key} className="flex items-center gap-2 text-sm">
                        <span
                          className={has ? "size-2 shrink-0 rounded-full bg-emerald-500" : "size-2 shrink-0 rounded-full bg-muted-foreground/30"}
                        />
                        <span className={has ? "" : "text-muted-foreground"}>{PERMISSION_LABELS[key]}</span>
                        {UNENFORCED_PERMISSIONS.has(key) && (
                          <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">not enforced yet</span>
                        )}
                        {has && !data.isOwner && !administrator && (
                          <span className="ml-auto truncate text-xs text-muted-foreground">
                            {grantedBy.map((r) => r.name).join(", ")}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

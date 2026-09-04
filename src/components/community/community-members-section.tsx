"use client";

import { useMutation, useQuery } from "convex/react";
import { Ban, Clock3, ExternalLink, MessageCircle, MoreVertical, Search, Shield, UserMinus, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useOpenProfileById } from "@/components/profile/profile-page";
import { useNavigation } from "@/components/home/navigation-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PERMISSION_LABELS, PERMISSIONS, hasPermission, type PermissionKey } from "@/lib/permissions";

type Member = {
  userId: Id<"users">;
  name: string;
  username: string;
  imageUrl?: string;
  isOwner: boolean;
  joinedAt?: number;
  timeoutUntil?: number;
  roles: { id: Id<"roles">; name: string; color?: string }[];
};

function formatDate(timestamp?: number): string {
  return timestamp ? new Date(timestamp).toLocaleDateString() : "—";
}

function MemberModerationDialog({
  communityId,
  member,
  open,
  onOpenChange,
  canKick,
  canBan,
  canTimeout,
}: {
  communityId: Id<"communities">;
  member: Member | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canKick: boolean;
  canBan: boolean;
  canTimeout: boolean;
}) {
  const stats = useQuery(
    api.communities.memberModerationStats,
    member && open ? { communityId, userId: member.userId } : "skip",
  );
  const kick = useMutation(api.communities.kickMember);
  const ban = useMutation(api.communities.banMember);
  const timeout = useMutation(api.communities.timeoutMember);
  const getOrCreateDirect = useMutation(api.conversations.getOrCreateDirect);
  const navigation = useNavigation();
  const openProfile = useOpenProfileById();

  if (!member) return null;
  const permissions = stats?.permissions ?? 0;
  const permissionKeys = (Object.keys(PERMISSIONS) as PermissionKey[]).filter((key) =>
    hasPermission(permissions, PERMISSIONS[key]),
  );
  const run = (action: () => Promise<unknown>) => void action().catch(() => {});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Avatar><AvatarImage src={member.imageUrl} /><AvatarFallback>{member.name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
            <span>{member.name}<span className="ml-2 text-sm font-normal text-muted-foreground">@{member.username}</span></span>
          </DialogTitle>
          <DialogDescription>Moderation view for this community member.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2">
          {([
            ["Messages", stats?.messages ?? 0, MessageCircle],
            ["Links", stats?.links ?? 0, ExternalLink],
            ["Media", stats?.media ?? 0, Users],
          ] as const).map(([label, count, Icon]) => (
            <div key={String(label)} className="rounded-lg border bg-muted/30 p-3">
              <Icon className="mb-2 size-4 text-muted-foreground" />
              <p className="text-xl font-semibold">{String(count)}</p>
              <p className="text-xs text-muted-foreground">{String(label)} sent</p>
            </div>
          ))}
        </div>

        <section className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Shield className="size-4" />Permissions</h3>
          <div className="flex flex-wrap gap-1.5 rounded-lg border bg-muted/20 p-3">
            {permissionKeys.length ? permissionKeys.map((key) => <Badge key={key} variant="secondary">{PERMISSION_LABELS[key]}</Badge>) : <span className="text-sm text-muted-foreground">No elevated permissions</span>}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Roles</h3>
          <div className="flex flex-wrap gap-1.5 rounded-lg border bg-muted/20 p-3">
            {stats?.roles?.length ? stats.roles.map((role) => <Badge key={role.id} style={role.color ? { color: role.color } : undefined}>{role.name}</Badge>) : <span className="text-sm text-muted-foreground">@everyone</span>}
          </div>
          <p className="text-xs text-muted-foreground">Joined {formatDate(stats?.joinedAt)}</p>
        </section>

        <DialogFooter className="flex-wrap sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => openProfile(member.userId, communityId)}>Open full profile</Button>
            {!member.isOwner && <Button variant="outline" onClick={() => void getOrCreateDirect({ friendId: member.userId }).then((id) => { onOpenChange(false); navigation.openConversation(id); }).catch(() => {})}><MessageCircle className="size-4" />Message</Button>}
          </div>
          <div className="flex gap-2">
            {canTimeout && !member.isOwner && <Button variant="outline" onClick={() => run(() => timeout({ communityId, userId: member.userId, durationMs: 60 * 60 * 1000 }))}><Clock3 className="size-4" />Timeout</Button>}
            {canKick && !member.isOwner && <Button variant="outline" onClick={() => run(() => kick({ communityId, userId: member.userId }))}><UserMinus className="size-4" />Kick</Button>}
            {canBan && !member.isOwner && <Button variant="destructive" onClick={() => run(() => ban({ communityId, userId: member.userId }))}><Ban className="size-4" />Ban</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CommunityMembersSection({
  communityId,
  permissions,
}: {
  communityId: Id<"communities">;
  permissions: number;
}) {
  const members = (useQuery(api.communities.listMembers, { communityId }) ?? []) as Member[];
  const roles = useQuery(api.roles.list, { communityId }) ?? [];
  const assign = useMutation(api.roles.assign);
  const unassign = useMutation(api.roles.unassign);
  const prune = useMutation(api.communities.pruneInactiveMembers);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Member | null>(null);
  const openProfile = useOpenProfileById();
  const canManageRoles = hasPermission(permissions, PERMISSIONS.MANAGE_ROLES);
  const canKick = hasPermission(permissions, PERMISSIONS.KICK_MEMBERS);
  const canBan = hasPermission(permissions, PERMISSIONS.BAN_MEMBERS);
  const canTimeout = hasPermission(permissions, PERMISSIONS.MODERATE_MEMBERS);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return members.filter((member) => !needle || member.name.toLowerCase().includes(needle) || member.username.toLowerCase().includes(needle));
  }, [members, search]);
  const assignableRoles = roles.filter((role) => !role.isEveryone);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
        <div className="flex items-center gap-2"><Users className="size-5" /><h1 className="text-lg font-semibold">Members</h1><span className="text-sm text-muted-foreground">{members.length}</span></div>
        <div className="relative ml-auto w-full sm:w-72"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search members" className="pl-9" /></div>
        <Button
          variant="outline"
          onClick={() => {
            const value = window.prompt("Remove members inactive for how many days?", "30");
            const days = value ? Number(value) : NaN;
            if (Number.isFinite(days) && days > 0 && window.confirm(`Remove members inactive for ${Math.floor(days)} days?`)) {
              void prune({ communityId, inactiveDays: days }).catch(() => {});
            }
          }}
        >Prune</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        <div className="overflow-hidden rounded-lg border">
          <div className="grid grid-cols-[minmax(220px,1fr)_minmax(140px,0.7fr)_minmax(180px,1fr)_44px] items-center border-b bg-muted/20 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"><span>Name</span><span>Member since</span><span>Roles</span><span /></div>
          {filtered.map((member) => {
            const roleIds = new Set(member.roles.map((role) => role.id));
            return <div key={member.userId} className="grid grid-cols-[minmax(220px,1fr)_minmax(140px,0.7fr)_minmax(180px,1fr)_44px] items-center border-b px-3 py-2 last:border-0 hover:bg-muted/20">
              <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => openProfile(member.userId, communityId)}><Avatar size="sm"><AvatarImage src={member.imageUrl} /><AvatarFallback>{member.name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar><span className="min-w-0"><span className="block truncate text-sm font-medium">{member.name}{member.isOwner && <Badge className="ml-2 text-[10px]">Owner</Badge>}</span><span className="block truncate text-xs text-muted-foreground">@{member.username}</span></span></button>
              <span className="text-sm text-muted-foreground">{formatDate(member.joinedAt)}</span>
              <div className="flex flex-wrap gap-1">
                {member.roles.map((role) => <Badge key={role.id} variant="secondary" style={role.color ? { color: role.color } : undefined}>{role.name}</Badge>)}
                {canManageRoles && assignableRoles.length > 0 && <div className="flex flex-wrap items-center gap-1">{assignableRoles.map((role) => <label key={role.id} title={`Toggle ${role.name}`} className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-muted"><Checkbox checked={roleIds.has(role.id)} onCheckedChange={(checked) => void (checked ? assign({ communityId, userId: member.userId, roleId: role.id }) : unassign({ communityId, userId: member.userId, roleId: role.id }))} />{role.name}</label>)}</div>}
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSelected(member)} aria-label={`Moderate ${member.name}`}><MoreVertical className="size-4" /></Button>
            </div>;
          })}
          {!filtered.length && <p className="p-8 text-center text-sm text-muted-foreground">No members match this search.</p>}
        </div>
      </div>
      <MemberModerationDialog communityId={communityId} member={selected} open={!!selected} onOpenChange={(open) => !open && setSelected(null)} canKick={canKick} canBan={canBan} canTimeout={canTimeout} />
    </div>
  );
}

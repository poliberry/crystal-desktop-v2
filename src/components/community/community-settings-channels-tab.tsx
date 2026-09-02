"use client";

import { useMutation, useQuery } from "convex/react";
import { Check, Minus, Trash2, X } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PERMISSION_LABELS, PERMISSIONS, type PermissionKey } from "@/lib/permissions";
import { cn } from "@/lib/utils";

interface CommunitySettingsChannelsTabProps {
  communityId: Id<"communities">;
  canManage: boolean;
}

export function CommunitySettingsChannelsTab({ communityId, canManage }: CommunitySettingsChannelsTabProps) {
  const channels = useQuery(api.channels.list, { communityId }) ?? [];
  const removeChannel = useMutation(api.channels.remove);
  const [expandedChannelId, setExpandedChannelId] = useState<Id<"channels"> | null>(null);

  return (
    <div className="space-y-2">
      {channels.map((channel: any) => (
        <div key={channel.id} className="rounded-md border">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{channel.name}</p>
              <p className="text-xs text-muted-foreground capitalize">{channel.type} channel</p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setExpandedChannelId((prev) => (prev === channel.id ? null : channel.id))
                }
              >
                {expandedChannelId === channel.id ? "Hide access" : "Manage access"}
              </Button>
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    if (confirm(`Delete #${channel.name}?`)) void removeChannel({ channelId: channel.id });
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          </div>
          {expandedChannelId === channel.id && (
            <div className="border-t p-3">
              <ChannelOverwrites communityId={communityId} channelId={channel.id} canManage={canManage} />
            </div>
          )}
        </div>
      ))}
      {channels.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">No channels yet.</p>
      )}
    </div>
  );
}

type OverwriteState = "inherit" | "allow" | "deny";

function nextState(state: OverwriteState): OverwriteState {
  if (state === "inherit") return "allow";
  if (state === "allow") return "deny";
  return "inherit";
}

function StateIcon({ state }: { state: OverwriteState }) {
  if (state === "allow") return <Check className="size-3.5" />;
  if (state === "deny") return <X className="size-3.5" />;
  return <Minus className="size-3.5" />;
}

function ChannelOverwrites({
  communityId,
  channelId,
  canManage,
}: {
  communityId: Id<"communities">;
  channelId: Id<"channels">;
  canManage: boolean;
}) {
  const overwrites = useQuery(api.channels.listOverwrites, { channelId }) ?? [];
  const roles = useQuery(api.roles.list, { communityId }) ?? [];
  const members = useQuery(api.communities.listMembers, { communityId }) ?? [];
  const setOverwrite = useMutation(api.channels.setOverwrite);
  const removeOverwrite = useMutation(api.channels.removeOverwrite);

  const [addRoleId, setAddRoleId] = useState<string>("");
  const [addUserId, setAddUserId] = useState<string>("");

  const roleById = new Map(roles.map((r) => [r.id, r]));
  const memberById = new Map(members.map((m) => [m.userId, m]));
  const overwrittenRoleIds = new Set(overwrites.filter((o) => o.roleId).map((o) => o.roleId));
  const overwrittenUserIds = new Set(overwrites.filter((o) => o.userId).map((o) => o.userId));

  const availableRoles = roles.filter((r) => !overwrittenRoleIds.has(r.id));
  const availableMembers = members.filter((m) => !overwrittenUserIds.has(m.userId));

  const flags = Object.entries(PERMISSIONS) as [PermissionKey, number][];

  const cycle = (overwriteId: Id<"channelPermissionOverwrites">, allow: number, deny: number, flag: number) => {
    const current: OverwriteState = allow & flag ? "allow" : deny & flag ? "deny" : "inherit";
    const next = nextState(current);
    const nextAllow = next === "allow" ? allow | flag : allow & ~flag;
    const nextDeny = next === "deny" ? deny | flag : deny & ~flag;
    const overwrite = overwrites.find((o) => o.id === overwriteId);
    if (!overwrite) return;
    void setOverwrite({
      channelId,
      roleId: overwrite.roleId,
      userId: overwrite.userId,
      allow: nextAllow,
      deny: nextDeny,
    });
  };

  return (
    <div className="space-y-3">
      {overwrites.length === 0 && (
        <p className="text-xs text-muted-foreground">No overwrites yet — everyone uses their role permissions.</p>
      )}

      {overwrites.map((overwrite) => {
        const label = overwrite.roleId
          ? (roleById.get(overwrite.roleId)?.name ?? "Unknown role")
          : `@${memberById.get(overwrite.userId!)?.username ?? "unknown"}`;

        return (
          <div key={overwrite.id} className="rounded-md border p-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">{label}</span>
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-destructive"
                  onClick={() => void removeOverwrite({ overwriteId: overwrite.id })}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {flags.map(([key, flag]) => {
                const state: OverwriteState =
                  overwrite.allow & flag ? "allow" : overwrite.deny & flag ? "deny" : "inherit";
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!canManage}
                    onClick={() => cycle(overwrite.id, overwrite.allow, overwrite.deny, flag)}
                    className={cn(
                      "flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-accent/60 disabled:cursor-not-allowed",
                      state === "allow" && "text-emerald-500",
                      state === "deny" && "text-destructive"
                    )}
                  >
                    <StateIcon state={state} />
                    <span className="truncate">{PERMISSION_LABELS[key]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Select value={addRoleId} onValueChange={setAddRoleId}>
            <SelectTrigger size="sm" className="w-40">
              <SelectValue placeholder="Add role…" />
            </SelectTrigger>
            <SelectContent>
              {availableRoles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={!addRoleId}
            onClick={() => {
              void setOverwrite({ channelId, roleId: addRoleId as Id<"roles">, allow: 0, deny: 0 });
              setAddRoleId("");
            }}
          >
            Add
          </Button>

          <Select value={addUserId} onValueChange={setAddUserId}>
            <SelectTrigger size="sm" className="w-40">
              <SelectValue placeholder="Add member…" />
            </SelectTrigger>
            <SelectContent>
              {availableMembers.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={!addUserId}
            onClick={() => {
              void setOverwrite({ channelId, userId: addUserId as Id<"users">, allow: 0, deny: 0 });
              setAddUserId("");
            }}
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}

"use client";

import { useMutation, useQuery } from "convex/react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PERMISSION_LABELS, PERMISSIONS, type PermissionKey } from "@/lib/permissions";
import { cn } from "@/lib/utils";

interface CommunitySettingsRolesTabProps {
  communityId: Id<"communities">;
  canManage: boolean;
}

type RoleDoc = {
  id: Id<"roles">;
  name: string;
  color?: string;
  permissions: number;
  position: number;
  isEveryone: boolean;
  hoist: boolean;
};

export function CommunitySettingsRolesTab({ communityId, canManage }: CommunitySettingsRolesTabProps) {
  const roles = useQuery(api.roles.list, { communityId }) ?? [];
  const createRole = useMutation(api.roles.create);
  const [selectedRoleId, setSelectedRoleId] = useState<Id<"roles"> | null>(null);

  useEffect(() => {
    if (!selectedRoleId && roles.length > 0) setSelectedRoleId(roles[0].id);
  }, [roles, selectedRoleId]);

  const selected = roles.find((r) => r.id === selectedRoleId) ?? null;

  return (
    <div className="grid grid-cols-[160px_1fr] gap-4">
      <div className="space-y-1">
        {roles.map((role) => (
          <button
            key={role.id}
            type="button"
            onClick={() => setSelectedRoleId(role.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/60",
              selectedRoleId === role.id && "bg-accent"
            )}
          >
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: role.color || "var(--muted-foreground)" }}
            />
            <span className="truncate">{role.name}</span>
          </button>
        ))}
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-1.5 text-muted-foreground"
            onClick={() => void createRole({ communityId, name: "new role" }).then(setSelectedRoleId)}
          >
            <Plus className="size-3.5" />
            New role
          </Button>
        )}
      </div>

      <div>{selected && <RoleEditor role={selected} canManage={canManage} />}</div>
    </div>
  );
}

function RoleEditor({ role, canManage }: { role: RoleDoc; canManage: boolean }) {
  const update = useMutation(api.roles.update);
  const remove = useMutation(api.roles.remove);

  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color ?? "#5865f2");
  const [permissions, setPermissions] = useState(role.permissions);
  const [hoist, setHoist] = useState(role.hoist);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(role.name);
    setColor(role.color ?? "#5865f2");
    setPermissions(role.permissions);
    setHoist(role.hoist);
  }, [role]);

  const togglePermission = (flag: number) => {
    setPermissions((prev) => (prev & flag ? prev & ~flag : prev | flag));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await update({ roleId: role.id, name: role.isEveryone ? undefined : name, color, permissions, hoist });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save role.");
    } finally {
      setSaving(false);
    }
  };

  const flags = Object.entries(PERMISSIONS) as [PermissionKey, number][];

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="role-name">Name</Label>
          <Input
            id="role-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canManage || role.isEveryone}
            maxLength={32}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="role-color">Color</Label>
          <input
            id="role-color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            disabled={!canManage}
            className="h-9 w-12 rounded-md border bg-transparent"
          />
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox checked={hoist} onCheckedChange={(checked) => setHoist(checked === true)} disabled={!canManage} />
        Display members with this role separately in the member list
      </label>

      <div className="space-y-1.5">
        <Label>Permissions</Label>
        <ScrollArea className="h-56 rounded-md border p-2">
          <div className="flex flex-col gap-2">
            {flags.map(([key, flag]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={(permissions & flag) !== 0}
                  onCheckedChange={() => togglePermission(flag)}
                  disabled={!canManage}
                />
                {PERMISSION_LABELS[key]}
              </label>
            ))}
          </div>
        </ScrollArea>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {canManage && (
        <div className="flex items-center gap-2">
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save role"}
          </Button>
          {!role.isEveryone && (
            <Button
              variant="ghost"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => {
                if (confirm(`Delete the "${role.name}" role?`)) void remove({ roleId: role.id });
              }}
            >
              <Trash2 className="size-4" />
              Delete role
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

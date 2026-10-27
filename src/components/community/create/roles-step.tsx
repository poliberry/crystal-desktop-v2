"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  ROLE_PERMISSION_PRESETS,
  type SetupRole,
  SETUP_LIMITS,
  permissionPresetFor,
} from "@/lib/community-templates";

const SWATCHES = ["#ef4444", "#f59e0b", "#22c55e", "#14b8a6", "#3b82f6", "#a855f7", "#ec4899"];

/** The roles, highest first — a role outranks the ones below it in the list. */
export function RolesStep({
  roles,
  onChange,
}: {
  roles: SetupRole[];
  onChange: (roles: SetupRole[]) => void;
}) {
  const update = (index: number, patch: Partial<SetupRole>) =>
    onChange(roles.map((role, i) => (i === index ? { ...role, ...patch } : role)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= roles.length) return;
    const next = [...roles];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {roles.map((role, index) => (
        <div
          key={index}
          className="space-y-2.5 rounded-lg border border-foreground/10 bg-gradient-to-br from-foreground/[0.07] to-transparent p-3"
        >
          <div className="flex items-center gap-2">
            <label
              className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-md border border-foreground/15"
              style={{ background: role.color ?? "var(--muted)" }}
              title="Role colour"
            >
              <input
                type="color"
                value={role.color ?? "#99aab5"}
                onChange={(event) => update(index, { color: event.target.value })}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
                aria-label="Role colour"
              />
            </label>
            <Input
              value={role.name}
              maxLength={64}
              placeholder="Role name"
              aria-label="Role name"
              onChange={(event) => update(index, { name: event.target.value })}
              className="h-8"
            />
            <div className="flex shrink-0 items-center">
              <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>
                <ArrowUp className="size-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="size-7" aria-label="Move down" disabled={index === roles.length - 1} onClick={() => move(index, 1)}>
                <ArrowDown className="size-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="size-7 text-destructive" aria-label="Remove role" onClick={() => onChange(roles.filter((_, i) => i !== index))}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={permissionPresetFor(role.permissions)}
              onValueChange={(id) => {
                const preset = ROLE_PERMISSION_PRESETS.find((p) => p.id === id);
                if (preset) update(index, { permissions: preset.permissions });
              }}
            >
              <SelectTrigger size="sm" className="w-44" aria-label="Permissions">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_PERMISSION_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.label}
                  </SelectItem>
                ))}
                {permissionPresetFor(role.permissions) === "custom" && (
                  <SelectItem value="custom" disabled>
                    Custom
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={!!role.hoist}
                onCheckedChange={(hoist) => update(index, { hoist })}
              />
              Show members separately
            </label>
            <div className="ml-auto flex gap-1">
              {SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  aria-label={`Use ${swatch}`}
                  onClick={() => update(index, { color: swatch })}
                  className="size-4 rounded-full border border-foreground/20"
                  style={{ background: swatch }}
                />
              ))}
            </div>
          </div>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={roles.length >= SETUP_LIMITS.roles}
        onClick={() =>
          onChange([
            ...roles,
            {
              name: "New role",
              color: SWATCHES[roles.length % SWATCHES.length],
              permissions: ROLE_PERMISSION_PRESETS[2].permissions,
              hoist: true,
            },
          ])
        }
      >
        <Plus className="size-3.5" />
        Add a role
      </Button>
    </div>
  );
}

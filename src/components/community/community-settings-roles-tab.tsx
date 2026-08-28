"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  GripVertical,
  Hash,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  PERMISSION_DESCRIPTIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  PERMISSIONS,
  type PermissionKey,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";

interface CommunitySettingsRolesTabProps {
  communityId: Id<"communities">;
  canManage: boolean;
}

interface RoleDoc {
  id: Id<"roles">;
  name: string;
  color?: string;
  permissions: number;
  position: number;
  isEveryone: boolean;
  hoist: boolean;
  memberCount: number;
}

/** Colours offered as swatches. Two rows of the same hues, the second darker,
 * matching the shape of the picker people already know — with a custom colour
 * always available beside them for anything not on the grid. */
const COLOR_SWATCHES = [
  ["#1abc9c", "#2ecc71", "#3498db", "#9b59b6", "#e91e63", "#f1c40f", "#e67e22", "#e74c3c", "#95a5a6", "#607d8b"],
  ["#11806a", "#1f8b4c", "#206694", "#71368a", "#ad1457", "#c27c0e", "#a84300", "#992d22", "#979c9f", "#546e7a"],
];

/** What a role with no colour of its own renders as. Matches the member list,
 * where an uncoloured role leaves the name at the default text colour. */
const NO_COLOR = "var(--muted-foreground)";

function roleColor(role: { color?: string }): string {
  return role.color || NO_COLOR;
}

/** The round, tinted glyph on each row — a role's stand-in for an icon. */
function RoleGlyph({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", className)}
      style={{ backgroundColor: color }}
    >
      <UserRound className="size-3.5 text-background" strokeWidth={2.5} />
    </span>
  );
}

/**
 * Community settings → Roles.
 *
 * Two views rather than one: a list of every role, and a full-width editor for
 * one of them. They're separate because they want the whole panel — the list
 * needs room for a member count and a row of actions, and the editor for a
 * permission list with a sentence of explanation under each toggle. Squeezing
 * both into one screen is what made the old two-column version unreadable.
 */
export function CommunitySettingsRolesTab({
  communityId,
  canManage,
}: CommunitySettingsRolesTabProps) {
  const roles = (useQuery(api.roles.list, { communityId }) ?? []) as RoleDoc[];
  const [editingRoleId, setEditingRoleId] = useState<Id<"roles"> | null>(null);

  // A role deleted from under the editor (by someone else, or by the editor's
  // own menu) falls back to the list rather than showing an empty pane.
  useEffect(() => {
    if (editingRoleId && roles.length > 0 && !roles.some((r) => r.id === editingRoleId)) {
      setEditingRoleId(null);
    }
  }, [roles, editingRoleId]);

  if (editingRoleId) {
    return (
      <RoleEditorView
        communityId={communityId}
        roles={roles}
        roleId={editingRoleId}
        canManage={canManage}
        onSelectRole={setEditingRoleId}
        onBack={() => setEditingRoleId(null)}
      />
    );
  }

  return (
    <RolesListView
      communityId={communityId}
      roles={roles}
      canManage={canManage}
      onEdit={setEditingRoleId}
    />
  );
}

// --- list view -------------------------------------------------------------

function RolesListView({
  communityId,
  roles,
  canManage,
  onEdit,
}: {
  communityId: Id<"communities">;
  roles: RoleDoc[];
  canManage: boolean;
  onEdit: (roleId: Id<"roles">) => void;
}) {
  const createRole = useMutation(api.roles.create);
  const reorder = useMutation(api.roles.reorder);
  const [search, setSearch] = useState("");

  const everyone = roles.find((r) => r.isEveryone) ?? null;
  const ranked = useMemo(() => roles.filter((r) => !r.isEveryone), [roles]);

  /** Order held locally while dragging so the row follows the cursor without
   * waiting for the mutation to round-trip. Reset whenever the server's order
   * changes, which includes the moment our own write lands. */
  const [order, setOrder] = useState<Id<"roles">[]>(() => ranked.map((r) => r.id));
  const serverOrder = ranked.map((r) => r.id).join(",");
  useEffect(() => {
    setOrder(serverOrder ? (serverOrder.split(",") as Id<"roles">[]) : []);
  }, [serverOrder]);

  const byId = new Map(ranked.map((r) => [r.id as string, r]));
  const ordered = order.map((id) => byId.get(id as string)).filter((r): r is RoleDoc => !!r);
  const visible = search
    ? ordered.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
    : ordered;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(active.id as Id<"roles">);
    const to = order.indexOf(over.id as Id<"roles">);
    if (from < 0 || to < 0) return;
    const next = arrayMove(order, from, to);
    setOrder(next);
    void reorder({ communityId, orderedIds: next }).catch(() => {
      // Server rejected it (someone else reordered, or the move crossed the
      // caller's own rank) — snap back to whatever it actually is.
      setOrder(ranked.map((r) => r.id));
    });
  };

  return (
    <div className="flex flex-col gap-5 p-10">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Roles</h1>
        <p className="text-sm text-muted-foreground">
          Use roles to group your server members and assign permissions.
        </p>
      </div>

      {everyone && (
        <button
          type="button"
          onClick={() => onEdit(everyone.id)}
          className="flex items-center gap-3 rounded-lg border bg-card/60 px-4 py-3 text-left transition-colors hover:bg-accent/50"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
            <Users className="size-4 text-muted-foreground" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Default Permissions</span>
            <span className="block text-xs text-muted-foreground">
              @everyone · applies to all server members
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      )}

      <div className="flex items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Roles"
            className="pl-9"
          />
        </div>
        {canManage && (
          <Button
            onClick={() => void createRole({ communityId, name: "new role" }).then(onEdit)}
          >
            Create Role
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        Members use the color of the highest role they have on this list.
        {canManage ? " Drag roles to reorder them." : ""}
      </p>

      <div>
        <div className="grid grid-cols-[1fr_120px_112px] items-center border-b px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Roles – {ranked.length}</span>
          <span>Members</span>
          <span />
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visible.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            {visible.map((role) => (
              <RoleRow
                key={role.id}
                role={role}
                canManage={canManage}
                // Dragging a filtered list would reorder against rows that
                // aren't on screen, so the handle only appears on the full one.
                draggable={canManage && !search}
                onEdit={() => onEdit(role.id)}
              />
            ))}
          </SortableContext>
        </DndContext>

        {visible.length === 0 && (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">
            {search ? "No roles match that search." : "This server has no roles yet."}
          </p>
        )}
      </div>
    </div>
  );
}

function RoleRow({
  role,
  canManage,
  draggable,
  onEdit,
}: {
  role: RoleDoc;
  canManage: boolean;
  draggable: boolean;
  onEdit: () => void;
}) {
  const remove = useMutation(api.roles.remove);
  const duplicate = useMutation(api.roles.duplicate);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: role.id,
    disabled: !draggable,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group grid grid-cols-[1fr_120px_112px] items-center border-b px-2 py-2.5",
        isDragging ? "z-10 bg-accent/60 opacity-90" : "hover:bg-accent/30"
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {draggable ? (
          <span
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${role.name}`}
            className="cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </span>
        ) : (
          <span className="size-4" />
        )}
        <RoleGlyph color={roleColor(role)} />
        <span className="truncate text-sm font-medium" style={{ color: roleColor(role) }}>
          {role.name}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {role.memberCount}
        <UserRound className="size-3.5" />
      </div>

      <div className="flex items-center justify-end gap-1.5">
        <Button variant="secondary" size="icon" aria-label={`Edit ${role.name}`} onClick={onEdit}>
          <Pencil className="size-4" />
        </Button>
        {canManage && !role.isEveryone && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" aria-label={`More options for ${role.name}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void duplicate({ roleId: role.id })}>
                <Copy className="size-4" />
                Duplicate Role
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void navigator.clipboard.writeText(role.id).catch(() => {})}
              >
                <Hash className="size-4" />
                Copy Role ID
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  if (confirm(`Delete the "${role.name}" role?`)) void remove({ roleId: role.id });
                }}
              >
                <Trash2 className="size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

// --- editor ----------------------------------------------------------------

type EditorTab = "display" | "permissions" | "members";

function RoleEditorView({
  communityId,
  roles,
  roleId,
  canManage,
  onSelectRole,
  onBack,
}: {
  communityId: Id<"communities">;
  roles: RoleDoc[];
  roleId: Id<"roles">;
  canManage: boolean;
  onSelectRole: (roleId: Id<"roles">) => void;
  onBack: () => void;
}) {
  const createRole = useMutation(api.roles.create);
  const update = useMutation(api.roles.update);
  const remove = useMutation(api.roles.remove);
  const duplicate = useMutation(api.roles.duplicate);

  const role = roles.find((r) => r.id === roleId);
  const [tab, setTab] = useState<EditorTab>("display");

  const [name, setName] = useState(role?.name ?? "");
  const [color, setColor] = useState(role?.color ?? "");
  const [permissions, setPermissions] = useState(role?.permissions ?? 0);
  const [hoist, setHoist] = useState(role?.hoist ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when the editor is pointed at a different role. Keyed on the id
  // rather than the whole document so an edit landing from elsewhere doesn't
  // wipe out what's being typed here.
  useEffect(() => {
    const next = roles.find((r) => r.id === roleId);
    if (!next) return;
    setName(next.name);
    setColor(next.color ?? "");
    setPermissions(next.permissions);
    setHoist(next.hoist);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId]);

  if (!role) return null;

  const dirty =
    name !== role.name ||
    (color || undefined) !== role.color ||
    permissions !== role.permissions ||
    hoist !== role.hoist;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await update({
        roleId: role.id,
        name: role.isEveryone ? undefined : name,
        color: color || undefined,
        permissions,
        hoist,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save role.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 p-10">
      {/* Role switcher — the whole point of the editor taking the panel over:
          jumping between roles without going back to the list first. */}
      <div className="flex w-56 shrink-0 flex-col border-r">
        <div className="flex items-center justify-between gap-2 px-3 py-3">
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs font-semibold uppercase" onClick={onBack}>
            <ArrowLeft className="size-4" />
            Back
          </Button>
          {canManage && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Create role"
              onClick={() => void createRole({ communityId, name: "new role" }).then(onSelectRole)}
            >
              <Plus className="size-4" />
            </Button>
          )}
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-0.5 px-2 pb-3">
            {roles.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelectRole(entry.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/60",
                  entry.id === roleId && "bg-accent"
                )}
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: roleColor(entry) }}
                />
                <span className="truncate">{entry.name}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 px-6 pt-5">
          <h2 className="min-w-0 truncate text-sm font-semibold uppercase tracking-wide">
            Edit Role — {role.name}
          </h2>
          {canManage && !role.isEveryone && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Role options">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void duplicate({ roleId: role.id }).then(onSelectRole)}>
                  <Copy className="size-4" />
                  Duplicate Role
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => void navigator.clipboard.writeText(role.id).catch(() => {})}
                >
                  <Hash className="size-4" />
                  Copy Role ID
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => {
                    if (confirm(`Delete the "${role.name}" role?`)) {
                      void remove({ roleId: role.id }).then(onBack);
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex items-center gap-6 border-b px-6">
          {(
            [
              ["display", "Display"],
              ["permissions", "Permissions"],
              ["members", `Manage Members (${role.memberCount})`],
            ] as [EditorTab, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                "-mb-px border-b-2 px-1 py-3 text-sm transition-colors",
                tab === value
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="px-6 py-5">
            {tab === "display" && (
              <DisplayTab
                role={role}
                canManage={canManage}
                name={name}
                setName={setName}
                color={color}
                setColor={setColor}
                hoist={hoist}
                setHoist={setHoist}
              />
            )}
            {tab === "permissions" && (
              <PermissionsTab
                permissions={permissions}
                setPermissions={setPermissions}
                canManage={canManage}
              />
            )}
            {tab === "members" && (
              <ManageMembersTab communityId={communityId} role={role} canManage={canManage} />
            )}
          </div>
        </ScrollArea>

        {/* Only Display and Permissions are drafts — member changes apply as
            they're made, so the bar is about the two that need a commit. */}
        {canManage && dirty && tab !== "members" && (
          <div className="flex items-center justify-between gap-3 border-t bg-card px-6 py-3">
            <p className="text-sm text-muted-foreground">
              {error ?? "You have unsaved changes."}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setName(role.name);
                  setColor(role.color ?? "");
                  setPermissions(role.permissions);
                  setHoist(role.hoist);
                  setError(null);
                }}
              >
                Reset
              </Button>
              <Button disabled={saving} onClick={() => void save()}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : "Save Changes"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DisplayTab({
  role,
  canManage,
  name,
  setName,
  color,
  setColor,
  hoist,
  setHoist,
}: {
  role: RoleDoc;
  canManage: boolean;
  name: string;
  setName: (value: string) => void;
  color: string;
  setColor: (value: string) => void;
  hoist: boolean;
  setHoist: (value: boolean) => void;
}) {
  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Label htmlFor="role-name">
          Role name <span className="text-destructive">*</span>
        </Label>
        <Input
          id="role-name"
          value={name}
          maxLength={32}
          disabled={!canManage || role.isEveryone}
          onChange={(e) => setName(e.target.value)}
        />
        {role.isEveryone && (
          <p className="text-xs text-muted-foreground">@everyone can&apos;t be renamed.</p>
        )}
      </div>

      <div className="space-y-2">
        <Label>
          Role color <span className="text-destructive">*</span>
        </Label>
        <p className="text-sm text-muted-foreground">
          Members use the color of the highest role they have on the roles list.
        </p>
        <div className="flex items-start gap-2 pt-1">
          <button
            type="button"
            disabled={!canManage}
            onClick={() => setColor("")}
            aria-label="No color"
            className={cn(
              "size-14 shrink-0 rounded-md border-2 bg-muted",
              color ? "border-transparent" : "border-primary"
            )}
          />
          <label
            className={cn(
              "relative size-14 shrink-0 overflow-hidden rounded-md border-2 border-transparent",
              canManage ? "cursor-pointer" : "cursor-not-allowed"
            )}
            style={{ backgroundColor: color || "var(--muted)" }}
          >
            <Pencil className="absolute bottom-1 right-1 size-3.5 text-background mix-blend-difference" />
            <input
              type="color"
              value={color || "#5865f2"}
              disabled={!canManage}
              onChange={(e) => setColor(e.target.value)}
              className="size-full cursor-pointer opacity-0"
            />
          </label>
          <div className="flex flex-col gap-1">
            {COLOR_SWATCHES.map((row, rowIndex) => (
              <div key={rowIndex} className="flex gap-1">
                {row.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    disabled={!canManage}
                    aria-label={swatch}
                    onClick={() => setColor(swatch)}
                    className={cn(
                      "size-6 rounded-full border-2",
                      color.toLowerCase() === swatch ? "border-foreground" : "border-transparent"
                    )}
                    style={{ backgroundColor: swatch }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-start justify-between gap-6 rounded-lg border p-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">Display role members separately</p>
          <p className="text-sm text-muted-foreground">
            Members with this role get their own heading in the member list, above everyone
            without it.
          </p>
        </div>
        <Switch checked={hoist} onCheckedChange={setHoist} disabled={!canManage} />
      </div>
    </div>
  );
}

function PermissionsTab({
  permissions,
  setPermissions,
  canManage,
}: {
  permissions: number;
  setPermissions: (updater: (previous: number) => number) => void;
  canManage: boolean;
}) {
  const [search, setSearch] = useState("");

  // Anything not filed under a group still has to be editable — a permission
  // that exists but can't be granted is worse than an ugly heading.
  const grouped = useMemo(() => {
    const claimed = new Set(PERMISSION_GROUPS.flatMap((group) => group.keys));
    const leftovers = (Object.keys(PERMISSIONS) as PermissionKey[]).filter(
      (key) => !claimed.has(key)
    );
    return leftovers.length > 0
      ? [...PERMISSION_GROUPS, { title: "Other Permissions", keys: leftovers }]
      : PERMISSION_GROUPS;
  }, []);

  const query = search.trim().toLowerCase();
  const matches = (key: PermissionKey) =>
    !query ||
    PERMISSION_LABELS[key].toLowerCase().includes(query) ||
    PERMISSION_DESCRIPTIONS[key].toLowerCase().includes(query);

  const visibleGroups = grouped
    .map((group) => ({ ...group, keys: group.keys.filter(matches) }))
    .filter((group) => group.keys.length > 0);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search permissions"
          className="pl-9"
        />
      </div>

      {visibleGroups.map((group) => (
        <div key={group.title} className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">{group.title}</h3>
            {canManage && (
              <Button
                variant="link"
                className="h-auto p-0 text-sm"
                onClick={() =>
                  setPermissions((previous) =>
                    group.keys.reduce((acc, key) => acc & ~PERMISSIONS[key], previous)
                  )
                }
              >
                Clear permissions
              </Button>
            )}
          </div>
          {group.keys.map((key) => (
            <div key={key} className="flex items-start justify-between gap-6 border-b py-3">
              <div className="space-y-0.5">
                <p className="text-sm font-semibold">{PERMISSION_LABELS[key]}</p>
                <p className="text-sm text-muted-foreground">{PERMISSION_DESCRIPTIONS[key]}</p>
              </div>
              <Switch
                checked={(permissions & PERMISSIONS[key]) !== 0}
                disabled={!canManage}
                onCheckedChange={() =>
                  setPermissions((previous) =>
                    previous & PERMISSIONS[key]
                      ? previous & ~PERMISSIONS[key]
                      : previous | PERMISSIONS[key]
                  )
                }
              />
            </div>
          ))}
        </div>
      ))}

      {visibleGroups.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No permissions match that search.
        </p>
      )}
    </div>
  );
}

function ManageMembersTab({
  communityId,
  role,
  canManage,
}: {
  communityId: Id<"communities">;
  role: RoleDoc;
  canManage: boolean;
}) {
  const members = useQuery(api.roles.listMembers, { roleId: role.id }) ?? [];
  const unassign = useMutation(api.roles.unassign);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const query = search.trim().toLowerCase();
  const visible = query
    ? members.filter(
        (m) => m.name.toLowerCase().includes(query) || m.username.toLowerCase().includes(query)
      )
    : members;

  if (role.isEveryone) {
    return (
      <p className="max-w-2xl text-sm text-muted-foreground">
        Every member of this server has @everyone. It can&apos;t be added or removed.
      </p>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Members"
            className="pl-9"
          />
        </div>
        {canManage && <Button onClick={() => setAdding(true)}>Add Members</Button>}
      </div>

      <div className="flex flex-col">
        {visible.map((member) => (
          <div
            key={member.userId}
            className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-accent/40"
          >
            <Avatar size="sm">
              <AvatarImage src={member.imageUrl} alt={member.name} />
              <AvatarFallback>{member.name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 truncate text-sm">
              <span className="font-medium">{member.name}</span>{" "}
              <span className="text-muted-foreground">{member.username}</span>
            </span>
            {canManage && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${member.name} from ${role.name}`}
                onClick={() =>
                  void unassign({ communityId, userId: member.userId, roleId: role.id })
                }
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
        ))}
        {visible.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {query ? "No members match that search." : "No one has this role yet."}
          </p>
        )}
      </div>

      <AddMembersDialog
        communityId={communityId}
        role={role}
        existing={members.map((m) => m.userId)}
        open={adding}
        onOpenChange={setAdding}
      />
    </div>
  );
}

function AddMembersDialog({
  communityId,
  role,
  existing,
  open,
  onOpenChange,
}: {
  communityId: Id<"communities">;
  role: RoleDoc;
  existing: Id<"users">[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const everyone = useQuery(api.communities.listMembers, open ? { communityId } : "skip") ?? [];
  const assign = useMutation(api.roles.assign);
  const [search, setSearch] = useState("");

  const held = new Set(existing.map((id) => id as string));
  const query = search.trim().toLowerCase();
  const candidates = everyone
    .filter((m) => !held.has(m.userId as string))
    .filter(
      (m) =>
        !query ||
        m.name.toLowerCase().includes(query) ||
        m.username.toLowerCase().includes(query)
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add members to {role.name}</DialogTitle>
          <DialogDescription>
            They keep every other role they already have.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members"
            className="pl-9"
            autoFocus
          />
        </div>

        <ScrollArea className="h-72">
          <div className="flex flex-col pr-3">
            {candidates.map((member) => (
              <button
                key={member.userId}
                type="button"
                onClick={() =>
                  void assign({ communityId, userId: member.userId, roleId: role.id })
                }
                className="flex items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-accent/60"
              >
                <Avatar size="sm">
                  <AvatarImage src={member.imageUrl} alt={member.name} />
                  <AvatarFallback>{member.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-medium">{member.name}</span>{" "}
                  <span className="text-muted-foreground">{member.username}</span>
                </span>
                <Plus className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
            {candidates.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Everyone matching is already in this role.
              </p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

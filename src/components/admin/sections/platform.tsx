"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Loader2, Megaphone, ScrollText, Search, Send, Settings2, ShieldAlert, UserRoundPlus, Users, X } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ROLE_LABELS, ROLE_PERMISSIONS, STAFF_ROLES, type StaffRole } from "../../../../convex/lib/staffPermissions";
import {
  EmptyState,
  ListRow,
  Loading,
  PageHeader,
  Panel,
  Person,
  PillTabs,
  StatusPill,
  useRun,
  useStaff,
} from "@/components/admin/admin-ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatRelative } from "@/lib/money";
import { cn } from "@/lib/utils";

// --- System messages ----------------------------------------------------------------------------

export function BroadcastSection() {
  const send = useMutation(api.systemMessages.send);
  const { run, busy } = useRun();
  const [audience, setAudience] = useState<"all" | "user">("user");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<{ id: Id<"users">; username: string; name: string } | null>(null);
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);
  const results = useQuery(api.operations.users, audience === "user" && search.trim().length > 1 ? { search } : "skip");

  const ready = body.trim().length > 0 && (audience === "all" || !!picked);

  const deliver = async () => {
    const result = await run(
      "send",
      () => send(audience === "all" ? { audience, body } : { audience, userId: picked!.id, body }),
    );
    if (result) {
      setBody("");
      setConfirming(false);
      setPicked(null);
      setSearch("");
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader
        title="System messages"
        description="Send a direct message from the official Crystal account — to one person, or everyone."
        icon={Megaphone}
      />
      <Panel>
        <div className="space-y-4">
          <PillTabs
            value={audience}
            onChange={(a) => {
              setAudience(a);
              setPicked(null);
            }}
            tabs={[
              { id: "user", label: "One person" },
              { id: "all", label: "Everyone" },
            ]}
          />

          {audience === "user" && (
            <div className="space-y-2">
              {picked ? (
                <div className="flex items-center justify-between rounded-lg bg-foreground/5 px-3 py-2">
                  <Person user={picked} />
                  <Button size="icon" variant="ghost" className="size-7" onClick={() => setPicked(null)}>
                    <X />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a person" className="pl-9" />
                  </div>
                  {results && results.length > 0 && (
                    <div className="max-h-48 divide-y divide-foreground/10 overflow-y-auto rounded-lg border border-foreground/10">
                      {results.slice(0, 8).map((u) => (
                        <ListRow key={u.id} onOpen={() => setPicked({ id: u.id, username: u.username, name: u.name })}>
                          <Person user={u} />
                        </ListRow>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {audience === "all" && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-500">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              This lands in the inbox of every member, up to the first thousand. It can&apos;t be unsent.
            </p>
          )}

          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message" className="min-h-32" maxLength={4000} />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{body.length} / 4000</span>
            <Button
              disabled={!ready || busy === "send"}
              onClick={() => (audience === "all" ? setConfirming(true) : void deliver())}
            >
              {busy === "send" ? <Loader2 className="animate-spin" /> : <Send />} Send
            </Button>
          </div>
        </div>
      </Panel>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send to everyone?</DialogTitle>
            <DialogDescription>This message goes to every member from the Crystal account.</DialogDescription>
          </DialogHeader>
          <p className="max-h-40 overflow-y-auto rounded-lg bg-foreground/5 p-3 text-sm whitespace-pre-wrap">{body}</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Not yet
            </Button>
            <Button disabled={busy === "send"} onClick={() => void deliver()}>
              {busy === "send" && <Loader2 className="animate-spin" />} Send to everyone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- System account -----------------------------------------------------------------------------

export function SystemAccountSection() {
  const account = useQuery(api.systemAccount.get);
  const generateUploadUrl = useMutation(api.systemAccount.generateUploadUrl);
  const update = useMutation(api.systemAccount.update);
  const { run, busy } = useRun();
  const [bio, setBio] = useState<string | null>(null);
  const avatar = useRef<HTMLInputElement>(null);
  const banner = useRef<HTMLInputElement>(null);

  const upload = (kind: "avatar" | "banner", file: File | undefined) =>
    file &&
    run(kind, async () => {
      const url = await generateUploadUrl({});
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!res.ok) throw new Error("Upload failed.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await update(kind === "avatar" ? { avatarStorageId: storageId } : { bannerStorageId: storageId });
    }, kind === "avatar" ? "Avatar updated." : "Banner updated.");

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="System account" description="Crystal's official identity: the face on every system message." icon={Settings2} />
      {account === undefined ? (
        <Loading />
      ) : (
        <Panel flush>
          <div
            className="relative h-36 bg-cover bg-center"
            style={account.bannerUrl ? { backgroundImage: `url(${account.bannerUrl})` } : { backgroundImage: "linear-gradient(135deg, var(--primary), transparent)" }}
          >
            <Button size="sm" variant="secondary" className="absolute top-3 right-3" disabled={busy === "banner"} onClick={() => banner.current?.click()}>
              {busy === "banner" && <Loader2 className="animate-spin" />} Change banner
            </Button>
          </div>
          <div className="space-y-4 p-5">
            <div className="-mt-14 flex items-end gap-4">
              <Avatar className="size-20 ring-4 ring-card">
                <AvatarImage src={account.imageUrl} alt="" />
                <AvatarFallback>{account.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="pb-1">
                <p className="text-lg font-semibold">{account.name}</p>
                <p className="text-sm text-muted-foreground">@{account.username}</p>
              </div>
              <Button size="sm" variant="outline" className="mb-1 ml-auto" disabled={busy === "avatar"} onClick={() => avatar.current?.click()}>
                {busy === "avatar" && <Loader2 className="animate-spin" />} Change avatar
              </Button>
            </div>
            <Textarea value={bio ?? account.bio} onChange={(e) => setBio(e.target.value)} className="min-h-24" maxLength={300} placeholder="Bio" />
            <div className="flex justify-end">
              <Button disabled={bio === null || busy === "bio"} onClick={() => void run("bio", () => update({ bio: bio ?? "" }), "Saved.").then(() => setBio(null))}>
                {busy === "bio" && <Loader2 className="animate-spin" />} Save bio
              </Button>
            </div>
          </div>
          {(["avatar", "banner"] as const).map((kind) => (
            <input
              key={kind}
              ref={kind === "avatar" ? avatar : banner}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                void upload(kind, e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          ))}
        </Panel>
      )}
    </div>
  );
}

// --- Staff & roles ------------------------------------------------------------------------------

const ROLE_BLURB: Record<StaffRole, string> = {
  owner: "Everything except money. Manages staff.",
  admin: "Catalogue, pricing, accounts, communities and reports.",
  moderator: "Reports, and acting on accounts and communities.",
  support: "Reads accounts and answers customers.",
  finance: "Revenue, orders, refunds and payouts. Separate from every other role.",
};

function GrantDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: { username: string; roles: StaffRole[] };
}) {
  const grant = useMutation(api.staff.grant);
  const [username, setUsername] = useState(initial?.username ?? "");
  const [roles, setRoles] = useState<StaffRole[]>(initial?.roles ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUsername(initial?.username ?? "");
      setRoles(initial?.roles ?? []);
      setError(null);
    }
  }, [open, initial]);

  const toggle = (role: StaffRole) => setRoles((r) => (r.includes(role) ? r.filter((x) => x !== role) : [...r, role]));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await grant({ username, roles });
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? `Roles for @${initial.username}` : "Add staff"}</DialogTitle>
          <DialogDescription>Access is checked on the server for every action; this only decides what they are allowed to try.</DialogDescription>
        </DialogHeader>
        {!initial && <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" autoFocus />}
        <div className="space-y-1.5">
          {STAFF_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => toggle(role)}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                roles.includes(role) ? "border-primary/50 bg-primary/10" : "border-foreground/10 hover:bg-foreground/5",
              )}
            >
              <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border", roles.includes(role) ? "border-primary bg-primary text-primary-foreground" : "border-foreground/30")}>
                {roles.includes(role) && <Check className="size-3" />}
              </span>
              <span>
                <span className="block text-sm font-medium">{ROLE_LABELS[role]}</span>
                <span className="block text-xs text-muted-foreground">{ROLE_BLURB[role]}</span>
              </span>
            </button>
          ))}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || roles.length === 0 || !username.trim()} onClick={() => void save()}>
            {busy && <Loader2 className="animate-spin" />} {initial ? "Save roles" : "Grant access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StaffSection() {
  const me = useStaff();
  const rows = useQuery(api.staff.list);
  const revoke = useMutation(api.staff.revoke);
  const { run, busy } = useRun();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ username: string; roles: StaffRole[] } | null>(null);
  const [revoking, setRevoking] = useState<{ id: Id<"staffMembers">; username: string } | null>(null);
  const [showMatrix, setShowMatrix] = useState(false);

  const active = rows?.filter((r) => !r.revokedAt) ?? [];
  const former = rows?.filter((r) => r.revokedAt) ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Staff & roles"
        description="Who can use this console, and what they can do in it. Every change is in the audit log."
        icon={Users}
        actions={
          <Button onClick={() => setAdding(true)}>
            <UserRoundPlus /> Add staff
          </Button>
        }
      />

      <Panel flush title={`${active.length} with access`}>
        {rows === undefined ? (
          <Loading />
        ) : (
          <div className="divide-y divide-foreground/10">
            {active.map((r) => (
              <ListRow key={r.id}>
                <Person user={r} className="flex-1" />
                <div className="flex flex-wrap justify-end gap-1">
                  {r.roles.map((role) => (
                    <StatusPill key={role} tone={role === "finance" ? "warn" : "info"}>
                      {ROLE_LABELS[role]}
                    </StatusPill>
                  ))}
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditing({ username: r.username, roles: r.roles })}>
                  Roles
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={r.userId === me.userId || busy === r.id}
                  title={r.userId === me.userId ? "You can't remove your own access" : undefined}
                  onClick={() => setRevoking({ id: r.id as Id<"staffMembers">, username: r.username })}
                >
                  Remove
                </Button>
              </ListRow>
            ))}
          </div>
        )}
      </Panel>

      {former.length > 0 && (
        <Panel flush title="Former staff">
          <div className="divide-y divide-foreground/10">
            {former.map((r) => (
              <ListRow key={r.id}>
                <Person user={r} className="flex-1" />
                <span className="text-xs text-muted-foreground">Removed {r.revokedAt ? formatDate(r.revokedAt) : ""}</span>
              </ListRow>
            ))}
          </div>
        </Panel>
      )}

      <Panel
        title="What each role can do"
        actions={
          <Button size="sm" variant="ghost" onClick={() => setShowMatrix((v) => !v)}>
            {showMatrix ? "Hide" : "Show"}
          </Button>
        }
      >
        {showMatrix ? (
          <div className="grid gap-4 md:grid-cols-2">
            {STAFF_ROLES.map((role) => (
              <div key={role}>
                <p className="mb-1.5 text-sm font-medium">{ROLE_LABELS[role]}</p>
                <div className="flex flex-wrap gap-1">
                  {ROLE_PERMISSIONS[role].map((p) => (
                    <span key={p} className="rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-[11px]">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Finance is its own role: owners can grant it, but being an owner doesn&apos;t include it.
          </p>
        )}
      </Panel>

      <GrantDialog open={adding} onOpenChange={setAdding} />
      <GrantDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} initial={editing ?? undefined} />
      <Dialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove @{revoking?.username}?</DialogTitle>
            <DialogDescription>They lose access to the console immediately. Their past actions stay in the audit log.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const target = revoking;
                setRevoking(null);
                if (target) void run(target.id, () => revoke({ staffId: target.id }), "Access removed.");
              }}
            >
              Remove access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Audit log ----------------------------------------------------------------------------------

export function AuditSection() {
  const log = useQuery(api.staff.auditLog, { limit: 200 });
  const [filter, setFilter] = useState("");
  const [area, setArea] = useState<string>("all");

  const areas = useMemo(() => ["all", ...new Set((log ?? []).map((e) => e.action.split(".")[0]))], [log]);
  const shown = (log ?? []).filter((e) => {
    if (area !== "all" && !e.action.startsWith(`${area}.`) && e.action.split(".")[0] !== area) return false;
    const needle = filter.trim().toLowerCase();
    return !needle || `${e.action} ${e.actor} ${e.summary ?? ""}`.toLowerCase().includes(needle);
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" description="Who did what, newest first. Entries can't be edited or removed." icon={ScrollText} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {areas.map((a) => (
            <Button key={a} size="sm" variant={area === a ? "secondary" : "ghost"} onClick={() => setArea(a)} className="capitalize">
              {a.replace(/_/g, " ")}
            </Button>
          ))}
        </div>
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search the log" className="h-8 pl-9" />
        </div>
      </div>
      <Panel flush>
        {log === undefined ? (
          <Loading />
        ) : shown.length === 0 ? (
          <EmptyState icon={ScrollText} title="Nothing matches" />
        ) : (
          <div className="divide-y divide-foreground/10">
            {shown.map((e) => (
              <ListRow key={e.id}>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs font-medium">{e.action}</p>
                  <p className="truncate text-xs text-muted-foreground">{e.summary ?? "—"}</p>
                </div>
                <span className="w-28 truncate text-xs">@{e.actor}</span>
                <span className="w-36 text-right text-xs text-muted-foreground" title={formatDate(e.createdAt, true)}>
                  {formatRelative(e.createdAt)}
                </span>
              </ListRow>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}


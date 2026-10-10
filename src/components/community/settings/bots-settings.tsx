"use client";

import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, Bot, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { BOT_PERMISSIONS, BOT_SCOPES, BOT_SCOPE_INFO, holds, type BotScope } from "../../../../convex/lib/botAuth";
import { SettingRow, SettingsCard, SettingsGroup } from "@/components/settings/settings-ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const RISK_STYLE = { low: "text-muted-foreground", medium: "text-amber-500", high: "text-destructive" } as const;
const messageOf = (e: unknown) => (e instanceof Error ? e.message.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] : "That didn't work.");

export interface Consent {
  name: string;
  imageUrl: string | null;
  owner: string | null;
  description: string;
  /** What the bot asks for. */
  requested: number;
  requestedScopes: string[];
  /** What is on right now (editing), or the same as requested (adding). */
  initial: number;
  initialScopes: string[];
}

/**
 * What a manager is shown before a bot gets anything: each permission it asked for, in plain
 * words, with the ones they can't give switched off and labelled. They choose; nothing is on
 * by default that they didn't see. The server checks the same rules again and refuses anything
 * the choice wouldn't be allowed to be.
 */
export function ConsentDialog({
  consent,
  myPermissions,
  confirmLabel,
  note,
  onCancel,
  onConfirm,
}: {
  consent: Consent;
  myPermissions: number;
  confirmLabel: string;
  note?: string;
  onCancel: () => void;
  onConfirm: (permissions: number, scopes: string[]) => Promise<void>;
}) {
  const [perms, setPerms] = useState(consent.initial);
  const [scopes, setScopes] = useState<string[]>(consent.initialScopes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const asked = BOT_PERMISSIONS.filter((p) => (consent.requested & p.bit) !== 0);
  const askedScopes = BOT_SCOPES.filter((s) => consent.requestedScopes.includes(s));

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(perms, scopes);
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Avatar className="size-9">
              {consent.imageUrl && <AvatarImage src={consent.imageUrl} alt="" />}
              <AvatarFallback>{consent.name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            {consent.name}
          </DialogTitle>
          <DialogDescription>
            {consent.owner ? `By @${consent.owner}. ` : ""}
            {consent.description || "No description."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <ShieldCheck className="mr-1.5 inline size-3.5 -translate-y-px" />
            The bot acts with <span className="font-medium text-foreground">your</span> authority: it can only do what you can still do. If you leave, or lose a permission, it loses it too. You can only give it permissions you have.
          </p>

          {asked.length === 0 && askedScopes.length === 0 ? (
            <p className="text-sm text-muted-foreground">This bot doesn&apos;t ask for any permissions. It can be added, but can&apos;t do anything beyond being in the member list.</p>
          ) : (
            <div className="space-y-1.5">
              {asked.map((p) => {
                const canGive = holds(myPermissions, p.bit);
                const on = (perms & p.bit) !== 0;
                return (
                  <label key={p.key} className={cn("flex items-start gap-3 rounded-lg border border-border p-3", canGive ? "cursor-pointer hover:bg-accent/40" : "opacity-60")}>
                    <input type="checkbox" className="mt-1" checked={on} disabled={!canGive || busy} onChange={(e) => setPerms((cur) => (e.target.checked ? cur | p.bit : cur & ~p.bit))} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {p.label}
                        <span className={cn("text-[10px] font-semibold uppercase", RISK_STYLE[p.risk])}>{p.risk === "low" ? "" : `${p.risk} impact`}</span>
                      </span>
                      <span className="block text-xs text-muted-foreground">{p.description}</span>
                      {!canGive && <span className="mt-0.5 block text-xs text-destructive">You don&apos;t have this permission, so you can&apos;t give it.</span>}
                    </span>
                  </label>
                );
              })}
              {askedScopes.map((s) => (
                <label key={s} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-accent/40">
                  <input type="checkbox" className="mt-1" checked={scopes.includes(s)} disabled={busy} onChange={(e) => setScopes((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{BOT_SCOPE_INFO[s as BotScope].label}</span>
                    <span className="block text-xs text-muted-foreground">{BOT_SCOPE_INFO[s as BotScope].description}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={go} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Find a bot by its id (private bots, shared by their author) or pick a public one. */
function AddBotDialog({ communityId, myPermissions, onClose }: { communityId: Id<"communities">; myPermissions: number; onClose: () => void }) {
  const directory = useQuery(api.bots.directory, {}) ?? [];
  const install = useMutation(api.bots.install);
  const [id, setId] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const info = useQuery(api.bots.installInfo, picked ? { botId: picked } : "skip");

  if (picked && info) {
    return (
      <ConsentDialog
        consent={{ name: info.name, imageUrl: info.imageUrl, owner: info.owner?.username ?? null, description: info.description, requested: info.permissions, requestedScopes: info.scopes, initial: info.permissions & myPermissionsMask(myPermissions, info.permissions), initialScopes: [] }}
        myPermissions={myPermissions}
        confirmLabel="Add bot"
        note={info.canReceiveEvents ? undefined : "Events are switched off for this bot, so it won't hear about messages or commands until its author turns them back on."}
        onCancel={() => setPicked(null)}
        onConfirm={async (permissions, scopes) => {
          await install({ botId: info.id as Id<"bots">, communityId, permissions, scopes });
          onClose();
        }}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a bot</DialogTitle>
          <DialogDescription>Paste a bot&apos;s ID, or choose a public one. You&apos;ll see what it asks for before it gets anything.</DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (id.trim()) setPicked(id.trim());
          }}
        >
          <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="Bot ID" className="font-mono text-xs" />
          <Button type="submit" disabled={!id.trim()}>
            Find
          </Button>
        </form>
        {picked && info === null && <p className="text-sm text-destructive">No bot with that ID is available to you.</p>}
        {picked && info === undefined && <Loader2 className="mx-auto size-4 animate-spin" />}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Public bots</p>
          {directory.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
          {directory.map((b) => (
            <button key={b.id} type="button" onClick={() => setPicked(b.id)} className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left hover:bg-accent/40">
              <Avatar className="size-8">
                {b.imageUrl && <AvatarImage src={b.imageUrl} alt="" />}
                <AvatarFallback>{b.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{b.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{b.description}</span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** What of a request the manager holds: the starting point for the tick-boxes, so none start ticked that they can't give. */
function myPermissionsMask(mine: number, requested: number): number {
  return BOT_PERMISSIONS.reduce((m, p) => ((requested & p.bit) !== 0 && holds(mine, p.bit) ? m | p.bit : m), 0);
}

const permissionLabels = (bits: number) => BOT_PERMISSIONS.filter((p) => (bits & p.bit) !== 0).map((p) => p.label);

/** The bots in this community, what each may do, and whose authority it is acting with. */
export function BotsSettings({ communityId }: { communityId: Id<"communities"> }) {
  const installs = useQuery(api.bots.installsFor, { communityId });
  const activity = useQuery(api.bots.activityFor, { communityId, limit: 25 });
  const myBits = useQuery(api.roles.myPermissions, { communityId }) ?? 0;
  const updateInstall = useMutation(api.bots.updateInstall);
  const uninstall = useMutation(api.bots.uninstall);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editingRow = useMemo(() => installs?.find((i) => i.installId === editing) ?? null, [installs, editing]);
  const canManage = holds(myBits, PERMISSIONS.MANAGE_INTEGRATIONS);

  if (installs === undefined) return <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />;
  if (installs === null || !canManage) {
    return <p className="px-1 text-sm text-muted-foreground">You need the Manage Integrations permission to manage bots.</p>;
  }

  return (
    <div className="space-y-8">
      <SettingsGroup title="Bots">
        <SettingRow icon={Bot} title={`${installs.length} bot${installs.length === 1 ? "" : "s"} in this community`} description="Bots are apps that run on their author's servers. Each acts with the authority of the person who added it.">
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add a bot
          </Button>
        </SettingRow>
        {error && (
          <p role="alert" className="px-1 text-sm text-destructive">
            {error}
          </p>
        )}
        {installs.map((i) => (
          <SettingsCard key={i.installId} className="space-y-3 px-4 py-3">
            <div className="flex items-center gap-3">
              <Avatar className="size-9">
                {i.bot.imageUrl && <AvatarImage src={i.bot.imageUrl} alt="" />}
                <AvatarFallback>{i.bot.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {i.bot.name} {i.bot.suspended && <span className="ml-1 rounded bg-destructive/20 px-1.5 text-[10px] text-destructive">SUSPENDED</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  By @{i.bot.owner ?? "unknown"} · authorised by {i.authorisedBy.name}
                  {!i.authorisedBy.present && " (no longer here)"}
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setEditing(i.installId)}>
                Permissions
              </Button>
              <Button size="icon" variant="ghost" className="size-8" aria-label={`Remove ${i.bot.name}`} onClick={() => setRemoving(i.installId)}>
                <Trash2 className="size-4" />
              </Button>
            </div>

            {i.needsReauthorisation && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                <span className="min-w-0 flex-1">
                  {i.authorisedBy.present
                    ? `${i.authorisedBy.name} no longer has: ${permissionLabels(i.lost).join(", ").toLowerCase()}, so the bot can't use ${permissionLabels(i.lost).length === 1 ? "it" : "them"} either.`
                    : `${i.authorisedBy.name} has left, so this bot can't act until someone authorises it again.`}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-6 text-xs"
                  onClick={async () => {
                    setError(null);
                    try {
                      // Re-authorising keeps what it was given where the manager holds it, and drops the rest.
                      await updateInstall({ installId: i.installId, permissions: i.granted & myPermissionsMask(myBits, i.granted), scopes: i.scopes, takeOver: true });
                    } catch (e) {
                      setError(messageOf(e));
                    }
                  }}
                >
                  Authorise as me
                </Button>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {permissionLabels(i.effective).map((l) => (
                <span key={l} className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
                  {l}
                </span>
              ))}
              {i.scopes.map((s) => (
                <span key={s} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                  {BOT_SCOPE_INFO[s as BotScope]?.label ?? s}
                </span>
              ))}
              {permissionLabels(i.effective).length === 0 && i.scopes.length === 0 && <span className="text-xs text-muted-foreground">Can&apos;t do anything yet</span>}
            </div>
            {i.events.configured && i.events.disabled && <p className="text-xs text-destructive">Events were switched off because they kept failing. Its author can turn them back on.</p>}
          </SettingsCard>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Activity">
        {activity === undefined && <Loader2 className="size-4 animate-spin" />}
        {activity?.length === 0 && <p className="px-1 text-sm text-muted-foreground">Nothing yet.</p>}
        {activity?.map((r) => (
          <SettingRow
            key={r.id}
            title={`${r.bot}: ${r.action}${r.ok ? "" : " — refused"}`}
            description={`${new Date(r.at).toLocaleString()}${r.actor ? ` · @${r.actor}` : ""}${r.detail ? ` · ${r.detail}` : ""}`}
          />
        ))}
      </SettingsGroup>

      {adding && <AddBotDialog communityId={communityId} myPermissions={myBits} onClose={() => setAdding(false)} />}

      {editingRow && (
        <ConsentDialog
          consent={{ name: editingRow.bot.name, imageUrl: editingRow.bot.imageUrl, owner: editingRow.bot.owner, description: editingRow.bot.description, requested: editingRow.requested, requestedScopes: editingRow.requestedScopes, initial: editingRow.granted, initialScopes: editingRow.scopes }}
          myPermissions={myBits}
          confirmLabel="Save"
          note="Taking permissions away is always allowed. Giving more makes you the person the bot acts for."
          onCancel={() => setEditing(null)}
          onConfirm={async (permissions, scopes) => {
            await updateInstall({ installId: editingRow.installId, permissions, scopes });
            setEditing(null);
          }}
        />
      )}

      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove this bot?</DialogTitle>
            <DialogDescription>It leaves the community and loses everything it was given. Its past messages stay.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                const id = removing as Id<"botInstalls">;
                setRemoving(null);
                try {
                  await uninstall({ installId: id });
                } catch (e) {
                  setError(messageOf(e));
                }
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

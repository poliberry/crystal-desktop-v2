"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { Database, Download, Eye, KeyRound, LockKeyhole, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../convex/_generated/api";
import { Spinner } from "@/components/auth/auth-ui";
import { useSignOut } from "@/components/auth/auth-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/auth-errors";
import { buildDataExport, saveBlob, type ExportProgress } from "@/lib/data-export";

export function PrivacyTab() {
  const identity = useQuery(api.e2eeKeys.myIdentity);
  const security = useQuery(api.twoFactor.overview);
  const hasIdentity = !!identity;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Eye className="size-4" /> Your privacy at a glance</CardTitle>
          <CardDescription>A plain-language view of what Crystal uses and where it goes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <LockKeyhole className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1"><p className="text-sm font-medium">Message encryption</p><p className="mt-1 text-xs text-muted-foreground">{hasIdentity ? "This account has an encryption identity on this service. Message text is encrypted on your devices for supported conversations and channels." : "Set up end-to-end encryption in Security. Until setup is complete, don’t assume message history is end-to-end encrypted."}</p></div>
            <Badge variant={hasIdentity ? "secondary" : "outline"}>{hasIdentity ? "Set up" : "Not set up"}</Badge>
          </div>
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <Database className="mt-0.5 size-4 shrink-0 text-primary" />
            <div><p className="text-sm font-medium">Local message search</p><p className="mt-1 text-xs text-muted-foreground">Search indexes decrypted message text on this device and seals its local copy with the device cache key. Older messages appear only after they have been loaded and decrypted here.</p></div>
          </div>
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1"><p className="text-sm font-medium">Sign-in protection</p><p className="mt-1 text-xs text-muted-foreground">Two-step verification and passkeys protect account access. They do not change what account data Crystal stores.</p></div>
            <Badge variant={security?.enrolled ? "secondary" : "outline"}>{security === undefined ? "Checking" : security?.enrolled ? "Enabled" : "Off"}</Badge>
          </div>
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
            <div><p className="text-sm font-medium">My Crystal and AI</p><p className="mt-1 text-xs text-muted-foreground">The current My Crystal feed uses notification metadata from Crystal. On-device model summaries are not active yet, and message text is not currently sent to an AI service for summaries.</p></div>
            <Badge variant="outline">No model active</Badge>
          </div>
          <div className="flex items-start gap-3 rounded-lg border p-3">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" />
            <div><p className="text-sm font-medium">External services</p><p className="mt-1 text-xs text-muted-foreground">Crystal uses its hosted backend for account and sync data, and service providers to deliver features such as voice calls and payments. Extensions run with the permissions you grant. Review connected integrations and extension permissions before enabling them.</p></div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your data</CardTitle>
          <CardDescription>
            Take a copy of everything, or delete your account. <a href="/privacy/" target="_blank" rel="noreferrer" className="underline underline-offset-4">What we keep, and for how long</a>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ExportRow />
          <DeleteRow />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * "Download your data": built on this device, so encrypted messages come out readable without the
 * server ever seeing them (see src/lib/data-export.ts).
 */
function ExportRow() {
  const convex = useConvex();
  const me = useQuery(api.users.getCurrentUser);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null && progress.stage !== "done";

  const run = async () => {
    setError(null);
    try {
      const blob = await buildDataExport(convex, setProgress);
      const date = new Date().toISOString().slice(0, 10);
      saveBlob(blob, `crystal-data-${me?.username ?? "export"}-${date}.json`);
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't put your data together. Try again."));
      setProgress(null);
    }
  };

  const status =
    progress === null
      ? "Your profile, friends, communities, purchases, settings and every message you've sent, in one file. Encrypted messages are decrypted on this device while the file is made."
      : progress.stage === "done"
        ? `Done: ${progress.messages.toLocaleString()} messages included. Check your downloads.`
        : progress.stage === "account"
          ? "Collecting your account…"
          : `Collecting messages… ${progress.messages.toLocaleString()} so far`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Download your data</p>
        <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">{status}</p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <Button variant="outline" onClick={run} disabled={busy}>
        {busy ? <Spinner /> : <Download className="size-4" />} {busy ? "Working…" : "Download"}
      </Button>
    </div>
  );
}

/**
 * Delete the account. The server asks for a fresh password or 2FA code before it does anything (the
 * prompt comes from the Convex client and retries this call), then signs this device out.
 */
function DeleteRow() {
  const preflight = useQuery(api.accountDeletion.preflight);
  const request = useMutation(api.accountDeletion.request);
  const signOut = useSignOut("/");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blockers = preflight?.blockers ?? [];
  const blockedBy = blockers.find((b) => b.kind !== "guest");
  const guest = blockers.some((b) => b.kind === "guest");
  const matches = !!preflight && typed.trim().replace(/^@/, "").toLowerCase() === preflight.username.toLowerCase();

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await request({ confirmUsername: typed });
      await signOut().catch(() => window.location.assign("/"));
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't delete your account."));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Delete your account</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {guest
            ? "Guest accounts delete themselves 24 hours after they're made."
            : blockedBy?.kind === "communities"
              ? `Delete the communities you own first: ${blockedBy.names.join(", ")}.`
              : blockedBy?.kind === "earnings"
                ? "You have creator earnings waiting to be paid. Contact support so we can settle them first."
                : "Deletes your messages, files, friends, memberships and profile for good. Download your data first if you want to keep anything."}
        </p>
      </div>
      <Button variant="destructive" onClick={() => setOpen(true)} disabled={!preflight || blockers.length > 0}>
        <Trash2 className="size-4" /> Delete account
      </Button>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>This can’t be undone.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
              <li>Every message you’ve sent, in DMs and communities, is deleted, with its files.</li>
              <li>Your profile, friends, memberships, bots and linked accounts are removed.</li>
              <li>Subscriptions are cancelled straight away.</li>
              <li>Purchase records and reports are kept, as the law and safety require, attached to “Deleted user”.</li>
            </ul>
            <label className="block">
              <span className="text-xs text-muted-foreground">Type your username, <b className="text-foreground">{preflight?.username}</b>, to confirm</span>
              <Input className="mt-1.5" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
            </label>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Keep my account</Button>
            <Button variant="destructive" onClick={confirm} disabled={!matches || busy}>
              {busy && <Spinner />} Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

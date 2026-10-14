"use client";

import { useAction, useQuery } from "convex/react";
import { useState } from "react";
import { Loader2, LockKeyhole, RotateCcw, ShieldAlert } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, Panel, useRun } from "@/components/admin/admin-ui";
import { formatDate } from "@/lib/money";

export function E2eeSection() {
  const job = useQuery(api.e2eeMigrate.latest, {});
  const start = useAction((api as any).e2eeMigrate.startAll);
  const cancel = useAction((api as any).e2eeMigrate.cancel);
  const retry = useAction(api.e2eeMigrate.retry);
  const { run, busy } = useRun();
  const [confirming, setConfirming] = useState(false);

  const startBackfill = async () => {
    const started = await run("e2ee-start", () => start({ batchSize: 100 }), "Encrypted message backfill started.");
    if (started) setConfirming(false);
  };

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="Message encryption"
        description="Convert legacy plaintext messages to encrypted room-key envelopes."
        icon={LockKeyhole}
      />

      <Panel title="Legacy message backfill" description="This job visits every DM, group, and community channel in bounded resumable batches.">
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-500">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            During migration, the configured escrow private key can decrypt converted message bodies. Escrow is removed after each current recipient has a usable key wrap. Users need to set up message encryption in Settings to receive their wraps.
          </div>

          {job === undefined ? (
            <p className="text-sm text-muted-foreground">Loading migration status…</p>
          ) : job ? (
            <div className="rounded-lg border border-foreground/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium capitalize">{job.status} · {job.phase}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {job.migrated.toLocaleString()} messages encrypted · {job.skipped.toLocaleString()} skipped · {job.batches.toLocaleString()} batches
                  </p>
                  {job.error && <p className="mt-2 text-sm text-destructive">{job.error}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">Started {formatDate(job.startedAt)}</p>
                </div>
                <div className="flex gap-2">
                  {job.status === "running" && (
                    <Button variant="outline" disabled={busy !== null} onClick={() => void run("e2ee-cancel", () => cancel({ jobId: job._id }), "Backfill cancelled.")}>
                      Cancel
                    </Button>
                  )}
                  {job.status === "failed" && (
                    <Button disabled={busy !== null} onClick={() => void run("e2ee-retry", () => retry({ jobId: job._id }), "Backfill resumed.")}>
                      {busy === "e2ee-retry" ? <Loader2 className="animate-spin" /> : <RotateCcw />} Resume
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No backfill has been run on this deployment.</p>
          )}

          <Button disabled={busy !== null || job?.status === "running"} onClick={() => setConfirming(true)}>
            {busy === "e2ee-start" ? <Loader2 className="animate-spin" /> : <LockKeyhole />} Start backfill
          </Button>
        </div>
      </Panel>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start encrypted message backfill?</DialogTitle>
            <DialogDescription>
              This will encrypt remaining legacy message bodies on this deployment. The escrow key will be able to decrypt them until recipient wraps are complete and escrow is removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button disabled={busy !== null} onClick={() => void startBackfill()}>
              {busy === "e2ee-start" && <Loader2 className="animate-spin" />} Start backfill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

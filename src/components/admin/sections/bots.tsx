"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Bot, Check, X } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, Loading, PageHeader, Panel, ReasonDialog, StatusPill, useRun } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";

/**
 * Bots whose public listing is waiting to be read: a bot asking to be in the public list, or a listed bot whose name, description or
 * picture has changed. A bot's code runs on its author's own computer, so what is reviewed here is what people are *shown*; what it
 * can do in a community is still decided by each community's manager, and by the permissions only they can grant.
 */
export function BotsSection() {
  const rows = useQuery(api.bots.adminPendingListings);
  const review = useMutation(api.bots.adminReviewListing);
  const { run, busy } = useRun();
  const [rejecting, setRejecting] = useState<Id<"bots"> | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader title="Bot listings" description="A bot's public listing — its name, description and picture, and whether it is in the public list — is read before it is shown. Approving a change replaces what people see; turning it down leaves the listing as it is." icon={Bot} />
      {rows === undefined ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Panel>
          <EmptyState icon={Bot} title="Nothing waiting" />
        </Panel>
      ) : (
        rows.map((r) => (
          <Panel
            key={r.id}
            title={r.pending.name}
            description={`by @${r.owner} · in ${r.installCount} communit${r.installCount === 1 ? "y" : "ies"}`}
            actions={
              <>
                <StatusPill tone="warn">{r.pending.makePublic ? "asks to be public" : "change to a public listing"}</StatusPill>
                <Button size="sm" disabled={busy === r.id} onClick={() => void run(r.id, () => review({ botId: r.id as Id<"bots">, approve: true, note: "" }), "Approved.")}>
                  <Check /> Approve
                </Button>
                <Button size="sm" variant="outline" className="text-destructive" onClick={() => setRejecting(r.id as Id<"bots">)}>
                  <X /> Turn down
                </Button>
              </>
            }
          >
            <div className="grid gap-4 text-sm md:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{r.pending.makePublic ? "Not listed yet (private)" : "Live now"}</p>
                <p className="font-medium">{r.live.name}</p>
                <p className="whitespace-pre-wrap text-muted-foreground">{r.live.description || "—"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Asked for</p>
                <div className="flex items-center gap-2">
                  {r.pending.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.pending.imageUrl} alt="" className="size-10 rounded-full object-cover" />
                  )}
                  <p className="font-medium">{r.pending.name}</p>
                </div>
                <p className="whitespace-pre-wrap">{r.pending.description}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Asks for {r.permissions === 0 && r.scopes.length === 0 ? "nothing" : `permissions ${r.permissions}${r.scopes.length ? ` and ${r.scopes.join(", ")}` : ""}`} · {r.commands.length} slash command{r.commands.length === 1 ? "" : "s"}
              {r.commands.length ? `: ${r.commands.map((c) => `/${c.name}`).join(" ")}` : ""}
            </p>
          </Panel>
        ))
      )}
      <ReasonDialog
        open={rejecting !== null}
        onOpenChange={(o) => !o && setRejecting(null)}
        title="Turn this listing change down?"
        description="The author sees what you write, so say what to fix. What is live stays as it is."
        confirmLabel="Turn down"
        destructive
        placeholder="What needs to change"
        onConfirm={(note) => review({ botId: rejecting!, approve: false, note })}
      />
    </div>
  );
}

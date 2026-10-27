"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, Check, CheckCircle2, Info, Loader2, Puzzle, Skull, X, XCircle } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CAPABILITY_INFO, sourceHash, type Capability } from "../../../../convex/lib/extensionManifest";
import { EmptyState, EntityLink, Fields, Loading, Panel, ReasonDialog, StatusPill, useRun } from "@/components/admin/admin-ui";
import { useConsole } from "@/components/admin/console-state";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/money";

/**
 * Reviewing one version of an extension.
 *
 * The code is shown as it is stored, with the hash it is run by. The hash is computed
 * again here in the reviewer's own browser, so "what I read" and "what will run" are
 * visibly the same thing — and if they ever weren't, this is where it would show.
 */
export function ExtensionRecord({ id }: { id: string }) {
  const { retitle } = useConsole();
  const versionId = id as Id<"extensionVersions">;
  const v = useQuery(api.extensions.adminVersion, { versionId });
  const review = useMutation(api.extensions.adminReview);
  const revoke = useMutation(api.extensions.adminRevokeVersion);
  const suspend = useMutation(api.extensions.adminSetSuspended);
  const { run, busy } = useRun();
  const [note, setNote] = useState<"reject" | "revoke" | "suspend" | null>(null);
  const [local, setLocal] = useState<string | null>(null);

  useEffect(() => {
    if (v) retitle({ kind: "extension", id }, `${v.manifest.name} ${v.version}`, v.publisher ? `by @${v.publisher.username}` : undefined);
  }, [v, id, retitle]);

  // Recomputed here, from what was received, not trusted from the server's copy.
  useEffect(() => {
    if (v) void sourceHash(v.source).then(setLocal);
  }, [v]);

  const lines = useMemo(() => v?.source.split("\n") ?? [], [v?.source]);

  if (v === undefined) return <Loading />;
  if (v === null) return <EmptyState icon={Puzzle} title="That version no longer exists" />;

  const pending = v.status === "pending";
  const blocking = v.findings.some((f) => f.level === "error");
  const matches = local !== null && local === v.hash;
  const caps = v.manifest.capabilities as Capability[];

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-5">
        <header className="flex flex-wrap items-center gap-3">
          <Puzzle className="size-6 text-violet-400" />
          <h1 className="text-2xl font-semibold tracking-tight">{v.manifest.name}</h1>
          <span className="text-muted-foreground">v{v.version}</span>
          <StatusPill tone={pending ? "warn" : v.status === "approved" ? "good" : "bad"}>{v.status}</StatusPill>
          {v.suspended && <StatusPill tone="bad">extension suspended</StatusPill>}
        </header>

        <Panel title="What it asks for" description="The powers the person is shown and agrees to. Nothing else is possible, whatever the code says.">
          {caps.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing. It can't show or save anything.</p>
          ) : (
            <ul className="space-y-2">
              {caps.map((c) => (
                <li key={c} className="flex items-start gap-2 text-sm">
                  {CAPABILITY_INFO[c]?.risk === "medium" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" /> : <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                  <span>
                    <strong>{CAPABILITY_INFO[c]?.label ?? c}</strong> <code className="text-xs text-muted-foreground">{c}</code>
                    <span className="block text-xs text-muted-foreground">{CAPABILITY_INFO[c]?.description}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {v.manifest.network.length > 0 && (
            <div className="mt-3 rounded-lg bg-foreground/5 p-3">
              <p className="pb-1 text-xs font-medium">Sites it may talk to</p>
              {v.manifest.network.map((o) => (
                <code key={o} className="block text-xs">{o}</code>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Findings" description="A lint of the code against what it asks for. It helps you read; it doesn't replace reading.">
          <ul className="space-y-1.5">
            {v.findings.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                {f.level === "error" ? <XCircle className="mt-0.5 size-4 shrink-0 text-red-400" /> : f.level === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                <span>{f.message}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={`The code (${lines.length} lines)`} description="Exactly what will run, character for character." flush>
          <pre className="max-h-[32rem] overflow-auto bg-black/40 p-0 text-xs leading-relaxed">
            <code>
              {lines.map((line, i) => (
                <div key={i} className="flex">
                  <span className="w-12 shrink-0 pr-3 text-right text-muted-foreground/60 select-none">{i + 1}</span>
                  <span className="min-w-0 whitespace-pre">{line || " "}</span>
                </div>
              ))}
            </code>
          </pre>
        </Panel>
      </div>

      <aside className="space-y-5">
        <Panel title="Integrity">
          <p className="break-all font-mono text-[11px]">{v.hash}</p>
          <p className={`mt-2 flex items-center gap-1.5 text-xs ${matches ? "text-emerald-500" : local === null ? "text-muted-foreground" : "text-red-400"}`}>
            {matches ? <CheckCircle2 className="size-3.5" /> : local === null ? <Loader2 className="size-3.5 animate-spin" /> : <XCircle className="size-3.5" />}
            {matches ? "The code on this screen hashes to this. It is what will run." : local === null ? "Checking…" : "The code on this screen does NOT match its hash. Do not approve."}
          </p>
        </Panel>

        <Panel title="Details">
          <Fields
            items={[
              ["Id", v.slug],
              ["Kind", v.manifest.kind],
              ["Description", v.manifest.description],
              ["Submitted", formatDate(v.createdAt, true)],
              ["Publisher", v.publisher ? <EntityLink key="p" entity={{ kind: "user", id: v.publisher.id, title: v.publisher.name, subtitle: `@${v.publisher.username}` }}>@{v.publisher.username}</EntityLink> : "—"],
              ["Installed on", `${v.installs} device${v.installs === 1 ? "" : "s"} (this version)`],
            ]}
          />
          {v.reviewNote && <p className="mt-3 rounded-lg bg-foreground/5 p-3 text-sm">{v.reviewNote}</p>}
          {v.suspendedReason && <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">Suspended: {v.suspendedReason}</p>}
        </Panel>

        <Panel title="Decision">
          {pending ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button className="flex-1" disabled={blocking || !matches || busy === "approve"} onClick={() => void run("approve", () => review({ versionId, approve: true, note: "" }), "Approved. It's available to install.")}>
                  {busy === "approve" ? <Loader2 className="animate-spin" /> : <Check />} Approve
                </Button>
                <Button variant="outline" className="flex-1 text-destructive" onClick={() => setNote("reject")}>
                  <X /> Reject
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{blocking ? "It has blocking findings and can't be approved." : "Approving makes this version installable. It is recorded in the audit log with the code's hash."}</p>
            </div>
          ) : v.status === "approved" ? (
            <div className="space-y-3">
              <Button variant="outline" className="w-full text-destructive" onClick={() => setNote("revoke")}>
                <Skull /> Revoke this version
              </Button>
              <p className="text-xs text-muted-foreground">Stops it on every device that has it, as soon as they hear — within moments, not at the next launch.</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">This was {v.status}.</p>
          )}
          <Button variant="ghost" className="mt-3 w-full text-destructive" onClick={() => (v.suspended ? void run("unsuspend", () => suspend({ extensionId: v.extensionId, suspended: false }), "Unsuspended.") : setNote("suspend"))}>
            {v.suspended ? "Lift the suspension" : "Suspend the whole extension"}
          </Button>
        </Panel>
      </aside>

      <ReasonDialog
        open={note !== null}
        onOpenChange={(o) => !o && setNote(null)}
        title={note === "reject" ? "Reject this version?" : note === "revoke" ? "Revoke this version?" : "Suspend this extension?"}
        description={note === "reject" ? "The author sees what you write, so say what to fix." : "This goes in the audit log, and takes effect on devices straight away."}
        confirmLabel={note === "reject" ? "Reject" : note === "revoke" ? "Revoke" : "Suspend"}
        destructive
        placeholder="Why"
        onConfirm={(text) =>
          note === "reject"
            ? review({ versionId, approve: false, note: text })
            : note === "revoke"
              ? revoke({ versionId, reason: text })
              : suspend({ extensionId: v.extensionId, suspended: true, reason: text })
        }
      />
    </div>
  );
}

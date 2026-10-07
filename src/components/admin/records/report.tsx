"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Ban, CheckCircle2, Flag, Loader2, MessageSquarePlus, UserCheck, XCircle } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  EmptyState,
  EntityLink,
  Fields,
  Loading,
  Panel,
  ReasonDialog,
  StatusPill,
  useRun,
  useStaff,
  type Tone,
} from "@/components/admin/admin-ui";
import { useConsole, useOpenEntity } from "@/components/admin/console-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatRelative } from "@/lib/money";

const TONE: Record<string, Tone> = { open: "warn", reviewing: "info", resolved: "good", dismissed: "neutral" };
const pretty = (value: string) => value.replace(/_/g, " ");

/** One report: what was said, what was shown, and what was decided. */
export function ReportRecord({ id }: { id: string }) {
  const staff = useStaff();
  const { retitle } = useConsole();
  const open = useOpenEntity();
  const reportId = id as Id<"reports">;
  const report = useQuery(api.reports.adminGet, { reportId });
  const claim = useMutation(api.reports.adminClaim);
  const setStatus = useMutation(api.reports.adminSetStatus);
  const addNote = useMutation(api.reports.adminAddNote);
  const { run, busy } = useRun();
  const [note, setNote] = useState("");
  const [closing, setClosing] = useState<"resolved" | "dismissed" | null>(null);

  useEffect(() => {
    if (report) retitle({ kind: "report", id }, `Report · ${pretty(report.category)}`, report.target ? `@${report.target.username}` : pretty(report.targetType));
  }, [report, id, retitle]);

  if (report === undefined) return <Loading />;
  if (report === null) return <EmptyState icon={Flag} title="That report no longer exists" />;

  const act = staff.can("reports.act");
  const closed = report.status === "resolved" || report.status === "dismissed";

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-5">
        <header className="flex flex-wrap items-center gap-3">
          <Flag className="size-6 text-rose-400" />
          <h1 className="text-2xl font-semibold tracking-tight capitalize">{pretty(report.category)}</h1>
          <StatusPill tone={TONE[report.status]}>{pretty(report.status)}</StatusPill>
          <span className="text-sm text-muted-foreground">
            about a {pretty(report.targetType)} · {formatRelative(report.createdAt)}
          </span>
        </header>

        {report.details && (
          <Panel title="What the reporter said">
            <p className="text-sm whitespace-pre-wrap">{report.details}</p>
          </Panel>
        )}

        <Panel title="Evidence" description="Captured when the report was made, so it survives the message being edited or deleted.">
          <div className="space-y-3">
            {report.evidence?.context && <p className="text-xs text-muted-foreground">{report.evidence.context}</p>}
            {report.evidence?.authorUsername && (
              <p className="text-sm">
                <span className="font-medium">{report.evidence.authorName}</span>{" "}
                <span className="text-muted-foreground">@{report.evidence.authorUsername}</span>
              </p>
            )}
            {report.evidence?.text ? (
              <blockquote className="rounded-lg border-l-2 border-rose-400/60 bg-foreground/5 px-3 py-2 text-sm whitespace-pre-wrap">
                {report.evidence.text}
              </blockquote>
            ) : (
              <p className="text-sm text-muted-foreground">No text was attached.</p>
            )}
            {!!report.evidence?.attachments?.length && (
              <ul className="space-y-1 text-sm">
                {report.evidence.attachments.map((a, i) => (
                  <li key={`${a.fileName}-${i}`} className="text-muted-foreground">
                    📎 {a.fileName}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        {report.resolution && (
          <Panel title={report.status === "resolved" ? "Resolution" : "Why it was dismissed"}>
            <p className="text-sm whitespace-pre-wrap">{report.resolution}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              by @{report.resolver ?? "unknown"} {report.resolvedAt ? `· ${formatDate(report.resolvedAt, true)}` : ""}
            </p>
          </Panel>
        )}

        <Panel title="Staff notes" description="Only staff see these.">
          <div className="space-y-3">
            {report.notes.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
            {report.notes.map((n) => (
              <div key={n.id} className="rounded-lg bg-foreground/5 px-3 py-2">
                <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  @{n.author} · {formatRelative(n.createdAt)}
                </p>
              </div>
            ))}
            {act && (
              <div className="flex gap-2">
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" className="min-h-10" />
                <Button
                  variant="outline"
                  disabled={!note.trim() || busy === "note"}
                  onClick={() => void run("note", () => addNote({ reportId, body: note })).then(() => setNote(""))}
                >
                  {busy === "note" ? <Loader2 className="animate-spin" /> : <MessageSquarePlus />}
                </Button>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <aside className="space-y-5">
        <Panel title="Decision">
          <div className="space-y-2">
            {act && !closed && (
              <>
                {report.status === "open" && (
                  <Button className="w-full" disabled={busy === "claim"} onClick={() => void run("claim", () => claim({ reportId }), "Assigned to you.")}>
                    {busy === "claim" ? <Loader2 className="animate-spin" /> : <UserCheck />} Take this report
                  </Button>
                )}
                <Button variant="outline" className="w-full" onClick={() => setClosing("resolved")}>
                  <CheckCircle2 className="text-emerald-500" /> Resolve
                </Button>
                <Button variant="outline" className="w-full" onClick={() => setClosing("dismissed")}>
                  <XCircle /> Dismiss
                </Button>
              </>
            )}
            {act && closed && (
              <Button variant="outline" className="w-full" onClick={() => void run("reopen", () => setStatus({ reportId, status: "open" }), "Reopened.")}>
                Reopen
              </Button>
            )}
            {!act && <p className="text-sm text-muted-foreground">You can read reports but not decide them.</p>}
          </div>
        </Panel>

        <Panel title="Details">
          <Fields
            items={[
              ["Reporter", report.reporter ? <EntityLink key="r" entity={{ kind: "user", id: report.reporter.id, title: report.reporter.name, subtitle: `@${report.reporter.username}` }}>@{report.reporter.username}</EntityLink> : "—"],
              [
                "About",
                report.target ? (
                  <EntityLink key="t" entity={{ kind: "user", id: report.target.id, title: report.target.name, subtitle: `@${report.target.username}` }}>
                    @{report.target.username}
                  </EntityLink>
                ) : (
                  "—"
                ),
              ],
              [
                "Community",
                report.community ? (
                  <EntityLink key="c" entity={{ kind: "community", id: report.community.id, title: report.community.name }}>
                    {report.community.name}
                  </EntityLink>
                ) : (
                  "—"
                ),
              ],
              ["Assigned to", report.assignee ? `@${report.assignee}` : "Nobody"],
              ["Filed", formatDate(report.createdAt, true)],
            ]}
          />
        </Panel>

        {report.target && staff.can("users.moderate") && (
          <Panel title="Act on the account">
            <p className="mb-3 text-xs text-muted-foreground">Open their account to suspend them, review their history or take back a gift.</p>
            <Button
              variant="outline"
              className="w-full"
              onClick={(e) =>
                open({ kind: "user", id: report.target!.id, title: report.target!.name, subtitle: `@${report.target!.username}` }, e)
              }
            >
              <Ban /> Open @{report.target.username}
            </Button>
          </Panel>
        )}

        {report.otherReportsAboutTarget.length > 0 && (
          <Panel title={`${report.otherReportsAboutTarget.length} other ${report.otherReportsAboutTarget.length === 1 ? "report" : "reports"} about them`} description="One is an incident; several is a pattern." flush>
            <div className="divide-y divide-foreground/10">
              {report.otherReportsAboutTarget.map((r) => (
                <div key={r.id} className="flex items-center gap-2 px-4 py-2.5 text-sm">
                  <EntityLink entity={{ kind: "report", id: r.id, title: `Report · ${pretty(r.category)}`, subtitle: report.target ? `@${report.target.username}` : undefined }} className="flex-1 text-left capitalize">
                    {pretty(r.category)}
                  </EntityLink>
                  <StatusPill tone={TONE[r.status]}>{pretty(r.status)}</StatusPill>
                  <span className="text-xs text-muted-foreground">{formatRelative(r.createdAt)}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </aside>

      <ReasonDialog
        open={!!closing}
        onOpenChange={(open) => !open && setClosing(null)}
        title={closing === "resolved" ? "Resolve this report" : "Dismiss this report"}
        description={closing === "resolved" ? "Say what was done. This is kept with the report." : "Say why no action is needed."}
        confirmLabel={closing === "resolved" ? "Resolve" : "Dismiss"}
        placeholder={closing === "resolved" ? "What was decided and done" : "Why it's being dismissed"}
        onConfirm={(resolution) => setStatus({ reportId, status: closing!, resolution })}
      />
    </div>
  );
}

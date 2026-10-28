"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, CircleDot, Flag, Loader2, MessageSquare, Search } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmailUpdatesToggle } from "@/components/settings/email-updates-toggle";
import { SettingsCard } from "@/components/settings/settings-ui";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatRelative } from "@/lib/money";
import { cn } from "@/lib/utils";

type ReportStatus = "received" | "in_review" | "resolved" | "closed";

/** What each stage of a report is called to the person who filed it. */
const STATUS: Record<ReportStatus, { label: string; blurb: string; tone: "default" | "secondary" | "outline" }> = {
  received: { label: "Received", blurb: "We have your report and it's waiting for a reviewer.", tone: "secondary" },
  in_review: { label: "In review", blurb: "A reviewer is looking at it now.", tone: "default" },
  resolved: { label: "Resolved", blurb: "We reviewed it and took action.", tone: "outline" },
  closed: { label: "Closed", blurb: "We reviewed it and didn't find that action was needed.", tone: "outline" },
};

const pretty = (value: string) => value.replace(/_/g, " ");

/**
 * Settings → Reports: the reports you have filed and what has happened to each. Only the reporter's
 * side — their own words, and what the team chose to tell them. Reviewer names, notes and anything
 * about the person reported beyond what they already reported stay with staff.
 */
export function ReportsTab() {
  const reports = useQuery(api.reports.mine);
  const [picked, setPicked] = useState<Id<"reports"> | null>(null);
  const selected = picked && reports?.some((r) => r.id === picked) ? picked : (reports?.[0]?.id ?? null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Reports you&apos;ve sent about people, messages and communities. You can report from a message&apos;s menu or a profile.
      </p>
      <EmailUpdatesToggle what="there's news on a report you filed" />

      {reports === undefined ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : reports.length === 0 ? (
        <SettingsCard className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <Flag className="size-8 text-muted-foreground" />
          <p className="font-medium">You haven&apos;t reported anything</p>
          <p className="max-w-sm text-sm text-muted-foreground">If you do, you&apos;ll see here that we got it, when someone is looking, and how it ended.</p>
        </SettingsCard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="space-y-1.5">
            {reports.map((r) => (
              <button key={r.id} type="button" onClick={() => setPicked(r.id)} className="block w-full text-left">
                <SettingsCard className={cn("space-y-1 px-3 py-2.5 transition-colors hover:bg-foreground/5", selected === r.id && "bg-foreground/10")}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-1 text-sm font-medium">{r.about}</p>
                    {r.unread && <span aria-label="New update" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                  </div>
                  <p className="text-xs text-muted-foreground capitalize">{pretty(r.category)}</p>
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    <span className="text-xs text-muted-foreground">{formatRelative(r.updatedAt)}</span>
                  </div>
                </SettingsCard>
              </button>
            ))}
          </div>
          {selected && <Detail key={selected} reportId={selected} />}
        </div>
      )}
    </div>
  );
}

function Detail({ reportId }: { reportId: Id<"reports"> }) {
  const report = useQuery(api.reports.getMine, { reportId });
  const markRead = useMutation(api.reports.markRead);

  const steps = report?.timeline.length ?? 0;
  useEffect(() => {
    if (report) void markRead({ reportId }).catch(() => {});
  }, [reportId, report, steps, markRead]);

  if (report === undefined) {
    return (
      <SettingsCard className="flex justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </SettingsCard>
    );
  }
  if (report === null) return <SettingsCard className="px-4 py-8 text-center text-sm text-muted-foreground">That report isn&apos;t available.</SettingsCard>;

  return (
    <SettingsCard className="min-w-0 space-y-5 p-5">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{report.about}</h2>
          <Badge variant={STATUS[report.status].tone}>{STATUS[report.status].label}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="capitalize">{pretty(report.category)}</span> · sent {formatDate(report.createdAt, true)}
        </p>
        <p className="text-sm text-muted-foreground">{STATUS[report.status].blurb}</p>
      </header>

      {report.closureNote && (
        <section className="space-y-1 rounded-lg bg-foreground/5 px-3 py-2.5">
          <h3 className="text-xs font-medium text-muted-foreground">
            Why it was {report.status === "resolved" ? "resolved" : "closed"}
            {report.closedAt ? ` · ${formatDate(report.closedAt, true)}` : ""}
          </h3>
          <p className="text-sm whitespace-pre-wrap">{report.closureNote}</p>
        </section>
      )}

      {(report.details || report.quoted) && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">What you sent</h3>
          {report.details && <p className="text-sm whitespace-pre-wrap">{report.details}</p>}
          {report.quoted && (
            <blockquote className="rounded-lg border-l-2 border-foreground/30 bg-foreground/5 px-3 py-2 text-sm whitespace-pre-wrap">
              {report.quoted}
              {report.context && <span className="mt-1 block text-xs text-muted-foreground">{report.context}</span>}
            </blockquote>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">What's happened</h3>
        <ol className="space-y-4 border-l border-foreground/15 pl-4">
          <TimelineItem icon={Flag} title="Report received" at={report.createdAt} />
          {report.timeline.map((u) =>
            u.kind === "message" ? (
              <TimelineItem key={u.id} icon={MessageSquare} title="A message from our team" at={u.createdAt} body={u.body} />
            ) : (
              <TimelineItem
                key={u.id}
                icon={u.status === "resolved" || u.status === "closed" ? CheckCircle2 : u.status === "in_review" ? Search : CircleDot}
                title={u.status ? STATUS[u.status].label : "Updated"}
                at={u.createdAt}
                body={u.body}
                bodyLabel={u.body ? "A note from our team" : undefined}
              />
            ),
          )}
        </ol>
      </section>
    </SettingsCard>
  );
}

function TimelineItem({
  icon: Icon,
  title,
  at,
  body,
  bodyLabel,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  at: number;
  body?: string | null;
  bodyLabel?: string;
}) {
  return (
    <li className="relative">
      <span className="absolute top-0.5 -left-[1.6rem] flex size-5 items-center justify-center rounded-full bg-background ring-1 ring-foreground/20">
        <Icon className="size-3 text-muted-foreground" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{formatDate(at, true)}</p>
      {body && (
        <div className="mt-1.5 rounded-lg bg-foreground/5 px-3 py-2">
          {bodyLabel && <p className="mb-0.5 text-xs font-medium text-muted-foreground">{bodyLabel}</p>}
          <p className="text-sm whitespace-pre-wrap">{body}</p>
        </div>
      )}
    </li>
  );
}

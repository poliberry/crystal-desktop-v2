"use client";

import { useQuery } from "convex/react";
import { Flag, Inbox, Palette, ShieldCheck, Wallet } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import { EmptyState, ListRow, PageHeader, Panel, StatCard, StatusPill, useStaff } from "@/components/admin/admin-ui";
import { useConsole, useOpenEntity } from "@/components/admin/console-state";
import { formatRelative } from "@/lib/money";

/** What needs somebody, and what has just happened. */
export function DashboardSection() {
  const staff = useStaff();
  const { goHome } = useConsole();
  const open = useOpenEntity();
  const overview = useQuery(api.operations.overview);
  const reports = useQuery(api.reports.adminList, staff.can("reports.read") ? { limit: 6 } : "skip");
  const submissions = useQuery(api.marketplace.adminSubmissions, staff.can("catalog.read") ? { status: "pending" } : "skip");
  const tickets = useQuery(api.support.adminList, staff.can("support.read") ? { status: "open" } : "skip");
  const audit = useQuery(api.staff.auditLog, staff.can("audit.read") ? { limit: 10 } : "skip");

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting}, ${staff.name.split(" ")[0]}`}
        description={`Signed in as ${staff.roles.join(" · ")}. Here's what needs attention.`}
        icon={ShieldCheck}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {overview?.openReports != null && (
          <StatCard
            label="Open reports"
            value={overview.openReports}
            detail={`${overview.reviewingReports ?? 0} in review`}
            tone={overview.openReports > 0 ? "warn" : "neutral"}
            onClick={() => goHome("reports")}
          />
        )}
        {overview?.openTickets != null && (
          <StatCard
            label="Open tickets"
            value={overview.openTickets}
            detail={`${overview.inProgressTickets ?? 0} in progress`}
            tone={overview.openTickets > 0 ? "warn" : "neutral"}
            onClick={() => goHome("support")}
          />
        )}
        {overview?.pendingSubmissions != null && (
          <StatCard
            label="Awaiting review"
            value={overview.pendingSubmissions}
            detail="Creator submissions"
            tone={overview.pendingSubmissions > 0 ? "info" : "neutral"}
            onClick={() => goHome("submissions")}
          />
        )}
        {overview?.unpaidPayouts != null && (
          <StatCard
            label="Failed payouts"
            value={overview.unpaidPayouts}
            detail="Need a retry"
            tone={overview.unpaidPayouts > 0 ? "bad" : "neutral"}
            onClick={() => goHome("payouts")}
          />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {reports && (
          <Panel
            title="Reports"
            flush
            actions={
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => goHome("reports")}>
                View all
              </button>
            }
          >
            {reports.length === 0 ? (
              <EmptyState icon={Flag} title="Nothing waiting">No open reports. Nice.</EmptyState>
            ) : (
              <div className="divide-y divide-foreground/10">
                {reports.map((r) => (
                  <ListRow
                    key={r.id}
                    onOpen={(e) =>
                      open({ kind: "report", id: r.id, title: `Report · ${r.category.replace(/_/g, " ")}`, subtitle: r.target ? `@${r.target.username}` : r.targetType }, e)
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium capitalize">{r.category.replace(/_/g, " ")}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.preview ?? r.targetType}</p>
                    </div>
                    <StatusPill tone={r.status === "open" ? "warn" : "info"}>{r.status}</StatusPill>
                    <span className="w-16 text-right text-xs text-muted-foreground">{formatRelative(r.createdAt)}</span>
                  </ListRow>
                ))}
              </div>
            )}
          </Panel>
        )}

        {tickets && (
          <Panel
            title="Support"
            flush
            actions={
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => goHome("support")}>
                View all
              </button>
            }
          >
            {tickets.length === 0 ? (
              <EmptyState icon={Inbox} title="Inbox zero">Every ticket has been answered.</EmptyState>
            ) : (
              <div className="divide-y divide-foreground/10">
                {tickets.slice(0, 6).map((t) => (
                  <ListRow
                    key={t._id}
                    onOpen={(e) =>
                      open({ kind: "ticket", id: t._id, title: t.subject, subtitle: t.user ? `@${t.user.username}` : undefined }, e)
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{t.subject}</p>
                      <p className="truncate text-xs text-muted-foreground">{t.preview}</p>
                    </div>
                    {(t.priority === "high" || t.priority === "urgent") && <StatusPill tone="bad">{t.priority}</StatusPill>}
                    <span className="w-16 text-right text-xs text-muted-foreground">{formatRelative(t.updatedAt)}</span>
                  </ListRow>
                ))}
              </div>
            )}
          </Panel>
        )}

        {submissions && submissions.length > 0 && (
          <Panel
            title="Creator submissions"
            flush
            actions={
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => goHome("submissions")}>
                Review
              </button>
            }
          >
            <div className="divide-y divide-foreground/10">
              {submissions.slice(0, 5).map((s) => (
                <ListRow
                  key={s._id}
                  onOpen={(e) => open({ kind: "submission", id: s._id, title: s.name, subtitle: `by @${s.creator}` }, e)}
                >
                  <Palette className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{s.name}</p>
                    <p className="truncate text-xs text-muted-foreground">by @{s.creator}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatRelative(s.createdAt)}</span>
                </ListRow>
              ))}
            </div>
          </Panel>
        )}

        {audit && (
          <Panel title="Recent staff activity" flush>
            {audit.length === 0 ? (
              <EmptyState icon={Wallet} title="No activity yet" />
            ) : (
              <div className="divide-y divide-foreground/10">
                {audit.map((entry) => (
                  <ListRow key={entry.id}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs font-medium">{entry.action}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        @{entry.actor}
                        {entry.summary ? ` — ${entry.summary}` : ""}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatRelative(entry.createdAt)}</span>
                  </ListRow>
                ))}
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

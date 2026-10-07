"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Flag, Inbox, Palette } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import {
  EmptyState,
  ListRow,
  Loading,
  PageHeader,
  Panel,
  PillTabs,
  StatusPill,
  useStaff,
  type Tone,
} from "@/components/admin/admin-ui";
import { useOpenEntity } from "@/components/admin/console-state";
import { GRANT_KIND_META, type GrantKind } from "@/components/marketplace/sku-kinds";
import { formatMoney, formatRelative } from "@/lib/money";

const pretty = (value: string) => value.replace(/_/g, " ");

// --- Reports ---------------------------------------------------------------------------

type ReportFilter = "open" | "reviewing" | "resolved" | "dismissed";
const REPORT_TONE: Record<string, Tone> = { open: "warn", reviewing: "info", resolved: "good", dismissed: "neutral" };

export function ReportsSection() {
  const { username } = useStaff();
  const open = useOpenEntity();
  const [filter, setFilter] = useState<ReportFilter>("open");
  const [mineOnly, setMineOnly] = useState(false);
  const rows = useQuery(api.reports.adminList, { status: filter, limit: 150 });
  const counts = useQuery(api.reports.adminCounts);

  const shown = rows?.filter((r) => !mineOnly || r.assignee === username);

  return (
    <div className="space-y-4">
      <PageHeader title="Reports" description="What people have flagged, oldest decisions first." icon={Flag} />
      <PillTabs
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: "open", label: "Open", count: counts?.open },
          { id: "reviewing", label: "In review", count: counts?.reviewing },
          { id: "resolved", label: "Resolved" },
          { id: "dismissed", label: "Dismissed" },
        ]}
      />
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
        Assigned to me
      </label>

      <Panel flush>
        {shown === undefined ? (
          <Loading />
        ) : shown.length === 0 ? (
          <EmptyState icon={Flag} title="No reports here">Nothing matches this view.</EmptyState>
        ) : (
          <div className="divide-y divide-foreground/10">
            {shown.map((r) => (
              <ListRow
                key={r.id}
                onOpen={(e) =>
                  open(
                    { kind: "report", id: r.id, title: `Report · ${pretty(r.category)}`, subtitle: r.target ? `@${r.target.username}` : r.targetType },
                    e,
                  )
                }
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="font-medium capitalize">{pretty(r.category)}</span>
                    <span className="text-xs text-muted-foreground capitalize">{pretty(r.targetType)}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{r.preview ?? "No text attached."}</p>
                </div>
                <div className="hidden w-40 min-w-0 text-xs md:block">
                  <p className="truncate">{r.target ? `@${r.target.username}` : "—"}</p>
                  <p className="truncate text-muted-foreground">from @{r.reporter}</p>
                </div>
                <span className="hidden w-24 truncate text-xs text-muted-foreground lg:block">
                  {r.assignee ? `→ @${r.assignee}` : "Unassigned"}
                </span>
                <StatusPill tone={REPORT_TONE[r.status]}>{pretty(r.status)}</StatusPill>
                <span className="w-16 text-right text-xs text-muted-foreground">{formatRelative(r.createdAt)}</span>
              </ListRow>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// --- Support ------------------------------------------------------------------------------

type TicketFilter = "open" | "in_progress" | "waiting_on_user" | "resolved" | "closed";
const TICKET_TONE: Record<string, Tone> = {
  open: "warn",
  in_progress: "info",
  waiting_on_user: "neutral",
  resolved: "good",
  closed: "neutral",
};

export function SupportSection() {
  const open = useOpenEntity();
  const [filter, setFilter] = useState<TicketFilter>("open");
  const rows = useQuery(api.support.adminList, { status: filter });

  return (
    <div className="space-y-4">
      <PageHeader title="Support inbox" description="Customer requests, with the whole conversation kept." icon={Inbox} />
      <PillTabs
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: "open", label: "Open" },
          { id: "in_progress", label: "In progress" },
          { id: "waiting_on_user", label: "Waiting on user" },
          { id: "resolved", label: "Resolved" },
          { id: "closed", label: "Closed" },
        ]}
      />
      <Panel flush>
        {rows === undefined ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState icon={Inbox} title="No tickets here" />
        ) : (
          <div className="divide-y divide-foreground/10">
            {rows.map((t) => (
              <ListRow
                key={t._id}
                onOpen={(e) => open({ kind: "ticket", id: t._id, title: t.subject, subtitle: t.user ? `@${t.user.username}` : undefined }, e)}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{t.subject}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.user ? `@${t.user.username}` : "Unknown"} · {t.preview}
                  </p>
                </div>
                <StatusPill>{t.category}</StatusPill>
                {(t.priority === "high" || t.priority === "urgent") && <StatusPill tone="bad">{t.priority}</StatusPill>}
                <StatusPill tone={TICKET_TONE[t.status]}>{pretty(t.status)}</StatusPill>
                <span className="w-16 text-right text-xs text-muted-foreground">{formatRelative(t.updatedAt)}</span>
              </ListRow>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// --- Creator submissions -------------------------------------------------------------------

type SubmissionFilter = "pending" | "approved" | "rejected";

export function SubmissionsSection() {
  const open = useOpenEntity();
  const [filter, setFilter] = useState<SubmissionFilter>("pending");
  const rows = useQuery(api.marketplace.adminSubmissions, { status: filter });

  return (
    <div className="space-y-4">
      <PageHeader title="Creator submissions" description="Things members want to sell. Nothing reaches the shop until it is approved here." icon={Palette} />
      <PillTabs
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: "pending", label: "Pending" },
          { id: "approved", label: "Approved" },
          { id: "rejected", label: "Rejected" },
        ]}
      />
      <Panel flush>
        {rows === undefined ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState icon={Palette} title="Nothing here" />
        ) : (
          <div className="divide-y divide-foreground/10">
            {rows.map((s) => (
              <ListRow
                key={s._id}
                onOpen={(e) => open({ kind: "submission", id: s._id, title: s.name, subtitle: `by @${s.creator}` }, e)}
              >
                {s.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.previewUrl} alt="" className="size-10 shrink-0 rounded-lg bg-foreground/5 object-contain" />
                ) : (
                  <div className="size-10 shrink-0 rounded-lg bg-foreground/5" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {GRANT_KIND_META[s.kind as GrantKind]?.label ?? s.kind} · by @{s.creator}
                  </p>
                </div>
                <span className="text-sm tabular-nums">{formatMoney(s.requestedPriceCents, s.currency)}</span>
                <StatusPill tone={s.status === "pending" ? "warn" : s.status === "approved" ? "good" : "bad"}>{s.status}</StatusPill>
                <span className="w-16 text-right text-xs text-muted-foreground">{formatRelative(s.createdAt)}</span>
              </ListRow>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

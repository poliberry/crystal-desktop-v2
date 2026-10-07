"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Puzzle } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import { EmptyState, ListRow, Loading, PageHeader, Panel, PillTabs, StatusPill } from "@/components/admin/admin-ui";
import { useOpenEntity } from "@/components/admin/console-state";
import { formatRelative } from "@/lib/money";

type Filter = "pending" | "approved" | "rejected" | "revoked";

/** Versions of extensions waiting to be read, and the ones already running on people's devices. */
export function ExtensionsSection() {
  const open = useOpenEntity();
  const [filter, setFilter] = useState<Filter>("pending");
  const rows = useQuery(api.extensions.adminList, { status: filter });

  return (
    <div className="space-y-4">
      <PageHeader title="Extensions" description="Code written by others, run on members' devices in a sandbox. Read every line before approving; revoke to stop one everywhere at once." icon={Puzzle} />
      <PillTabs
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: "pending", label: "Waiting" },
          { id: "approved", label: "Approved" },
          { id: "rejected", label: "Rejected" },
          { id: "revoked", label: "Revoked" },
        ]}
      />
      <Panel flush>
        {rows === undefined ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState icon={Puzzle} title="Nothing here" />
        ) : (
          <div className="divide-y divide-foreground/10">
            {rows.map((r) => (
              <ListRow key={r.id} onOpen={(e) => open({ kind: "extension", id: r.id, title: `${r.name} ${r.version}`, subtitle: `by @${r.publisher}` }, e)}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {r.name} <span className="font-normal text-muted-foreground">v{r.version}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.slug} · by @{r.publisher} · {r.capabilities.length ? r.capabilities.join(", ") : "asks for nothing"}
                  </p>
                </div>
                {r.suspended && <StatusPill tone="bad">suspended</StatusPill>}
                {r.errors > 0 && <StatusPill tone="bad">{r.errors} error{r.errors === 1 ? "" : "s"}</StatusPill>}
                {r.warnings > 0 && <StatusPill tone="warn">{r.warnings} warning{r.warnings === 1 ? "" : "s"}</StatusPill>}
                <StatusPill tone={r.status === "pending" ? "warn" : r.status === "approved" ? "good" : "bad"}>{r.status}</StatusPill>
                <span className="w-16 text-right text-xs text-muted-foreground">{formatRelative(r.createdAt)}</span>
              </ListRow>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

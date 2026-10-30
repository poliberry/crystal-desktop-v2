"use client";

import { useQuery, usePaginatedQuery } from "convex/react";
import { Loader2, ScrollText } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_LABELS,
  actionLabel,
  actionsIn,
  isAuditCategory,
} from "../../../../convex/lib/communityAuditActions";
import { SettingRow, SettingsCard, SettingsGroup } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime } from "@/lib/locale";

const ALL = "all";
const PAGE_SIZE = 30;

/**
 * Who changed what in this community, newest first. Shown to people with View Audit Log (the owner
 * and Administrators included); the server refuses anyone else, so hiding the tab is a courtesy.
 * Holds what changed, never what a message said.
 */
export function AuditLogSettings({ communityId }: { communityId: Id<"communities"> }) {
  const [category, setCategory] = useState(ALL);
  const [action, setAction] = useState(ALL);
  const [actorId, setActorId] = useState(ALL);

  const actors = useQuery(api.communityAudit.recentActors, { communityId });
  const { results, status, loadMore } = usePaginatedQuery(
    api.communityAudit.list,
    {
      communityId,
      ...(category !== ALL ? { category } : {}),
      ...(action !== ALL ? { action } : {}),
      ...(actorId !== ALL ? { actorId: actorId as Id<"users"> } : {}),
    },
    { initialNumItems: PAGE_SIZE },
  );

  const filtered = category !== ALL || action !== ALL || actorId !== ALL;
  const actionChoices = isAuditCategory(category) ? actionsIn(category) : (Object.keys(AUDIT_ACTIONS) as (keyof typeof AUDIT_ACTIONS)[]);

  return (
    <div className="space-y-6">
      <SettingsCard className="flex flex-wrap items-center gap-2 px-4 py-3">
        <Select
          value={category}
          onValueChange={(next) => {
            setCategory(next);
            setAction(ALL);
          }}
        >
          <SelectTrigger className="w-44" aria-label="Filter by type"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {AUDIT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{AUDIT_CATEGORY_LABELS[c]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-60" aria-label="Filter by action"><SelectValue placeholder="Any action" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any action</SelectItem>
            {actionChoices.map((a) => <SelectItem key={a} value={a}>{AUDIT_ACTIONS[a].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={actorId} onValueChange={setActorId}>
          <SelectTrigger className="w-48" aria-label="Filter by who did it"><SelectValue placeholder="Anyone" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Anyone</SelectItem>
            {(actors ?? []).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => { setCategory(ALL); setAction(ALL); setActorId(ALL); }}>
            Clear filters
          </Button>
        )}
      </SettingsCard>

      <SettingsGroup>
        {status === "LoadingFirstPage" ? (
          <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />
        ) : results.length === 0 ? (
          <SettingRow
            icon={ScrollText}
            title={filtered ? "Nothing matches those filters" : "Nothing recorded yet"}
            description={filtered ? "Try a wider filter." : "Changes to members, roles, channels and settings appear here. Entries are kept for 180 days."}
          />
        ) : (
          results.map((row) => (
            <SettingRow
              key={row.id}
              title={`${row.actorName} · ${actionLabel(row.action)}${row.targetName ? ` · ${row.targetName}` : ""}`}
              description={`${formatDateTime(row.createdAt)}${row.details ? ` · ${row.details}` : ""}`}
            />
          ))
        )}
        {status === "CanLoadMore" && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => loadMore(PAGE_SIZE)}>Load more</Button>
          </div>
        )}
        {status === "LoadingMore" && <Loader2 className="mx-auto my-4 size-5 animate-spin text-muted-foreground" />}
      </SettingsGroup>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Archive, Globe2, ShieldAlert, ShieldCheck } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, EntityLink, Fields, ListRow, Loading, Panel, ReasonDialog, StatusPill, useStaff, type Tone } from "@/components/admin/admin-ui";
import { useConsole } from "@/components/admin/console-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { formatDate, formatRelative } from "@/lib/money";

const STATUS: Record<string, { tone: Tone; blurb: string }> = {
  active: { tone: "good", blurb: "Normal." },
  restricted: { tone: "warn", blurb: "No new members can join. Existing members carry on." },
  archived: { tone: "bad", blurb: "Read-only: nobody can post or join. Nothing is deleted." },
};

export function CommunityRecord({ id }: { id: string }) {
  const staff = useStaff();
  const { retitle } = useConsole();
  const communityId = id as Id<"communities">;
  const detail = useQuery(api.operations.communityDetail, { communityId });
  const setStatus = useMutation(api.operations.setCommunityStatus);
  const [changing, setChanging] = useState<"restricted" | "archived" | "active" | null>(null);

  useEffect(() => {
    if (detail) retitle({ kind: "community", id }, detail.name, `${detail.memberCount} members`);
  }, [detail, id, retitle]);

  if (detail === undefined) return <Loading />;
  if (detail === null) return <EmptyState icon={Globe2} title="That community no longer exists" />;
  const manage = staff.can("communities.manage");
  const status = STATUS[detail.status];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-4">
        <Avatar className="size-16 rounded-2xl">
          <AvatarImage src={detail.imageUrl} alt="" />
          <AvatarFallback className="rounded-2xl">{detail.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{detail.name}</h1>
          <p className="text-sm text-muted-foreground">
            {detail.memberCount} members · {detail.channelCount} channels · created {formatDate(detail.createdAt)}
          </p>
        </div>
        <StatusPill tone={status.tone}>{detail.status}</StatusPill>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Panel title="Details">
            <Fields
              items={[
                ["Owner", <EntityLink key="o" entity={{ kind: "user", id: detail.ownerId, title: detail.owner, subtitle: "Community owner" }}>@{detail.owner}</EntityLink>],
                ["Joining", detail.inviteOnly ? "Invite only" : "Open to everyone"],
                ["Members", detail.memberCount],
                ["Channels", detail.channelCount],
              ]}
            />
          </Panel>

          <Panel title="Reports involving this community" flush>
            {detail.reports.length === 0 ? (
              <EmptyState title="None" />
            ) : (
              <div className="divide-y divide-foreground/10">
                {detail.reports.map((r) => (
                  <ListRow key={r.id}>
                    <EntityLink entity={{ kind: "report", id: r.id, title: `Report · ${r.category.replace(/_/g, " ")}`, subtitle: detail.name }} className="flex-1 text-left capitalize">
                      {r.category.replace(/_/g, " ")}
                    </EntityLink>
                    <StatusPill tone={r.status === "open" ? "warn" : r.status === "reviewing" ? "info" : "neutral"}>{r.status}</StatusPill>
                    <span className="text-xs text-muted-foreground">{formatRelative(r.createdAt)}</span>
                  </ListRow>
                ))}
              </div>
            )}
          </Panel>

          {detail.items.length > 0 && (
            <Panel title="Marketplace items" flush>
              <div className="divide-y divide-foreground/10">
                {detail.items.map((i) => (
                  <ListRow key={i.id}>
                    <span className="flex-1 truncate">{i.skuName}</span>
                    <StatusPill tone={i.active ? "good" : "neutral"}>{i.active ? "Active" : "Inactive"}</StatusPill>
                  </ListRow>
                ))}
              </div>
            </Panel>
          )}
        </div>

        <Panel title="Platform status">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{status.blurb}</p>
            {detail.reason && <p className="rounded-lg bg-foreground/5 p-2 text-sm">{detail.reason}</p>}
            {detail.moderatedBy && (
              <p className="text-xs text-muted-foreground">
                Set by @{detail.moderatedBy} {detail.moderatedAt ? formatRelative(detail.moderatedAt) : ""}
              </p>
            )}
            {manage ? (
              <div className="space-y-2">
                {detail.status !== "active" && (
                  <Button variant="outline" className="w-full" onClick={() => setChanging("active")}>
                    <ShieldCheck className="text-emerald-500" /> Restore to normal
                  </Button>
                )}
                {detail.status !== "restricted" && (
                  <Button variant="outline" className="w-full" onClick={() => setChanging("restricted")}>
                    <ShieldAlert className="text-amber-500" /> Restrict joining
                  </Button>
                )}
                {detail.status !== "archived" && (
                  <Button variant="outline" className="w-full text-destructive" onClick={() => setChanging("archived")}>
                    <Archive /> Archive (read-only)
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">You can view communities but not change their status.</p>
            )}
          </div>
        </Panel>
      </div>

      <ReasonDialog
        open={!!changing}
        onOpenChange={(o) => !o && setChanging(null)}
        title={changing === "active" ? "Restore this community?" : changing === "restricted" ? "Restrict joining?" : "Archive this community?"}
        description={changing ? STATUS[changing].blurb : undefined}
        confirmLabel={changing === "active" ? "Restore" : changing === "restricted" ? "Restrict" : "Archive"}
        destructive={changing === "archived"}
        minLength={changing === "active" ? 0 : 3}
        onConfirm={(reason) => setStatus({ communityId, status: changing!, reason: reason || undefined })}
      />
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Ban, Gift, Loader2, ShieldCheck, ShieldOff, UserRound } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  EmptyState,
  EntityLink,
  Fields,
  ListRow,
  Loading,
  Panel,
  PillTabs,
  ReasonDialog,
  StatusPill,
  useRun,
  useStaff,
  type Tone,
} from "@/components/admin/admin-ui";
import { useConsole } from "@/components/admin/console-state";
import { GRANT_KIND_META, type GrantKind } from "@/components/marketplace/sku-kinds";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatMoney, formatRelative } from "@/lib/money";

type Tab = "overview" | "items" | "moderation" | "orders";
const pretty = (value: string) => value.replace(/_/g, " ");
const ORDER_TONE: Record<string, Tone> = { paid: "good", refunded: "warn", pending: "neutral", failed: "bad", canceled: "neutral" };

const DURATIONS: [string, string][] = [
  ["1", "1 day"],
  ["7", "7 days"],
  ["30", "30 days"],
  ["90", "90 days"],
  ["365", "1 year"],
  ["forever", "Until lifted"],
];

export function UserRecord({ id }: { id: string }) {
  const staff = useStaff();
  const { retitle } = useConsole();
  const userId = id as Id<"users">;
  const detail = useQuery(api.operations.userDetail, { userId });
  const [tab, setTab] = useState<Tab>("overview");
  const [suspending, setSuspending] = useState(false);
  const [lifting, setLifting] = useState(false);
  const [days, setDays] = useState("7");
  const suspend = useMutation(api.operations.suspendUser);
  const unsuspend = useMutation(api.operations.unsuspendUser);

  useEffect(() => {
    if (detail) retitle({ kind: "user", id }, detail.user.name, `@${detail.user.username}`);
  }, [detail, id, retitle]);

  if (detail === undefined) return <Loading />;
  if (detail === null) return <EmptyState icon={UserRound} title="That account no longer exists" />;

  const { user, suspension } = detail;
  const canModerate = staff.can("users.moderate");

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-4">
        <Avatar className="size-16">
          <AvatarImage src={user.imageUrl} alt="" />
          <AvatarFallback>{user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{user.name}</h1>
          <p className="text-sm text-muted-foreground">
            @{user.username} · joined {formatDate(user.joinedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {detail.isStaff && <StatusPill tone="info">Staff</StatusPill>}
          {suspension && <StatusPill tone="bad">Suspended</StatusPill>}
          {canModerate && !detail.isStaff && (
            suspension ? (
              <Button variant="outline" onClick={() => setLifting(true)}>
                <ShieldCheck /> Lift suspension
              </Button>
            ) : (
              <Button variant="outline" className="text-destructive" onClick={() => setSuspending(true)}>
                <Ban /> Suspend
              </Button>
            )
          )}
        </div>
      </header>

      {suspension && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4">
          <ShieldOff className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="text-sm">
            <p className="font-medium text-destructive">
              Suspended {suspension.until ? `until ${formatDate(suspension.until, true)}` : "until lifted"}
            </p>
            <p className="text-muted-foreground">{suspension.reason}</p>
          </div>
        </div>
      )}

      <PillTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "items", label: "Items", count: detail.entitlements.filter((e) => e.active).length },
          { id: "moderation", label: "Moderation", count: detail.reportsAbout.filter((r) => r.status === "open" || r.status === "reviewing").length },
          ...(detail.orders ? [{ id: "orders" as const, label: "Orders", count: 0 }] : []),
        ]}
      />

      {tab === "overview" && <Overview detail={detail} />}
      {tab === "items" && <Items detail={detail} userId={userId} />}
      {tab === "moderation" && <Moderation detail={detail} />}
      {tab === "orders" && detail.orders && <Orders orders={detail.orders} username={user.username} />}

      <ReasonDialog
        open={suspending}
        onOpenChange={setSuspending}
        title={`Suspend @${user.username}?`}
        description="They can still sign in to read their own account, but can't send messages, join calls, buy or change anything."
        confirmLabel="Suspend"
        destructive
        placeholder="Reason — shown to them, and kept in the audit log"
        onConfirm={(reason) => suspend({ userId, reason, days: days === "forever" ? undefined : Number(days) })}
      >
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DURATIONS.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ReasonDialog>
      <ReasonDialog
        open={lifting}
        onOpenChange={setLifting}
        title={`Lift the suspension on @${user.username}?`}
        confirmLabel="Lift suspension"
        placeholder="Why it's being lifted"
        onConfirm={(reason) => unsuspend({ userId, reason })}
      />
    </div>
  );
}

type Detail = NonNullable<FunctionReturnType<typeof api.operations.userDetail>>;

function Overview({ detail }: { detail: Detail }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Profile">
        <Fields
          items={[
            ["Bio", detail.user.bio || <span key="b" className="text-muted-foreground">None</span>],
            ["Status", detail.user.customStatus || "—"],
            ["Member of", `${detail.communities.member} communities`],
            ["Reports filed", detail.reportsFiled],
            ["Reports about them", detail.reportsAbout.length],
            ["Purchases", detail.orderCount],
          ]}
        />
      </Panel>
      <Panel title="Communities they own" flush>
        {detail.communities.owned.length === 0 ? (
          <EmptyState title="None" />
        ) : (
          <div className="divide-y divide-foreground/10">
            {detail.communities.owned.map((c) => (
              <ListRow key={c.id}>
                <EntityLink entity={{ kind: "community", id: c.id, title: c.name }}>{c.name}</EntityLink>
              </ListRow>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Items({ detail, userId }: { detail: Detail; userId: Id<"users"> }) {
  const staff = useStaff();
  const revoke = useMutation(api.operations.revokeEntitlement);
  const grant = useMutation(api.operations.grantSku);
  const skus = useQuery(api.catalog.adminListSkus, staff.can("catalog.read") && staff.can("users.entitle") ? {} : "skip");
  const [revoking, setRevoking] = useState<Id<"entitlements"> | null>(null);
  const [giving, setGiving] = useState(false);
  const [skuId, setSkuId] = useState("");
  const [communityId, setCommunityId] = useState("");
  const { busy } = useRun();

  const giftable = useMemo(() => (skus ?? []).filter((s) => s.type !== "subscription" && s.status !== "draft"), [skus]);
  const chosen = giftable.find((s) => s.id === skuId);
  const canEntitle = staff.can("users.entitle");

  return (
    <Panel
      title="Items they have"
      flush
      actions={
        canEntitle && (
          <Button size="sm" variant="outline" onClick={() => setGiving(true)}>
            <Gift /> Give an item
          </Button>
        )
      }
    >
      {detail.entitlements.length === 0 ? (
        <EmptyState title="Nothing yet" />
      ) : (
        <div className="divide-y divide-foreground/10">
          {detail.entitlements.map((e) => (
            <ListRow key={e.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{e.skuName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {GRANT_KIND_META[e.kind as GrantKind]?.label ?? e.kind}
                  {e.communityName ? ` · ${e.communityName}` : ""} · {formatDate(e.createdAt)}
                  {e.expiresAt ? ` · until ${formatDate(e.expiresAt)}` : ""}
                </p>
              </div>
              <StatusPill tone={e.source === "staff" ? "info" : "neutral"}>{e.source === "staff" ? "Gifted" : e.source}</StatusPill>
              <StatusPill tone={e.active ? "good" : "neutral"}>{e.active ? "Active" : e.revokedAt ? "Revoked" : "Expired"}</StatusPill>
              {canEntitle && e.active && e.source === "staff" && (
                <Button size="sm" variant="ghost" className="text-destructive" disabled={busy === e.id} onClick={() => setRevoking(e.id as Id<"entitlements">)}>
                  Take back
                </Button>
              )}
            </ListRow>
          ))}
        </div>
      )}

      <ReasonDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Take this back?"
        description="Only gifts can be taken back here. Something they paid for is taken back by refunding the order."
        confirmLabel="Take back"
        destructive
        onConfirm={(reason) => revoke({ entitlementId: revoking!, reason })}
      />
      <ReasonDialog
        open={giving}
        onOpenChange={(o) => {
          setGiving(o);
          if (!o) {
            setSkuId("");
            setCommunityId("");
          }
        }}
        title="Give an item"
        description="They get it without paying. It's recorded against your name."
        confirmLabel="Give"
        placeholder="Why — a gift, or making good on a problem"
        onConfirm={(reason) =>
          grant({ userId, skuId: skuId as Id<"skus">, communityId: communityId ? (communityId as Id<"communities">) : undefined, reason })
        }
      >
        <div className="space-y-2">
          <Select value={skuId} onValueChange={setSkuId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose an item" />
            </SelectTrigger>
            <SelectContent>
              {giftable.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {chosen?.type === "community" && (
            <Select value={communityId} onValueChange={setCommunityId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Which of their communities?" />
              </SelectTrigger>
              <SelectContent>
                {detail.communities.owned.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!skus && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </div>
      </ReasonDialog>
    </Panel>
  );
}

function Moderation({ detail }: { detail: Detail }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Reports about them" flush>
        {detail.reportsAbout.length === 0 ? (
          <EmptyState title="No reports" />
        ) : (
          <div className="divide-y divide-foreground/10">
            {detail.reportsAbout.map((r) => (
              <ListRow key={r.id}>
                <EntityLink
                  entity={{ kind: "report", id: r.id, title: `Report · ${pretty(r.category)}`, subtitle: `@${detail.user.username}` }}
                  className="flex-1 text-left capitalize"
                >
                  {pretty(r.category)}
                </EntityLink>
                <StatusPill tone={r.status === "open" ? "warn" : r.status === "reviewing" ? "info" : "neutral"}>{pretty(r.status)}</StatusPill>
                <span className="text-xs text-muted-foreground">{formatRelative(r.createdAt)}</span>
              </ListRow>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Moderation history" flush>
        {detail.moderationLog.length === 0 ? (
          <EmptyState title="Clean record" />
        ) : (
          <div className="divide-y divide-foreground/10">
            {detail.moderationLog.map((entry) => (
              <ListRow key={entry.id} className="items-start">
                <StatusPill tone={entry.action === "suspend" ? "bad" : "good"}>{entry.action === "suspend" ? "Suspended" : "Lifted"}</StatusPill>
                <div className="min-w-0 flex-1 text-sm">
                  <p>{entry.reason ?? "No reason recorded"}</p>
                  <p className="text-xs text-muted-foreground">
                    @{entry.actor} · {formatDate(entry.createdAt, true)}
                    {entry.until ? ` · until ${formatDate(entry.until)}` : entry.action === "suspend" ? " · indefinitely" : ""}
                  </p>
                </div>
              </ListRow>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Orders({ orders, username }: { orders: NonNullable<Detail["orders"]>; username: string }) {
  return (
    <Panel title="Orders" flush>
      {orders.length === 0 ? (
        <EmptyState title="No purchases" />
      ) : (
        <div className="divide-y divide-foreground/10">
          {orders.map((o) => (
            <ListRow key={o.id}>
              <EntityLink entity={{ kind: "order", id: o.id, title: o.skuName, subtitle: `@${username}` }} className="flex-1 truncate text-left">
                {o.skuName}
              </EntityLink>
              <span className="text-xs text-muted-foreground">{formatDate(o.createdAt)}</span>
              <StatusPill tone={ORDER_TONE[o.status]}>{o.status}</StatusPill>
              <span className="w-20 text-right text-sm tabular-nums">{formatMoney(o.amountCents, o.currency, { free: false })}</span>
            </ListRow>
          ))}
        </div>
      )}
    </Panel>
  );
}

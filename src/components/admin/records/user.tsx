"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Award, Ban, Gift, Gavel, Loader2, Mail, ShieldCheck, ShieldOff, SlidersHorizontal, TicketPlus, UserRound } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ABILITIES, ABILITY_LABELS, type Ability } from "../../../../convex/lib/abilities";
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
import { CreateTicketDialog, EmailHistory, EmailUserDialog } from "@/components/admin/email-dialogs";
import { useConsole } from "@/components/admin/console-state";
import { GRANT_KIND_META, type GrantKind } from "@/components/marketplace/sku-kinds";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatMoney, formatRelative } from "@/lib/money";

type Tab = "overview" | "items" | "moderation" | "orders" | "emails";
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

const HISTORY: Record<string, { label: string; tone: Tone }> = {
  suspend: { label: "Suspended", tone: "bad" },
  unsuspend: { label: "Suspension lifted", tone: "good" },
  limit: { label: "Limited", tone: "warn" },
  unlimit: { label: "Limits lifted", tone: "good" },
  ban: { label: "Banned", tone: "bad" },
  unban: { label: "Ban lifted", tone: "good" },
};

/** The length choices as a select, shared by suspending and limiting. */
function DurationSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DURATIONS.map(([option, label]) => (
          <SelectItem key={option} value={option}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function UserRecord({ id }: { id: string }) {
  const staff = useStaff();
  const { retitle } = useConsole();
  const userId = id as Id<"users">;
  const detail = useQuery(api.operations.userDetail, { userId });
  const [tab, setTab] = useState<Tab>("overview");
  const [suspending, setSuspending] = useState(false);
  const [lifting, setLifting] = useState(false);
  const [days, setDays] = useState("7");
  const [limiting, setLimiting] = useState(false);
  const [unlimiting, setUnlimiting] = useState(false);
  const [limitDays, setLimitDays] = useState("7");
  const [limitAbilities, setLimitAbilities] = useState<Ability[]>(["send_messages"]);
  const [banning, setBanning] = useState(false);
  const [unbanning, setUnbanning] = useState(false);
  const [includeNetwork, setIncludeNetwork] = useState(true);
  const [emailing, setEmailing] = useState(false);
  const [ticketing, setTicketing] = useState(false);
  const suspend = useMutation(api.operations.suspendUser);
  const unsuspend = useMutation(api.operations.unsuspendUser);
  const limit = useMutation(api.operations.limitUser);
  const unlimit = useMutation(api.operations.unlimitUser);
  const ban = useMutation(api.operations.banUser);
  const unban = useMutation(api.operations.unbanUser);

  useEffect(() => {
    if (detail) retitle({ kind: "user", id }, detail.user.name, `@${detail.user.username}`);
  }, [detail, id, retitle]);

  if (detail === undefined) return <Loading />;
  if (detail === null) return <EmptyState icon={UserRound} title="That account no longer exists" />;

  const { user, suspension, ban: banned, limits } = detail;
  const canModerate = staff.can("users.moderate");
  const canBan = staff.can("users.ban");

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
        <div className="flex flex-wrap items-center justify-end gap-2">
          {staff.can("support.act") && (
            <>
              <Button variant="outline" onClick={() => setEmailing(true)}>
                <Mail /> Email
              </Button>
              <Button variant="outline" onClick={() => setTicketing(true)}>
                <TicketPlus /> Open ticket
              </Button>
            </>
          )}
          {detail.isStaff && <StatusPill tone="info">Staff</StatusPill>}
          {banned && <StatusPill tone="bad">Banned</StatusPill>}
          {suspension && <StatusPill tone="bad">Suspended</StatusPill>}
          {limits && <StatusPill tone="warn">Limited</StatusPill>}
          {!detail.isStaff && !banned && canModerate && (
            <>
              {limits ? (
                <Button variant="outline" onClick={() => setUnlimiting(true)}>
                  <ShieldCheck /> Lift limits
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setLimiting(true)}>
                  <SlidersHorizontal /> Limit
                </Button>
              )}
              {suspension ? (
                <Button variant="outline" onClick={() => setLifting(true)}>
                  <ShieldCheck /> Lift suspension
                </Button>
              ) : (
                <Button variant="outline" className="text-destructive" onClick={() => setSuspending(true)}>
                  <Ban /> Suspend
                </Button>
              )}
            </>
          )}
          {!detail.isStaff && canBan &&
            (banned ? (
              <Button variant="outline" onClick={() => setUnbanning(true)}>
                <ShieldCheck /> Lift ban
              </Button>
            ) : (
              <Button variant="destructive" onClick={() => setBanning(true)}>
                <Gavel /> Ban
              </Button>
            ))}
        </div>
      </header>

      {banned && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4">
          <Gavel className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="text-sm">
            <p className="font-medium text-destructive">Banned {formatDate(banned.at, true)}</p>
            {banned.reason && <p className="text-muted-foreground">{banned.reason}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              {detail.network.bannedNetworks > 0
                ? `New accounts are refused from ${detail.network.bannedNetworks} network${detail.network.bannedNetworks === 1 ? "" : "s"} this account used.`
                : "No networks are banned with this account."}
            </p>
          </div>
        </div>
      )}

      {limits && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <SlidersHorizontal className="mt-0.5 size-5 shrink-0 text-amber-500" />
          <div className="text-sm">
            <p className="font-medium text-amber-500">
              Limited {limits.until ? `until ${formatDate(limits.until, true)}` : "until lifted"}
            </p>
            <p className="text-muted-foreground">Can't: {limits.abilities.map((ability) => ABILITY_LABELS[ability as Ability]?.label.toLowerCase() ?? ability).join(", ")}</p>
            {limits.reason && <p className="text-muted-foreground">{limits.reason}</p>}
          </div>
        </div>
      )}

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
          { id: "emails" as const, label: "Emails" },
        ]}
      />

      {tab === "overview" && <Overview detail={detail} />}
      {tab === "items" && <Items detail={detail} userId={userId} />}
      {tab === "moderation" && <Moderation detail={detail} />}
      {tab === "orders" && detail.orders && <Orders orders={detail.orders} username={user.username} />}
      {tab === "emails" && (
        <Panel title="Emails sent to them" description="Replies, report updates and anything staff wrote. Their address is never shown." flush>
          <EmailHistory userId={userId} />
        </Panel>
      )}
      <EmailUserDialog open={emailing} onOpenChange={setEmailing} user={{ id: userId, username: user.username }} />
      <CreateTicketDialog
        open={ticketing}
        onOpenChange={setTicketing}
        presetUser={{ id: userId, username: user.username, name: user.name, imageUrl: user.imageUrl }}
      />

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
        <DurationSelect value={days} onChange={setDays} />
      </ReasonDialog>
      <ReasonDialog
        open={limiting}
        onOpenChange={setLimiting}
        title={`Limit @${user.username}?`}
        description="They can still sign in and use everything else. The server refuses only what's ticked, and tells them so."
        confirmLabel="Limit"
        placeholder="Reason — shown to them, and kept in the audit log"
        onConfirm={(reason) => limit({ userId, reason, abilities: limitAbilities, days: limitDays === "forever" ? undefined : Number(limitDays) })}
      >
        <div className="space-y-3">
          <div className="space-y-2">
            {ABILITIES.map((ability) => (
              <label key={ability} className="flex cursor-pointer items-start gap-3 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={limitAbilities.includes(ability)}
                  onCheckedChange={(checked) =>
                    setLimitAbilities((current) => (checked ? [...current.filter((a) => a !== ability), ability] : current.filter((a) => a !== ability)))
                  }
                />
                <span>
                  <span className="font-medium">{ABILITY_LABELS[ability].label}</span>
                  <span className="block text-xs text-muted-foreground">{ABILITY_LABELS[ability].description}</span>
                </span>
              </label>
            ))}
          </div>
          <DurationSelect value={limitDays} onChange={setLimitDays} />
          {limitAbilities.length === 0 && <p className="text-xs text-destructive">Pick at least one.</p>}
        </div>
      </ReasonDialog>
      <ReasonDialog
        open={unlimiting}
        onOpenChange={setUnlimiting}
        title={`Lift the limits on @${user.username}?`}
        confirmLabel="Lift limits"
        minLength={0}
        placeholder="Why they're being lifted (optional)"
        onConfirm={(reason) => unlimit({ userId, reason: reason || undefined })}
      />
      <ReasonDialog
        open={banning}
        onOpenChange={setBanning}
        title={`Ban @${user.username}?`}
        description="They are signed out of everything and can't read or do anything, until a ban is lifted. This can't be undone by them."
        confirmLabel="Ban"
        destructive
        placeholder="Reason — shown to them, and kept in the audit log"
        onConfirm={async (reason) => {
          await ban({ userId, reason, includeNetwork });
        }}
      >
        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <Checkbox className="mt-0.5" checked={includeNetwork} onCheckedChange={(checked) => setIncludeNetwork(checked === true)} disabled={!detail.network.protectionOn} />
          <span>
            <span className="font-medium">Also refuse new accounts from their networks</span>
            <span className="block text-xs text-muted-foreground">
              {detail.network.protectionOn
                ? "Anyone who makes a new account from an address this account has used is banned on arrival. People who already have accounts there aren't affected. Addresses are encrypted and never shown."
                : "Network bans aren't set up on this deployment (IP_HASH_KEY and CREDENTIALS_ENCRYPTION_KEY), so only the account will be banned."}
            </span>
          </span>
        </label>
      </ReasonDialog>
      <ReasonDialog
        open={unbanning}
        onOpenChange={setUnbanning}
        title={`Lift the ban on @${user.username}?`}
        description="The account works again, and the networks banned with it are cleared."
        confirmLabel="Lift ban"
        minLength={0}
        placeholder="Why it's being lifted (optional)"
        onConfirm={(reason) => unban({ userId, reason: reason || undefined })}
      />
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
      <Badges detail={detail} userId={detail.user.id as Id<"users">} />
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

function Badges({ detail, userId }: { detail: Detail; userId: Id<"users"> }) {
  const staff = useStaff();
  const setBadge = useMutation(api.operations.setUserBadge);
  // Every badge there is, built-in ones included whether or not the catalogue has been seeded.
  const badges = useQuery(api.badges.adminCatalogue) ?? [];
  const [giving, setGiving] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [badgeId, setBadgeId] = useState("");
  const held = new Set(detail.badges.map((badge) => badge.badgeId));
  const choices = badges.filter((badge) => !held.has(badge.badgeId));
  const canManage = staff.can("users.moderate");

  return (
    <Panel
      title="Badges"
      flush
      actions={canManage ? <Button size="sm" variant="outline" onClick={() => { setBadgeId(choices[0]?.badgeId ?? ""); setGiving(true); }} disabled={choices.length === 0}><Award /> Give badge</Button> : undefined}
    >
      {detail.badges.length === 0 ? <EmptyState title="No badges" /> : (
        <div className="divide-y divide-foreground/10">
          {detail.badges.map((badge) => (
            <ListRow key={badge.badgeId}>
              <div className="min-w-0 flex-1"><p className="font-medium">{badge.label}</p><p className="text-xs text-muted-foreground">{badge.description}</p></div>
              {canManage && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRevoking(badge.badgeId)}>Remove</Button>}
            </ListRow>
          ))}
        </div>
      )}
      <ReasonDialog open={giving} onOpenChange={setGiving} title="Give a badge" description="This is recorded in the staff audit log." confirmLabel="Give badge" placeholder="Why this badge is being given" onConfirm={(reason) => setBadge({ userId, badgeId, granted: true, reason })}>
        <Select value={badgeId} onValueChange={setBadgeId}><SelectTrigger className="w-full"><SelectValue placeholder="Choose a badge" /></SelectTrigger><SelectContent>{choices.map((badge) => <SelectItem key={badge.badgeId} value={badge.badgeId}>{badge.label}</SelectItem>)}</SelectContent></Select>
      </ReasonDialog>
      <ReasonDialog open={!!revoking} onOpenChange={(open) => !open && setRevoking(null)} title="Remove this badge?" description="The change is recorded in the staff audit log." confirmLabel="Remove badge" destructive placeholder="Why this badge is being removed" onConfirm={(reason) => setBadge({ userId, badgeId: revoking!, granted: false, reason })} />
    </Panel>
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
                <StatusPill tone={HISTORY[entry.action]?.tone ?? "neutral"}>{HISTORY[entry.action]?.label ?? entry.action}</StatusPill>
                <div className="min-w-0 flex-1 text-sm">
                  <p>{entry.reason ?? "No reason recorded"}</p>
                  {entry.abilities && entry.abilities.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {entry.abilities.map((ability) => ABILITY_LABELS[ability as Ability]?.label ?? ability).join(", ")}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {entry.actor === "Crystal" ? "Crystal (automatic)" : `@${entry.actor}`} · {formatDate(entry.createdAt, true)}
                    {entry.until
                      ? ` · until ${formatDate(entry.until)}`
                      : entry.action === "suspend"
                        ? " · indefinitely"
                        : entry.action === "limit"
                          ? " · until lifted"
                          : ""}
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

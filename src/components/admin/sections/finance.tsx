"use client";

import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { BarChart3, CircleDollarSign, Download, Loader2, RotateCw, Search, Wallet } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  EmptyState,
  ListRow,
  Loading,
  PageHeader,
  Panel,
  PillTabs,
  StatCard,
  StatusPill,
  useRun,
  useStaff,
  type Tone,
} from "@/components/admin/admin-ui";
import { EntityLink } from "@/components/admin/admin-ui";
import { useOpenEntity } from "@/components/admin/console-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, formatMoney, formatRelative } from "@/lib/money";

const money = (cents: number, currency: string) => formatMoney(cents, currency, { free: false });

// --- A small bar chart -----------------------------------------------------------------------

/** One bar per day. Negative days (refunds outweighing sales) hang below the line. */
function BarChart({ series, currency }: { series: { date: string; cents: number }[]; currency: string }) {
  const max = Math.max(1, ...series.map((p) => Math.abs(p.cents)));
  const hasNegative = series.some((p) => p.cents < 0);
  const height = 120;
  const zero = hasNegative ? height * 0.7 : height;
  const gap = series.length > 45 ? 1 : 3;
  const width = 100 / series.length;

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-36 w-full" role="img" aria-label="Daily revenue">
        <line x1="0" x2="100" y1={zero} y2={zero} className="stroke-foreground/15" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
        {series.map((p, i) => {
          const h = (Math.abs(p.cents) / max) * (p.cents >= 0 ? zero : height - zero) * 0.95;
          return (
            <rect
              key={p.date}
              x={i * width + gap / 20}
              width={Math.max(0.1, width - gap / 10)}
              y={p.cents >= 0 ? zero - h : zero}
              height={h}
              rx="0.4"
              className={p.cents >= 0 ? "fill-primary/70 hover:fill-primary" : "fill-destructive/70"}
            >
              <title>{`${p.date}: ${money(p.cents, currency)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{series[0]?.date}</span>
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}

// --- Revenue ----------------------------------------------------------------------------------

export function RevenueSection() {
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const summary = useQuery(api.finance.summary, { days: Number(days) });
  const exportOrders = useMutation(api.finance.exportOrders);
  const { run, busy } = useRun();

  const download = async () => {
    const result = await run("export", () => exportOrders({ days: Number(days) }));
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `crystal-orders-last-${days}-days.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Revenue"
        description="Each currency on its own — nothing is converted, so nothing is guessed."
        icon={BarChart3}
        actions={
          <Button variant="outline" disabled={busy === "export"} onClick={() => void download()}>
            {busy === "export" ? <Loader2 className="animate-spin" /> : <Download />} Export CSV
          </Button>
        }
      />
      <PillTabs value={days} onChange={setDays} tabs={[{ id: "7", label: "7 days" }, { id: "30", label: "30 days" }, { id: "90", label: "90 days" }]} />

      {summary === undefined ? (
        <Loading />
      ) : (
        <>
          {summary.currencies.length === 0 ? (
            <Panel>
              <EmptyState icon={CircleDollarSign} title="No orders in this period" />
            </Panel>
          ) : (
            summary.currencies.map((c) => (
              <Panel key={c.currency} title={c.currency.toUpperCase()} description={`${c.orders} paid ${c.orders === 1 ? "order" : "orders"}`}>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard label="Net revenue" value={money(c.net, c.currency)} detail="After refunds" tone="good" />
                  <StatCard label="Gross sales" value={money(c.gross, c.currency)} detail={`${c.orders} orders`} />
                  <StatCard label="Refunded" value={money(c.refunded, c.currency)} detail={`${c.refunds} refunds`} tone={c.refunded ? "warn" : "neutral"} />
                  <StatCard label="Discounts" value={money(c.discounts, c.currency)} detail="Given through plans" />
                </div>
                <div className="mt-5">
                  <BarChart series={c.series} currency={c.currency} />
                </div>
              </Panel>
            ))
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Recurring revenue" description="Active subscriptions, as a monthly figure" flush>
              {summary.recurring.length === 0 ? (
                <EmptyState title="No active subscriptions" />
              ) : (
                <div className="divide-y divide-foreground/10">
                  {summary.recurring.map((r) => (
                    <ListRow key={r.currency}>
                      <span className="flex-1 font-medium uppercase">{r.currency}</span>
                      <span className="text-xs text-muted-foreground">{r.subscribers} subscribers</span>
                      <span className="w-28 text-right text-sm font-medium tabular-nums">{money(r.monthlyCents, r.currency)}/mo</span>
                    </ListRow>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Top items" description="By revenue, after refunds" flush>
              {summary.topItems.length === 0 ? (
                <EmptyState title="No sales yet" />
              ) : (
                <div className="divide-y divide-foreground/10">
                  {summary.topItems.map((item, i) => (
                    <ListRow key={`${item.name}-${i}`}>
                      <span className="w-5 text-xs text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                      <span className="text-xs text-muted-foreground">{item.units} sold</span>
                      <span className="w-24 text-right text-sm tabular-nums">{money(item.cents, item.currency)}</span>
                    </ListRow>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <Panel title="Creator payouts" description="All time" flush>
            {summary.payouts.length === 0 ? (
              <EmptyState icon={Wallet} title="No creator sales yet" />
            ) : (
              <div className="divide-y divide-foreground/10">
                {summary.payouts.map((p) => (
                  <ListRow key={p.currency}>
                    <span className="w-16 font-medium uppercase">{p.currency}</span>
                    <span className="flex-1 text-sm">Paid {money(p.paid, p.currency)}</span>
                    <span className="text-sm text-muted-foreground">Waiting {money(p.waiting, p.currency)}</span>
                    {p.failed > 0 && <StatusPill tone="bad">Failed {money(p.failed, p.currency)}</StatusPill>}
                  </ListRow>
                ))}
              </div>
            )}
          </Panel>

          {(summary.pending > 0 || summary.failed > 0) && (
            <p className="text-xs text-muted-foreground">
              {summary.pending} unfinished and {summary.failed} failed payment attempts in this period (not counted above).
            </p>
          )}
        </>
      )}
    </div>
  );
}

// --- Orders -------------------------------------------------------------------------------------

type OrderFilter = "all" | "paid" | "refunded" | "pending" | "failed";
const ORDER_TONE: Record<string, Tone> = { paid: "good", refunded: "warn", pending: "neutral", failed: "bad", canceled: "neutral" };

export function OrdersSection() {
  const open = useOpenEntity();
  const [status, setStatus] = useState<OrderFilter>("all");
  const [username, setUsername] = useState("");
  const orders = useQuery(api.finance.orders, {
    status: status === "all" ? undefined : status,
    username: username.trim() || undefined,
    limit: 100,
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Orders" description="Every purchase attempt. Open one to see the whole story, or to refund it." icon={CircleDollarSign} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillTabs
          value={status}
          onChange={setStatus}
          tabs={[
            { id: "all", label: "All" },
            { id: "paid", label: "Paid" },
            { id: "refunded", label: "Refunded" },
            { id: "pending", label: "Unfinished" },
            { id: "failed", label: "Failed" },
          ]}
        />
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username (exact)" className="h-8 pl-9" />
        </div>
      </div>

      <Panel flush>
        {orders === undefined ? (
          <Loading />
        ) : orders.length === 0 ? (
          <EmptyState icon={CircleDollarSign} title="No orders match" />
        ) : (
          <div className="divide-y divide-foreground/10">
            {orders.map((o) => (
              <ListRow
                key={o.id}
                onOpen={(e) => open({ kind: "order", id: o.id, title: o.skuName, subtitle: `@${o.username}` }, e)}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {o.skuName}
                    {o.isSubscription && <span className="ml-2 text-xs font-normal text-muted-foreground">Subscription</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    @{o.username} · {formatDate(o.createdAt, true)}
                  </p>
                </div>
                <StatusPill tone={ORDER_TONE[o.status]}>{o.status}</StatusPill>
                <span className="w-24 text-right text-sm tabular-nums">
                  {money(o.amountCents, o.currency)}
                  {o.refundedCents > 0 && <span className="block text-xs text-amber-500">−{money(o.refundedCents, o.currency)}</span>}
                </span>
              </ListRow>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// --- Creator payouts ---------------------------------------------------------------------------

type PayoutFilter = "all" | "pending" | "held" | "transferred" | "refunded";
const PAYOUT_TONE: Record<string, Tone> = { pending: "bad", held: "warn", transferred: "good", refunded: "neutral" };
const PAYOUT_LABEL: Record<string, string> = { pending: "Failed", held: "Held", transferred: "Paid", refunded: "Reversed" };

export function PayoutsSection() {
  const staff = useStaff();
  const [filter, setFilter] = useState<PayoutFilter>("all");
  const rows = useQuery(api.finance.payouts, { status: filter === "all" ? undefined : filter });
  const retry = useAction(api.creators.retryPayout);
  const { run, busy } = useRun();
  const open = useOpenEntity();

  const needAttention = useMemo(() => rows?.filter((r) => r.status === "pending").length ?? 0, [rows]);

  return (
    <div className="space-y-4">
      <PageHeader title="Creator payouts" description="What creators are owed, what has been sent, and anything stuck." icon={Wallet} />
      <PillTabs
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: "all", label: "All" },
          { id: "pending", label: "Failed", count: needAttention },
          { id: "held", label: "Held" },
          { id: "transferred", label: "Paid" },
          { id: "refunded", label: "Reversed" },
        ]}
      />
      <Panel flush>
        {rows === undefined ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState icon={Wallet} title="No payouts here" />
        ) : (
          <div className="divide-y divide-foreground/10">
            {rows.map((r) => (
              <ListRow key={r.id}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.skuName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    @{r.creator} · <EntityLink entity={{ kind: "order", id: r.orderId, title: r.skuName, subtitle: `@${r.creator}` }}>order</EntityLink> ·{" "}
                    {formatRelative(r.createdAt)}
                    {r.note ? ` · ${r.note}` : ""}
                  </p>
                </div>
                <div className="w-28 text-right text-xs text-muted-foreground">
                  <p className="text-sm font-medium text-foreground tabular-nums">{money(r.creatorCents, r.currency)}</p>
                  <p>of {money(r.grossCents, r.currency)}</p>
                </div>
                <StatusPill tone={PAYOUT_TONE[r.status]}>{PAYOUT_LABEL[r.status]}</StatusPill>
                {staff.can("finance.payout") && (r.status === "pending" || r.status === "held") ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === r.id}
                    onClick={() => void run(r.id, () => retry({ orderId: r.orderId as Id<"orders"> }), "Retried.")}
                  >
                    {busy === r.id ? <Loader2 className="animate-spin" /> : <RotateCw />} Retry
                  </Button>
                ) : (
                  <span className="w-[4.5rem]" />
                )}
                <button
                  type="button"
                  className="hidden text-xs text-primary hover:underline lg:block"
                  onClick={(e) => open({ kind: "user", id: r.creatorId, title: r.creator, subtitle: "Creator" }, e)}
                >
                  Creator
                </button>
              </ListRow>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Check, Copy, Receipt, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, EntityLink, Fields, ListRow, Loading, Panel, ReasonDialog, StatusPill, useStaff, type Tone } from "@/components/admin/admin-ui";
import { useConsole } from "@/components/admin/console-state";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "@/lib/money";

const TONE: Record<string, Tone> = { paid: "good", refunded: "warn", pending: "neutral", failed: "bad", canceled: "neutral" };
const money = (cents: number, currency: string) => formatMoney(cents, currency, { free: false });

function Copyable({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 font-mono text-xs hover:text-foreground"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        toast.success("Copied.");
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {value}
      {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3 opacity-60" />}
    </button>
  );
}

export function OrderRecord({ id }: { id: string }) {
  const staff = useStaff();
  const { retitle } = useConsole();
  const orderId = id as Id<"orders">;
  const order = useQuery(api.finance.orderDetail, { orderId });
  const refund = useAction(api.payments.refundOrder);
  const [refunding, setRefunding] = useState(false);

  useEffect(() => {
    if (order) retitle({ kind: "order", id }, order.skuName, order.user ? `@${order.user.username}` : undefined);
  }, [order, id, retitle]);

  if (order === undefined) return <Loading />;
  if (order === null) return <EmptyState icon={Receipt} title="That order no longer exists" />;

  const refundable = order.status === "paid" && staff.can("finance.refund") && order.amountCents > 0;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-5">
        <header className="flex flex-wrap items-center gap-3">
          <Receipt className="size-6 text-violet-400" />
          <h1 className="text-2xl font-semibold tracking-tight">{order.skuName}</h1>
          <StatusPill tone={TONE[order.status]}>{order.status}</StatusPill>
          {order.isSubscription && <StatusPill tone="info">Subscription</StatusPill>}
        </header>

        <Panel title="Payment">
          <Fields
            items={[
              ["Charged", money(order.amountCents, order.currency)],
              ["Discount", order.discountCents ? money(order.discountCents, order.currency) : "None"],
              ["Refunded", order.refundedCents ? money(order.refundedCents, order.currency) : "—"],
              ["Created", formatDate(order.createdAt, true)],
              ["Paid", order.paidAt ? formatDate(order.paidAt, true) : "—"],
              ["Refunded on", order.refundedAt ? formatDate(order.refundedAt, true) : "—"],
              ["Payment", order.stripePaymentIntentId ? <Copyable key="p" value={order.stripePaymentIntentId} /> : "—"],
              ["Subscription", order.stripeSubscriptionId ? <Copyable key="s" value={order.stripeSubscriptionId} /> : "—"],
            ]}
          />
        </Panel>

        <Panel title="What it gave" flush>
          {order.entitlements.length === 0 ? (
            <EmptyState title="Nothing was granted" />
          ) : (
            <div className="divide-y divide-foreground/10">
              {order.entitlements.map((e) => (
                <ListRow key={e.id}>
                  <span className="flex-1 font-mono text-xs">{e.kind}</span>
                  <StatusPill tone={e.active ? "good" : "neutral"}>{e.active ? "Active" : e.revokedAt ? "Revoked" : "Expired"}</StatusPill>
                  {e.expiresAt && <span className="text-xs text-muted-foreground">until {formatDate(e.expiresAt)}</span>}
                </ListRow>
              ))}
            </div>
          )}
        </Panel>

        {order.earning && (
          <Panel title="Creator share">
            <Fields
              items={[
                [
                  "Creator",
                  <EntityLink key="c" entity={{ kind: "user", id: order.earning.creatorId, title: order.earning.creator, subtitle: "Creator" }}>
                    @{order.earning.creator}
                  </EntityLink>,
                ],
                ["Creator's share", money(order.earning.creatorCents, order.currency)],
                ["Platform's share", money(order.earning.platformFeeCents, order.currency)],
                ["Payout", <StatusPill key="s" tone={order.earning.status === "transferred" ? "good" : order.earning.status === "pending" ? "bad" : "warn"}>{order.earning.status === "transferred" ? "Paid" : order.earning.status === "refunded" ? "Reversed" : order.earning.status}</StatusPill>],
                ["Note", order.earning.note ?? "—"],
              ]}
            />
          </Panel>
        )}
      </div>

      <aside className="space-y-5">
        <Panel title="Customer">
          {order.user ? (
            <Fields
              items={[
                ["Account", <EntityLink key="u" entity={{ kind: "user", id: order.user.id, title: order.user.name, subtitle: `@${order.user.username}` }}>@{order.user.username}</EntityLink>],
                ["Name", order.user.name],
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">The account is gone.</p>
          )}
        </Panel>
        <Panel title="Refund">
          {refundable ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Refunds the full {money(order.amountCents, order.currency)} to the customer&apos;s card
                {order.isSubscription ? ", cancels the subscription" : ""}, takes back what it gave
                {order.earning ? " and reverses the creator's share" : ""}.
              </p>
              <Button variant="outline" className="w-full text-destructive" onClick={() => setRefunding(true)}>
                <Undo2 /> Refund this order
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {order.status === "refunded"
                ? "Already refunded."
                : order.status !== "paid"
                  ? "Only a paid order can be refunded."
                  : "Refunds are for the finance role."}
            </p>
          )}
        </Panel>
      </aside>

      <ReasonDialog
        open={refunding}
        onOpenChange={setRefunding}
        title="Refund this order?"
        description="This sends the money back through Stripe and can't be undone."
        confirmLabel={`Refund ${money(order.amountCents, order.currency)}`}
        destructive
        placeholder="Why it is being refunded (kept on the record)"
        onConfirm={async (reason) => {
          await refund({ orderId, reason });
          toast.success("Refunded.");
        }}
      />
    </div>
  );
}

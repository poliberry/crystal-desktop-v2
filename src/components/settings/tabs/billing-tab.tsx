"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Loader2, LifeBuoy, MoreHorizontal, Plus, Receipt, Send, Star, Trash2 } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { brandLabel, CardBrandIcon } from "@/components/payments/card-brand";
import { PaymentMethodForm } from "@/components/payments/payment-method-form";
import { SettingRow, SettingsCard, SettingsGroup } from "@/components/settings/settings-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatMoney, formatRelative } from "@/lib/money";
import { paymentsConfigured } from "@/lib/stripe-client";
import { cn } from "@/lib/utils";

type Card = Awaited<ReturnType<ReturnType<typeof useAction<typeof api.payments.listPaymentMethods>>>>[number];

const STATUS_STYLE: Record<string, string> = {
  paid: "bg-emerald-500/15 text-emerald-500",
  refunded: "bg-amber-500/15 text-amber-500",
  failed: "bg-destructive/15 text-destructive",
};

// --- Payment methods -------------------------------------------------------------------

function PaymentMethods() {
  const list = useAction(api.payments.listPaymentMethods);
  const remove = useAction(api.payments.removePaymentMethod);
  const makeDefault = useAction(api.payments.setDefaultPaymentMethod);

  const [cards, setCards] = useState<Card[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Card | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setCards(await list({}));
    } catch (e) {
      setCards([]);
      toast.error(errorMessage(e, "Couldn't load your cards."));
    }
  }, [list]);

  useEffect(() => {
    if (paymentsConfigured) void refresh();
    else setCards([]);
  }, [refresh]);

  const act = async (id: string, work: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try {
      await work();
      toast.success(done);
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsGroup title="Payment methods">
      {cards === null ? (
        <SettingsCard className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </SettingsCard>
      ) : (
        cards.map((card) => (
          <SettingsCard key={card.id} className="flex items-center gap-4 px-4 py-3">
            <CardBrandIcon brand={card.brand} className="size-8 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                {brandLabel(card.brand)} •••• {card.last4}
                {card.isDefault && <Badge variant="secondary">Default</Badge>}
              </p>
              <p className="text-xs text-muted-foreground">
                Expires {String(card.expMonth).padStart(2, "0")}/{card.expYear}
              </p>
            </div>
            {busy === card.id && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="Card options" disabled={busy === card.id}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!card.isDefault && (
                  <DropdownMenuItem
                    onClick={() =>
                      void act(card.id, () => makeDefault({ paymentMethodId: card.id }), "Default card updated.")
                    }
                  >
                    <Star /> Make default
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="text-destructive" onClick={() => setRemoving(card)}>
                  <Trash2 /> Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SettingsCard>
        ))
      )}
      {cards?.length === 0 && (
        <SettingsCard className="px-4 py-5 text-sm text-muted-foreground">
          {paymentsConfigured ? "You haven't saved a card yet." : "Payments aren't set up in this build of Crystal."}
        </SettingsCard>
      )}
      {paymentsConfigured && (
        <SettingRow icon={Plus} title="Add a payment method" description="Saved cards are used for subscriptions and quick checkout.">
          <Button size="sm" onClick={() => setAdding(true)}>
            Add card
          </Button>
        </SettingRow>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a payment method</DialogTitle>
            <DialogDescription>Your card details go straight to Stripe — Crystal never sees them.</DialogDescription>
          </DialogHeader>
          {adding && (
            <PaymentMethodForm
              onCancel={() => setAdding(false)}
              onDone={() => {
                setAdding(false);
                toast.success("Card saved.");
                // Stripe attaches it a moment after confirming.
                setTimeout(() => void refresh(), 800);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this card?</DialogTitle>
            <DialogDescription>
              {removing && `${brandLabel(removing.brand)} ending ${removing.last4} will be removed.`} If it pays for a
              subscription, add another card first or the next renewal will fail.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const card = removing;
                setRemoving(null);
                if (card) void act(card.id, () => remove({ paymentMethodId: card.id }), "Card removed.");
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsGroup>
  );
}

// --- Order history ---------------------------------------------------------------------

function OrderHistory() {
  const orders = useQuery(api.marketplace.myOrders);
  const receiptUrl = useAction(api.payments.receiptUrl);
  const [busy, setBusy] = useState<Id<"orders"> | null>(null);

  const openReceipt = async (orderId: Id<"orders">) => {
    setBusy(orderId);
    try {
      const url = await receiptUrl({ orderId });
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else toast.info("There's no receipt for that order.");
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't open that receipt."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsGroup title="Order history">
      {orders === undefined ? null : orders.length === 0 ? (
        <SettingsCard className="px-4 py-5 text-sm text-muted-foreground">Nothing bought yet.</SettingsCard>
      ) : (
        orders.map((order) => (
          <SettingsCard key={order.id} className="flex items-center gap-4 px-4 py-3">
            <Receipt className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {order.skuName}
                {order.isSubscription && <span className="ml-2 text-xs font-normal text-muted-foreground">Subscription</span>}
              </p>
              <p className="text-xs text-muted-foreground">{formatDate(order.paidAt ?? order.createdAt)}</p>
            </div>
            <span className={cn("rounded-full px-2 py-0.5 text-xs capitalize", STATUS_STYLE[order.status])}>
              {order.status}
            </span>
            <span className="w-20 text-right text-sm font-medium tabular-nums">
              {formatMoney(order.amountCents, order.currency, { free: true })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy === order.id || order.amountCents === 0}
              onClick={() => void openReceipt(order.id)}
            >
              {busy === order.id ? <Loader2 className="animate-spin" /> : "Receipt"}
            </Button>
          </SettingsCard>
        ))
      )}
    </SettingsGroup>
  );
}

// --- Help -----------------------------------------------------------------------------------

const CATEGORIES = [
  ["billing", "A payment or refund"],
  ["account", "My account"],
  ["community", "A community"],
  ["technical", "Something's broken"],
  ["other", "Something else"],
] as const;

function SupportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useMutation(api.support.create);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number][0]>("billing");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      await create({ category, subject, body });
      toast.success("Sent. We'll reply here.");
      setSubject("");
      setBody("");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't send that."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Contact support</DialogTitle>
          <DialogDescription>Tell us what happened. A person will read it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={category} onValueChange={(v) => setCategory(v as typeof category)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input placeholder="Subject" value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} />
          <Textarea
            placeholder="What's going on? Include the item or date if it's about a payment."
            value={body}
            maxLength={4000}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-32"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || subject.trim().length < 3 || !body.trim()} onClick={() => void send()}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />} Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TicketDialog({ ticketId, onClose }: { ticketId: Id<"supportTickets"> | null; onClose: () => void }) {
  const thread = useQuery(api.support.get, ticketId ? { ticketId } : "skip");
  const reply = useMutation(api.support.reply);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!ticketId) return;
    setBusy(true);
    try {
      await reply({ ticketId, body: text });
      setText("");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!ticketId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{thread?.ticket.subject ?? "Ticket"}</DialogTitle>
          <DialogDescription className="capitalize">{thread?.ticket.status.replace(/_/g, " ")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
          {thread?.messages.map((m) => (
            <div key={m.id} className={cn("max-w-[85%] rounded-xl px-3 py-2 text-sm", m.fromStaff ? "bg-foreground/10" : "ml-auto bg-primary/15")}>
              <p className="mb-0.5 text-xs font-medium text-muted-foreground">
                {m.author} · {formatRelative(m.createdAt)}
              </p>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </div>
          ))}
        </div>
        {thread?.ticket.status !== "closed" && (
          <div className="flex gap-2">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply…" className="min-h-10" />
            <Button disabled={busy || !text.trim()} onClick={() => void send()}>
              <Send />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Help() {
  const tickets = useQuery(api.support.mine);
  const [composing, setComposing] = useState(false);
  const [open, setOpen] = useState<Id<"supportTickets"> | null>(null);

  return (
    <SettingsGroup title="Help with a payment">
      <SettingRow icon={LifeBuoy} title="Contact support" description="Charged twice, something didn't arrive, or you'd like a refund?">
        <Button size="sm" variant="outline" onClick={() => setComposing(true)}>
          New request
        </Button>
      </SettingRow>
      {tickets?.slice(0, 5).map((t) => (
        <button key={t._id} type="button" onClick={() => setOpen(t._id)} className="text-left">
          <SettingsCard className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-foreground/5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{t.subject}</p>
              <p className="text-xs text-muted-foreground">Updated {formatRelative(t.updatedAt)}</p>
            </div>
            <Badge variant={t.status === "waiting_on_user" ? "default" : "outline"} className="capitalize">
              {t.status === "waiting_on_user" ? "Reply needed" : t.status.replace(/_/g, " ")}
            </Badge>
          </SettingsCard>
        </button>
      ))}
      <SupportDialog open={composing} onOpenChange={setComposing} />
      <TicketDialog ticketId={open} onClose={() => setOpen(null)} />
    </SettingsGroup>
  );
}

export function BillingTab() {
  return (
    <div className="space-y-8">
      <PaymentMethods />
      <OrderHistory />
      <Help />
    </div>
  );
}


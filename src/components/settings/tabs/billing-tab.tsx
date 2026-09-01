"use client";

import { useCallback, useEffect, useState } from "react";

import { useAction } from "convex/react";
import { ChevronDown, Info, Loader2, Receipt } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { AddPaymentMethodDialog } from "../dialog/add-payment-method-dialog";
import {
  CardBrandIcon,
  brandLabel,
  formatMoney,
  monthName,
  regionName,
} from "./billing-shared";

type PaymentMethod = {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  country: string | null;
  isDefault: boolean;
  isSubscription: boolean;
  isExpired: boolean;
};

type Transaction = {
  id: string;
  number: string | null;
  date: number;
  description: string;
  amount: number;
  currency: string;
  status: string;
  paid: boolean;
  failed: boolean;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  lines: { description: string; amount: number; currency: string }[];
};

function Spinner() {
  return (
    <div className="flex items-center justify-center py-10 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

export function BillingTab() {
  const getPaymentMethods = useAction(api.stripe.getPaymentMethods);
  const getTransactions = useAction(api.stripe.getTransactions);
  const setDefaultPaymentMethod = useAction(api.stripe.setDefaultPaymentMethod);
  const removePaymentMethod = useAction(api.stripe.removePaymentMethod);

  const [country, setCountry] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pmDialogOpen, setPmDialogOpen] = useState(false);

  const load = useCallback(async () => {
    const [pm, tx] = await Promise.all([getPaymentMethods(), getTransactions()]);
    setCountry(pm.country);
    setPaymentMethods(pm.methods);
    setTransactions(tx);
  }, [getPaymentMethods, getTransactions]);

  useEffect(() => {
    load()
      .catch(() => toast.error("Couldn't load your billing details."))
      .finally(() => setLoading(false));
  }, [load]);

  async function handleSetDefault(id: string) {
    setBusyId(id);
    try {
      await setDefaultPaymentMethod({ paymentMethodId: id });
      await load();
      toast.success("Default payment method updated.");
    } catch {
      toast.error("Couldn't update the default payment method.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(id: string) {
    setBusyId(id);
    try {
      await removePaymentMethod({ paymentMethodId: id });
      await load();
      toast.success("Payment method removed.");
    } catch {
      toast.error("Couldn't remove that payment method.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="w-4xl space-y-10">
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Payment Methods</h2>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            Country/Region: {regionName(country) ?? "Not set"}
            <Info className="size-3.5" />
          </p>
        </div>

        {loading ? (
          <Spinner />
        ) : (
          <div className="divide-y rounded-xl border">
            {paymentMethods.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                You don&apos;t have any saved payment methods yet.
              </p>
            )}
            {paymentMethods.map((pm) => (
              <div
                key={pm.id}
                className="flex items-center justify-between gap-3 p-4"
              >
                <div className="flex items-center gap-3">
                  <CardBrandIcon brand={pm.brand} className="size-7" />
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">
                        {brandLabel(pm.brand)} ending in {pm.last4}
                      </span>
                      {pm.isDefault && (
                        <Badge
                          variant="secondary"
                          className="px-1.5 py-0 text-[10px] uppercase"
                        >
                          Default
                        </Badge>
                      )}
                      {pm.isExpired && (
                        <Badge
                          variant="destructive"
                          className="px-1.5 py-0 text-[10px] uppercase"
                        >
                          Invalid
                        </Badge>
                      )}
                      {pm.isSubscription && (
                        <Badge className="px-1.5 py-0 text-[10px] uppercase">
                          Subscription
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Expires {monthName(pm.expMonth)} {pm.expYear}
                    </p>
                  </div>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm" disabled={busyId === pm.id}>
                      {busyId === pm.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        "Edit"
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={pm.isDefault}
                      onClick={() => handleSetDefault(pm.id)}
                    >
                      Set as default
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => handleRemove(pm.id)}
                    >
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <Button onClick={() => setPmDialogOpen(true)}>Add Payment Method</Button>
        </div>
      </section>

      <Separator />

      <section className="space-y-4 w-full">
        <h2 className="text-lg font-semibold">Transaction History</h2>

        {loading ? (
          <Spinner />
        ) : transactions.length === 0 ? (
          <div className="rounded-xl border p-4 text-sm text-muted-foreground">
            You don&apos;t have any transactions yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TransactionRow key={tx.id} tx={tx} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <AddPaymentMethodDialog
        open={pmDialogOpen}
        onOpenChange={() => {
          const next = !pmDialogOpen;
          setPmDialogOpen(next);
          // Refresh the list when the dialog closes — a card may have been added.
          if (!next) void load();
        }}
      />
      <Toaster position="bottom-center" />
    </div>
  );
}

function TransactionRow({ tx }: { tx: Transaction }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <TableCell className="text-muted-foreground">
          {new Date(tx.date * 1000).toLocaleDateString("en-US", {
            month: "2-digit",
            day: "2-digit",
            year: "numeric",
          })}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <span className="flex size-5 items-center justify-center rounded bg-primary/15 text-primary">
              <Receipt className="size-3" />
            </span>
            <span className="font-medium">{tx.description}</span>
            {tx.failed && (
              <Badge
                variant="destructive"
                className="px-1.5 py-0 text-[10px] uppercase"
              >
                Failed
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="text-right font-medium">
          {formatMoney(tx.amount, tx.currency)}
        </TableCell>
        <TableCell>
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={4} className="whitespace-normal">
            <div className="space-y-2 py-1 text-xs text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Status</span>
                <span className="capitalize text-foreground">{tx.status}</span>
              </div>
              {tx.number && (
                <div className="flex items-center justify-between">
                  <span>Invoice</span>
                  <span className="text-foreground">{tx.number}</span>
                </div>
              )}
              {tx.lines.map((line, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span>{line.description}</span>
                  <span className="text-foreground">
                    {formatMoney(line.amount, line.currency)}
                  </span>
                </div>
              ))}
              {tx.hostedInvoiceUrl && (
                <a
                  href={tx.hostedInvoiceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  View invoice
                </a>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

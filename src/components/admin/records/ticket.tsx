"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { EyeOff, Inbox, Loader2, Send } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, EntityLink, Fields, Loading, Panel, ReasonDialog, StatusPill, useRun, useStaff, type Tone } from "@/components/admin/admin-ui";
import { useConsole } from "@/components/admin/console-state";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatRelative } from "@/lib/money";
import { cn } from "@/lib/utils";

const STATUSES = ["open", "in_progress", "waiting_on_user", "resolved", "closed"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const TONE: Record<string, Tone> = { open: "warn", in_progress: "info", waiting_on_user: "neutral", resolved: "good", closed: "neutral" };
const pretty = (value: string) => value.replace(/_/g, " ");

export function TicketRecord({ id }: { id: string }) {
  const staff = useStaff();
  const { retitle } = useConsole();
  const ticketId = id as Id<"supportTickets">;
  const detail = useQuery(api.support.adminGet, { ticketId });
  const reply = useMutation(api.support.adminReply);
  const setStatus = useMutation(api.support.adminSetStatus);
  const assign = useMutation(api.support.adminAssign);
  const { run, busy } = useRun();
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [emailThem, setEmailThem] = useState(true);
  const [finishing, setFinishing] = useState<"resolved" | "closed" | null>(null);

  const ticket = detail?.ticket;
  const customer = useQuery(api.operations.userDetail, ticket && staff.can("users.read") ? { userId: ticket.userId } : "skip");

  useEffect(() => {
    if (ticket) retitle({ kind: "ticket", id }, ticket.subject, customer ? `@${customer.user.username}` : undefined);
  }, [ticket, customer, id, retitle]);

  if (detail === undefined) return <Loading />;
  if (detail === null || !ticket) return <EmptyState icon={Inbox} title="That ticket no longer exists" />;
  const act = staff.can("support.act");
  const mine = ticket.assignedTo === staff.userId;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        <header className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{ticket.subject}</h1>
            <StatusPill tone={TONE[ticket.status]}>{pretty(ticket.status)}</StatusPill>
            {(ticket.priority === "high" || ticket.priority === "urgent") && <StatusPill tone="bad">{ticket.priority}</StatusPill>}
          </div>
          <p className="text-sm text-muted-foreground">
            {pretty(ticket.category)} · opened {formatDate(ticket.createdAt, true)}
            {detail.openedBy && ` · opened by @${detail.openedBy} on their behalf`}
          </p>
        </header>

        <div className="space-y-3">
          {detail.messages.map((m) => {
            const fromCustomer = m.authorId === ticket.userId;
            return (
              <div key={m._id} className={cn("flex", fromCustomer ? "justify-start" : "justify-end")}>
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-2.5",
                    m.internal ? "border border-amber-500/30 bg-amber-500/10" : fromCustomer ? "bg-foreground/10" : "bg-primary/15",
                  )}
                >
                  <p className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    {m.internal && <EyeOff className="size-3 text-amber-500" />}
                    @{m.author}
                    {m.internal && " · internal note"} · {formatRelative(m.createdAt)}
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{m.body}</p>
                </div>
              </div>
            );
          })}
        </div>

        {act && (
          <Panel>
            <div className="space-y-3">
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={internal ? "Write a note only staff will see…" : "Reply to the customer…"}
                className={cn("min-h-24", internal && "border-amber-500/40")}
                maxLength={4000}
              />
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                    Internal note — the customer won&apos;t see it
                  </label>
                  {!internal && (
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <input type="checkbox" checked={emailThem} onChange={(e) => setEmailThem(e.target.checked)} />
                      Email them this reply
                    </label>
                  )}
                </div>
                <Button
                  disabled={!text.trim() || busy === "reply"}
                  onClick={() => void run("reply", () => reply({ ticketId, body: text, internal, email: emailThem }), internal ? "Note added." : "Sent.").then(() => setText(""))}
                >
                  {busy === "reply" ? <Loader2 className="animate-spin" /> : <Send />} {internal ? "Add note" : "Send reply"}
                </Button>
              </div>
            </div>
          </Panel>
        )}
      </div>

      <aside className="space-y-5">
        <Panel title="Ticket">
          <div className="space-y-3">
            <Select
              value={ticket.status}
              disabled={!act}
              onValueChange={(status) => {
                const next = status as (typeof STATUSES)[number];
                if (next === "resolved" || next === "closed") {
                  if (ticket.status !== next || !ticket.closureNote) setFinishing(next);
                  else void run("status", () => setStatus({ ticketId, status: next }));
                } else {
                  void run("status", () => setStatus({ ticketId, status: next }));
                }
              }}
            >
              <SelectTrigger className="w-full capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">
                    {pretty(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={ticket.priority}
              disabled={!act}
              onValueChange={(priority) => void run("priority", () => setStatus({ ticketId, status: ticket.status, priority: priority as (typeof PRIORITIES)[number] }))}
            >
              <SelectTrigger className="w-full capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p} className="capitalize">
                    {p} priority
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {ticket.closureNote && (
              <div className="rounded-lg bg-foreground/5 px-3 py-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Closure reason{ticket.resolvedAt ? ` · ${formatDate(ticket.resolvedAt, true)}` : ""}
                  {detail.resolvedBy ? ` · by @${detail.resolvedBy}` : ""}
                </p>
                <p className="mt-0.5 text-sm whitespace-pre-wrap">{ticket.closureNote}</p>
              </div>
            )}
            {act && (
              <Button
                variant="outline"
                className="w-full"
                disabled={busy === "assign"}
                onClick={() => void run("assign", () => assign({ ticketId, assigneeId: mine ? undefined : (staff.userId as Id<"users">) }), mine ? "Unassigned." : "Assigned to you.")}
              >
                {mine ? "Unassign me" : ticket.assignedTo ? "Take over" : "Assign to me"}
              </Button>
            )}
          </div>
        </Panel>

        {detail.emails.length > 0 && (
          <Panel title="Emails sent" description="What went to the customer about this ticket." flush>
            <div className="divide-y divide-foreground/10">
              {detail.emails.map((e) => (
                <div key={e.id} className="space-y-0.5 px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{e.subject}</span>
                    <StatusPill tone={e.status === "sent" ? "good" : e.status === "failed" ? "bad" : "neutral"}>{e.status}</StatusPill>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatRelative(e.createdAt)}
                    {e.detail ? ` · ${e.detail}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        )}

        <Panel title="Customer">
          {customer ? (
            <Fields
              items={[
                ["Account", <EntityLink key="u" entity={{ kind: "user", id: ticket.userId, title: customer.user.name, subtitle: `@${customer.user.username}` }}>@{customer.user.username}</EntityLink>],
                ["Joined", formatDate(customer.user.joinedAt)],
                ["Purchases", customer.orderCount],
                ["Standing", customer.suspension ? <StatusPill key="s" tone="bad">Suspended</StatusPill> : "Good"],
              ]}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{staff.can("users.read") ? "Loading…" : "You can't view accounts."}</p>
          )}
        </Panel>
      </aside>

      <ReasonDialog
        open={!!finishing}
        onOpenChange={(open) => !open && setFinishing(null)}
        title={finishing === "resolved" ? "Resolve this ticket" : "Close this ticket"}
        description="Shown to the customer under Settings → Support, and emailed to them. Say why it ended."
        confirmLabel={finishing === "resolved" ? "Resolve" : "Close"}
        placeholder="Why this is closed (shown to the customer)"
        onConfirm={(closureNote) =>
          run("status", () => setStatus({ ticketId, status: finishing!, closureNote })).then(() => setFinishing(null))
        }
      />
    </div>
  );
}

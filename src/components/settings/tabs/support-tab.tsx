"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, LifeBuoy, Loader2, Plus, Send } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmailUpdatesToggle } from "@/components/settings/email-updates-toggle";
import { SettingsCard } from "@/components/settings/settings-ui";
import { SupportDialog } from "@/components/settings/tabs/billing-tab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/errors";
import { formatRelative } from "@/lib/money";
import { cn } from "@/lib/utils";

const pretty = (value: string) => value.replace(/_/g, " ");

/** How a ticket's state reads to the person who opened it. */
const STATUS: Record<string, { label: string; tone: "default" | "secondary" | "outline" }> = {
  open: { label: "Waiting for us", tone: "secondary" },
  in_progress: { label: "We're on it", tone: "secondary" },
  waiting_on_user: { label: "Reply needed", tone: "default" },
  resolved: { label: "Resolved", tone: "outline" },
  closed: { label: "Closed", tone: "outline" },
};

const CATEGORY: Record<string, string> = {
  billing: "A payment or refund",
  account: "My account",
  community: "A community",
  technical: "Something's broken",
  other: "Something else",
};

/**
 * Settings → Support: the requests you have made, and the conversation on each. The layout of the
 * console's inbox — a list and the thread beside it — in the customer's words, with none of staff's
 * side of it (priority, who it is assigned to, internal notes).
 */
export function SupportTab() {
  const tickets = useQuery(api.support.mine);
  const [composing, setComposing] = useState(false);
  const [picked, setPicked] = useState<Id<"supportTickets"> | null>(null);

  // Something is always open when there is anything to open: the newest, until one is chosen.
  const selected = picked && tickets?.some((t) => t._id === picked) ? picked : (tickets?.[0]?._id ?? null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">A person reads every request. Replies appear here.</p>
        <Button size="sm" onClick={() => setComposing(true)}>
          <Plus /> New request
        </Button>
      </div>
      <EmailUpdatesToggle what="support replies to your requests" />

      {tickets === undefined ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : tickets.length === 0 ? (
        <SettingsCard className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <LifeBuoy className="size-8 text-muted-foreground" />
          <p className="font-medium">No requests yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">Something wrong with your account, a payment or a community? Send a request and we&apos;ll reply here.</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => setComposing(true)}>
            Contact support
          </Button>
        </SettingsCard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="space-y-1.5">
            {tickets.map((t) => (
              <button key={t._id} type="button" onClick={() => setPicked(t._id)} className="block w-full text-left">
                <SettingsCard className={cn("space-y-1 px-3 py-2.5 transition-colors hover:bg-foreground/5", selected === t._id && "bg-foreground/10")}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 text-sm font-medium">{t.subject}</p>
                    {t.unread && <span aria-label="New reply" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={STATUS[t.status]?.tone ?? "outline"}>{STATUS[t.status]?.label ?? pretty(t.status)}</Badge>
                    <span className="text-xs text-muted-foreground">{formatRelative(t.updatedAt)}</span>
                  </div>
                </SettingsCard>
              </button>
            ))}
          </div>
          {selected && <Thread key={selected} ticketId={selected} />}
        </div>
      )}

      <SupportDialog open={composing} onOpenChange={setComposing} />
    </div>
  );
}

function Thread({ ticketId }: { ticketId: Id<"supportTickets"> }) {
  const thread = useQuery(api.support.get, { ticketId });
  const reply = useMutation(api.support.reply);
  const markRead = useMutation(api.support.markRead);
  const closeMine = useMutation(api.support.closeMine);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const unreadFrom = thread?.messages.length ?? 0;
  // Opening the thread (and new replies arriving while it is open) is reading them.
  useEffect(() => {
    if (unreadFrom > 0) void markRead({ ticketId }).catch(() => {});
  }, [ticketId, unreadFrom, markRead]);

  if (thread === undefined) {
    return (
      <SettingsCard className="flex justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </SettingsCard>
    );
  }
  if (thread === null) return <SettingsCard className="px-4 py-8 text-center text-sm text-muted-foreground">That request isn&apos;t available.</SettingsCard>;

  const { ticket } = thread;
  const closed = ticket.status === "closed";

  const send = async () => {
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
    <SettingsCard className="flex min-w-0 flex-col gap-4 p-5">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{ticket.subject}</h2>
          <Badge variant={STATUS[ticket.status]?.tone ?? "outline"}>{STATUS[ticket.status]?.label ?? pretty(ticket.status)}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {CATEGORY[ticket.category] ?? pretty(ticket.category)} · opened {formatRelative(ticket.createdAt)}
          {ticket.onBehalf && " · started by Crystal support for you"}
        </p>
      </header>

      <div className="space-y-3">
        {thread.messages.map((m) => (
          <div key={m.id} className={cn("max-w-[85%] rounded-2xl px-4 py-2.5", m.fromStaff ? "bg-foreground/10" : "ml-auto bg-primary/15")}>
            <p className="mb-0.5 text-xs font-medium text-muted-foreground">
              {m.author} · {formatRelative(m.createdAt)}
            </p>
            <p className="text-sm whitespace-pre-wrap">{m.body}</p>
          </div>
        ))}
      </div>

      {(ticket.status === "resolved" || ticket.status === "closed") && ticket.closureNote && (
        <section className="space-y-1 rounded-lg bg-foreground/5 px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground">
            Why it was {ticket.status === "resolved" ? "resolved" : "closed"}
            {ticket.resolvedAt ? ` · ${formatRelative(ticket.resolvedAt)}` : ""}
          </p>
          <p className="text-sm whitespace-pre-wrap">{ticket.closureNote}</p>
        </section>
      )}

      {closed ? (
        <p className="rounded-lg bg-foreground/5 px-3 py-2 text-sm text-muted-foreground">This request is closed. If you still need help, send a new one.</p>
      ) : (
        <div className="space-y-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a reply…" className="min-h-20" maxLength={4000} />
          <div className="flex items-center justify-between gap-2">
            {ticket.status === "resolved" ? (
              <span className="text-xs text-muted-foreground">Marked resolved. Replying reopens it.</span>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => void closeMine({ ticketId }).catch((e) => toast.error(errorMessage(e)))}>
                <CheckCircle2 /> This is sorted
              </Button>
            )}
            <Button disabled={busy || !text.trim()} onClick={() => void send()}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />} Send
            </Button>
          </div>
        </div>
      )}
    </SettingsCard>
  );
}

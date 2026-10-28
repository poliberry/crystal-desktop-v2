"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Mail, Search, Send, TicketPlus, X } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ListRow, Person, StatusPill, useRun, type Tone } from "@/components/admin/admin-ui";
import { useOpenEntity } from "@/components/admin/console-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatRelative } from "@/lib/money";

/** A value that only follows the input once it has stopped changing. */
function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export type PickedUser = { id: Id<"users">; username: string; name: string; imageUrl?: string };

/** Find an account by name or @username and pick it. */
export function UserPicker({ value, onChange }: { value: PickedUser | null; onChange: (user: PickedUser | null) => void }) {
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const results = useQuery(api.operations.users, debounced.trim().length > 1 ? { search: debounced } : "skip");

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg bg-foreground/5 px-3 py-2">
        <Person user={value} />
        <Button size="icon" variant="ghost" className="size-7" onClick={() => onChange(null)}>
          <X />
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a person" className="pl-9" />
      </div>
      {results && results.length > 0 && (
        <div className="max-h-48 divide-y divide-foreground/10 overflow-y-auto rounded-lg border border-foreground/10">
          {results.slice(0, 8).map((u) => (
            <ListRow key={u.id} onOpen={() => onChange({ id: u.id, username: u.username, name: u.name, imageUrl: u.imageUrl })}>
              <Person user={u} />
            </ListRow>
          ))}
        </div>
      )}
    </div>
  );
}

const CATEGORIES = [
  ["account", "Account"],
  ["billing", "Billing"],
  ["community", "Community"],
  ["technical", "Technical"],
  ["other", "Other"],
] as const;

/** Open a support ticket for someone who asked some other way. They see it, and can answer it, under Settings → Support. */
export function CreateTicketDialog({
  open,
  onOpenChange,
  presetUser,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetUser?: PickedUser;
}) {
  const create = useMutation(api.support.adminCreate);
  const openEntity = useOpenEntity();
  const { run, busy } = useRun();
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const user = presetUser ?? picked;
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number][0]>("account");
  const [body, setBody] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [email, setEmail] = useState(true);
  const reach = useQuery(api.staffEmail.status, user ? { userId: user.id } : "skip");

  const ready = !!user && subject.trim().length >= 3 && body.trim().length > 0;

  const submit = async () => {
    if (!user) return;
    const ticketId = await run("create", () => create({ userId: user.id, subject, category, body, internalNote: internalNote || undefined, email }), "Ticket opened.");
    if (!ticketId) return;
    setSubject("");
    setBody("");
    setInternalNote("");
    setPicked(null);
    onOpenChange(false);
    openEntity({ kind: "ticket", id: ticketId, title: subject.trim(), subtitle: `@${user.username}` });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => busy !== "create" && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Open a ticket for someone</DialogTitle>
          <DialogDescription>For when they wrote in some other way. They&apos;ll see it under Settings → Support and can reply there.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!presetUser && <UserPicker value={picked} onChange={setPicked} />}
          <div className="flex gap-2">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" maxLength={120} />
            <Select value={category} onValueChange={(v) => setCategory(v as typeof category)}>
              <SelectTrigger className="w-36 shrink-0">
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
          </div>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Your first message to them" className="min-h-28" maxLength={4000} />
          <Textarea value={internalNote} onChange={(e) => setInternalNote(e.target.value)} placeholder="Internal note (optional) — only staff see this" className="min-h-16 border-amber-500/40" maxLength={4000} />
          <label className="flex items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={email} onCheckedChange={(c) => setEmail(c === true)} />
            <span>
              Also email them
              {user && reach && !reach.configured && <span className="block text-xs text-amber-500">Email isn&apos;t set up on this deployment, so nothing will be sent.</span>}
              {user && reach?.configured && !reach.reachable && <span className="block text-xs text-amber-500">They have no verified email address; they&apos;ll only see it in the app.</span>}
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy === "create"}>
            Cancel
          </Button>
          <Button disabled={!ready || busy === "create"} onClick={() => void submit()}>
            {busy === "create" ? <Loader2 className="animate-spin" /> : <TicketPlus />} Open ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Write to someone directly. Goes out from the sender address, and is kept in their email history. */
export function EmailUserDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { id: Id<"users">; username: string };
}) {
  const send = useMutation(api.staffEmail.send);
  const reach = useQuery(api.staffEmail.status, open ? { userId: user.id } : "skip");
  const { run, busy } = useRun();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const blocked = reach ? !reach.configured || !reach.reachable : false;

  const submit = async () => {
    const done = await run("email", () => send({ userId: user.id, subject, body }), "Queued. It's sent in the background — see the Emails tab for how it went.");
    if (done === undefined) return;
    setSubject("");
    setBody("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => busy !== "email" && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Email @{user.username}</DialogTitle>
          <DialogDescription>Sent to their verified address. It&apos;s recorded in the audit log and their email history.</DialogDescription>
        </DialogHeader>
        {reach && !reach.configured && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-500">Email isn&apos;t set up on this deployment (RESEND_API_KEY and AUTH_EMAIL_FROM).</p>
        )}
        {reach?.configured && !reach.reachable && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-500">This account has no verified email address.</p>
        )}
        <div className="space-y-3">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" maxLength={150} />
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message" className="min-h-40" maxLength={5000} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy === "email"}>
            Cancel
          </Button>
          <Button disabled={blocked || subject.trim().length < 3 || !body.trim() || busy === "email"} onClick={() => void submit()}>
            {busy === "email" ? <Loader2 className="animate-spin" /> : <Send />} Send email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const EMAIL_TONE: Record<string, Tone> = { sent: "good", queued: "info", skipped: "neutral", failed: "bad" };
const KIND_LABEL: Record<string, string> = {
  ticket_opened: "Ticket opened",
  ticket_reply: "Ticket reply",
  ticket_resolved: "Ticket resolved",
  report_update: "Report update",
  report_closed: "Report closed",
  direct: "Direct email",
};

/** What was sent to this person lately, and whether it arrived. */
export function EmailHistory({ userId }: { userId: Id<"users"> }) {
  const rows = useQuery(api.staffEmail.listForUser, { userId });
  if (rows === undefined) return <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) return <p className="px-4 py-6 text-sm text-muted-foreground">Nothing has been emailed to them.</p>;
  return (
    <div className="divide-y divide-foreground/10">
      {rows.map((row) => (
        <div key={row.id} className="space-y-1 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Mail className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-medium">{row.subject}</span>
            <StatusPill>{KIND_LABEL[row.kind] ?? row.kind}</StatusPill>
            <StatusPill tone={EMAIL_TONE[row.status]}>{row.status}</StatusPill>
            <span className="text-xs text-muted-foreground">{formatRelative(row.createdAt)}</span>
          </div>
          <p className="line-clamp-2 text-xs whitespace-pre-wrap text-muted-foreground">{row.body}</p>
          {row.detail && <p className="text-xs text-muted-foreground">{row.detail}</p>}
          {row.sentBy && <p className="text-xs text-muted-foreground">by @{row.sentBy}</p>}
        </div>
      ))}
    </div>
  );
}

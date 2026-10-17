"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Forward, LoaderCircle, Search } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useNavigation } from "@/components/home/navigation-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOutboxMutation } from "@/hooks/use-outbox-mutation";
import { toast } from "sonner";

type ForwardAttachment = { fileName: string };
type ConversationChoice = {
  id: Id<"conversations">;
  name?: string;
  imageUrl?: string;
  members: { name: string; username: string; imageUrl?: string }[];
};

function summaryText(text: string, attachments: ForwardAttachment[]): string {
  const body = text.trim() || "[Attachment]";
  const files = attachments.length ? `\n\nAttachments: ${attachments.map((item) => item.fileName).join(", ")}` : "";
  return body.length > 3000 ? `${body.slice(0, 2999)}…${files}` : `${body}${files}`;
}

export function MessageForwardDialog({
  open,
  onOpenChange,
  authorName,
  text,
  attachments,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authorName: string;
  text: string;
  attachments: ForwardAttachment[];
}) {
  const conversations = useQuery(api.conversations.listMine, {}) as ConversationChoice[] | undefined;
  const send = useOutboxMutation("send", "dm");
  const nav = useNavigation();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Id<"conversations"> | null>(null);
  const [sending, setSending] = useState(false);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (conversations ?? []).filter((conversation) => {
      const label = conversation.name || conversation.members.map((member) => member.name).join(", ") || "Direct message";
      return !needle || label.toLocaleLowerCase().includes(needle) || conversation.members.some((member) => member.username.toLocaleLowerCase().includes(needle));
    });
  }, [conversations, query]);

  const forward = async () => {
    if (!selected || sending) return;
    setSending(true);
    try {
      await send({ conversationId: selected, text: `↪ Forwarded from ${authorName}:\n${summaryText(text, attachments)}` });
      onOpenChange(false);
      nav.openConversation(selected);
      setSelected(null);
      setQuery("");
      toast.success("Message forwarded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not forward message");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) { setSelected(null); setQuery(""); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Forward message</DialogTitle>
          <DialogDescription>Choose a direct message to send this message to.</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <p className="mb-1 text-xs font-medium text-muted-foreground">From {authorName}</p>
          <p className="line-clamp-3 whitespace-pre-wrap break-words">{text || (attachments.length ? `Attachment: ${attachments.map((item) => item.fileName).join(", ")}` : "Message")}</p>
          {attachments.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Attachment files are referenced by name in the forwarded message.</p>}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a conversation" className="pl-9" />
        </div>
        <ScrollArea className="max-h-64 rounded-md border">
          <div className="p-1">
            {conversations === undefined ? <p className="p-4 text-center text-sm text-muted-foreground">Loading conversations…</p>
              : filtered.length === 0 ? <p className="p-4 text-center text-sm text-muted-foreground">No matching conversations.</p>
                : filtered.map((conversation) => {
                  const name = conversation.name || conversation.members.map((member) => member.name).join(", ") || "Direct message";
                  const chosen = selected === conversation.id;
                  return (
                    <button key={conversation.id} type="button" onClick={() => setSelected(conversation.id)} aria-pressed={chosen} className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left ${chosen ? "bg-accent" : "hover:bg-accent/60"}`}>
                      <Avatar className="size-8"><AvatarImage src={conversation.imageUrl || conversation.members[0]?.imageUrl || undefined} /><AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                      {chosen && <span className="text-xs text-primary">Selected</span>}
                    </button>
                  );
                })}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void forward()} disabled={!selected || sending}>
            {sending ? <LoaderCircle className="size-4 animate-spin" /> : <Forward className="size-4" />}
            Forward
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

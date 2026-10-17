"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AlarmClock, AlarmClockOff, Bookmark, BookmarkMinus, ExternalLink, Lock, Paperclip } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Spinner } from "@/components/auth/auth-ui";
import { useNavigation } from "@/components/home/navigation-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMessageContent } from "@/hooks/use-message-content";
import type { Room } from "@/lib/e2ee";
import { openE2eeSetup } from "@/lib/e2ee-onboarding";
import { formatDateTime } from "@/lib/locale";
import { describeReminder, reminderPresets } from "@/lib/reminder-presets";
import { revealMessage } from "@/lib/reveal-message";
import { cn } from "@/lib/utils";

type SavedItem = FunctionReturnType<typeof api.savedMessages.list>[number];

/**
 * Everything you saved for yourself, with reminders on top. Bodies are decrypted here, on this device,
 * with the room keys the app already holds; the server only ever handed over ciphertext.
 */
export function SavedMessagesDialog({
  open,
  onOpenChange,
  focusKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A saved message to scroll to (its message id). */
  focusKey?: string | null;
}) {
  const items = useQuery(api.savedMessages.list, open ? {} : "skip");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [open]);

  const { reminders, rest } = useMemo(() => {
    const all = items ?? [];
    const withReminder = all
      .filter((item) => item.remindAt !== null && item.remindedAt === null)
      .sort((a, b) => (a.remindAt ?? 0) - (b.remindAt ?? 0));
    const set = new Set(withReminder.map((item) => item.id));
    return { reminders: withReminder, rest: all.filter((item) => !set.has(item.id)) };
  }, [items]);

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !focusKey || !items) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-saved-key="${CSS.escape(focusKey)}"]`);
    row?.scrollIntoView({ block: "nearest" });
    row?.focus();
  }, [open, focusKey, items]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Bookmark className="size-4" />
            Saved messages
          </DialogTitle>
          <DialogDescription>Only you can see these. Saving isn&apos;t pinning: nobody else is told.</DialogDescription>
        </DialogHeader>
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2">
          {items === undefined ? (
            <div className="flex h-24 items-center justify-center text-muted-foreground">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <div className="space-y-1 px-4 py-10 text-center text-sm text-muted-foreground">
              <p>Nothing saved yet.</p>
              <p className="text-xs">Right-click a message and choose “Save for me” or “Remind me”.</p>
            </div>
          ) : (
            <>
              {reminders.length > 0 && <Section title="Reminders" items={reminders} now={now} focusKey={focusKey} onNavigate={() => onOpenChange(false)} />}
              {rest.length > 0 && <Section title={reminders.length ? "Saved" : undefined} items={rest} now={now} focusKey={focusKey} onNavigate={() => onOpenChange(false)} />}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  items,
  now,
  focusKey,
  onNavigate,
}: {
  title?: string;
  items: SavedItem[];
  now: number;
  focusKey?: string | null;
  onNavigate: () => void;
}) {
  return (
    <section className="mb-2" aria-label={title ?? "Saved"}>
      {title && <p className="px-2 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>}
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <SavedRow item={item} now={now} focused={item.messageKey === focusKey} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SavedRow({ item, now, focused, onNavigate }: { item: SavedItem; now: number; focused: boolean; onNavigate: () => void }) {
  const nav = useNavigation();
  const unsave = useMutation(api.savedMessages.unsave);
  const setReminder = useMutation(api.savedMessages.setReminder);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    if (!item.room) return;
    if (item.room.scope === "conversation") nav.openConversation(item.room.conversationId);
    else nav.openCommunity(item.room.communityId, item.room.channelId);
    revealMessage(item.messageKey);
    onNavigate();
  };

  const run = (work: Promise<unknown>) => {
    setError(null);
    void work.catch(() => setError("That didn't work. Try again."));
  };

  const due = item.remindAt !== null && item.remindedAt === null && item.remindAt <= now;

  return (
    <div
      tabIndex={-1}
      data-saved-key={item.messageKey}
      className={cn(
        "group rounded-lg border border-transparent p-2 outline-none hover:bg-accent/40 focus-visible:border-ring",
        focused && "border-primary/40 bg-primary/5",
        due && "border-amber-500/40 bg-amber-500/5",
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="truncate font-medium text-foreground">{item.place?.title ?? "Unavailable"}</span>
        {item.place?.subtitle && <span className="truncate">· {item.place.subtitle}</span>}
        {item.remindAt !== null && item.remindedAt === null && (
          <span className={cn("ml-auto flex shrink-0 items-center gap-1", due ? "text-amber-400" : "text-muted-foreground")}>
            <AlarmClock className="size-3" />
            {describeReminder(item.remindAt, now)}
          </span>
        )}
      </div>

      {item.unavailable || !item.message || !item.room ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {item.room ? "This message was deleted or is hidden." : "You no longer have access to this conversation."}
        </p>
      ) : (
        <SavedBody room={item.room} message={item.message} />
      )}

      <div className="mt-1.5 flex items-center gap-1">
        {item.room && !item.unavailable && (
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={open}>
            <ExternalLink className="size-3.5" />
            Open
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2">
              <AlarmClock className="size-3.5" />
              Remind me
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {reminderPresets().map((preset) => (
              <DropdownMenuItem key={preset.label} onClick={() => run(setReminder({ messageKey: item.messageKey, remindAt: preset.at }))}>
                {preset.label}
              </DropdownMenuItem>
            ))}
            {item.remindAt !== null && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => run(setReminder({ messageKey: item.messageKey, remindAt: null }))}>
                  <AlarmClockOff className="size-4" />
                  Clear reminder
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 px-2 text-muted-foreground"
          onClick={() => run(unsave({ messageKey: item.messageKey }))}
        >
          <BookmarkMinus className="size-3.5" />
          Remove
        </Button>
      </div>
      {error && <p className="px-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function SavedBody({
  room,
  message,
}: {
  room: NonNullable<SavedItem["room"]>;
  message: NonNullable<SavedItem["message"]>;
}) {
  const e2eeRoom: Room =
    room.scope === "conversation"
      ? { scope: "conversation", conversationId: room.conversationId }
      : { scope: "channel", channelId: room.channelId as Id<"channels"> };
  const content = useMessageContent(e2eeRoom, message.authorId, { enc: message.enc, text: message.text });
  const name = message.author?.name ?? "Unknown";

  return (
    <div className="mt-1 flex gap-2">
      <Avatar size="sm" className="mt-0.5">
        <AvatarImage src={message.author?.imageUrl ?? undefined} alt={name} />
        <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="text-xs">
          <span className="font-semibold">{name}</span>{" "}
          <span className="text-muted-foreground">{formatDateTime(message.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
        </p>
        {content.state === "locked" ? (
          <button type="button" onClick={openE2eeSetup} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline">
            <Lock className="size-3.5" />
            Encrypted. Unlock encryption on this device to read it.
          </button>
        ) : content.state === "pending" ? (
          <p className="text-sm text-muted-foreground">Decrypting…</p>
        ) : content.text ? (
          <p className="line-clamp-4 text-sm break-words whitespace-pre-wrap">{content.text}</p>
        ) : null}
        {message.hasAttachments && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Paperclip className="size-3" />
            Attachment
          </p>
        )}
      </div>
    </div>
  );
}

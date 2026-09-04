"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import { Hash } from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DeleteMessageDialog } from "@/components/home/delete-message-dialog";
import { MessageContent } from "@/components/home/message-content";
import { MessageContextMenu } from "@/components/home/message-context-menu";
import { MessageHoverActions } from "@/components/home/message-hover-actions";
import { MessageReactions } from "@/components/home/message-reactions";
import { MessageReplyPreview } from "@/components/home/message-reply-preview";
import {
  Avatar,
  AvatarDecoration,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { ServerEmoji } from "@/lib/custom-emoji";
import {
  channelMessagesKey,
  useCachedFirstPage,
} from "@/lib/message-cache";
import { discard, retryNow } from "@/lib/outbox";
import { mentionsUserDirectly } from "@/lib/mentions";
import { formatMessageTimestamp, isSameDay } from "@/lib/message-time";
import { MessageDayDivider } from "@/components/home/message-day-divider";
import { useOutboxOverlay, type OverlayReplyPreview } from "@/lib/outbox-overlay";
import { useOutboxMutation } from "@/hooks/use-outbox-mutation";
import type { ReplyDraft } from "@/lib/reply";
import { cn } from "@/lib/utils";
import { Popover, PopoverTrigger } from "../ui/popover";
import { UserProfileContent } from "./member-profile-card";
import { ProfilePopoverContent } from "@/components/profile/profile-popover";
import { useStickToBottom } from "@/hooks/use-stick-to-bottom";
import {
  AttachmentView,
  type AttachmentSummary,
} from "@/components/home/message-attachment";

interface ChannelMessageListProps {
  channelId: Id<"channels">;
  channelName: string;
  communityId: Id<"communities">;
  /** Whether the viewer can delete other people's messages in this channel
   * (MANAGE_MESSAGES) — editing is always author-only. */
  canManageMessages: boolean;
  /** Reports whether the list is scrolled to the end, which is one of the
   * signals for "this has been read" (see ChannelChatView). */
  onAtBottomChange?: (atBottom: boolean) => void;
  /** Set the composer's reply target — the "Reply" action on each message. */
  onReply?: (draft: ReplyDraft) => void;
}

/** Discord-style channel-start marker — the first thing in the scrollable
 * history, above the earliest message. Only rendered once pagination is
 * "Exhausted" (there's genuinely nothing earlier to load), so it doesn't
 * flash in above a page of messages that just hasn't loaded yet. Not
 * sticky: it scrolls with the rest of the list, so it's only actually
 * visible once you've scrolled all the way up to the start of the channel
 * (or the channel is short enough that the whole history fits on screen). */
function ChannelWelcome({ channelName }: { channelName: string }) {
  return (
    <div className="px-1 pt-4 pb-6 border-b">
      <h2 className="text-2xl font-bold">Welcome to #{channelName}!</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        This is the start of the #{channelName} channel.
      </p>
    </div>
  );
}

interface ReactionSummary {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

interface MessageDoc {
  id: Id<"channelMessages">;
  /** The client idempotency key of the send that created this row, when it came
   * through the outbox — how a pending optimistic row is matched to its real
   * one. */
  clientId?: string | null;
  text: string | null;
  createdAt: number;
  editedAt: number | null;
  isMine: boolean;
  author: {
    id: Id<"users">;
    name: string;
    username: string;
    imageUrl?: string;
    /** The frame around their avatar, as stored — see `decorationLayers`. */
    avatarDecoration?: string;
    /** Colour of the author's highest coloured role in this community. */
    roleColor?: string;
  } | null;
  attachments: AttachmentSummary[];
  reactions: ReactionSummary[];
  /** The message this one replies to — see convex/channelMessages.ts `list`. */
  replyTo?: OverlayReplyPreview | null;
  /** Overlay-only: a queued send not yet acked by the server. */
  __pending?: boolean;
  /** Overlay-only: the queued op behind this row has permanently failed. */
  __failed?: boolean;
  /** Overlay-only: the outbox op id, for Retry / Discard. */
  __opId?: string;
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

const MessageRow = memo(function MessageRow({
  message,
  startsGroup,
  mentionsMe,
  highlighted,
  canManageMessages,
  communityId,
  channelId,
  onReply,
  onJumpTo,
}: {
  message: MessageDoc;
  startsGroup: boolean;
  /** The message pings the reader directly — tint the row. */
  mentionsMe: boolean;
  /** Just jumped-to from a reply preview — flash the row. */
  highlighted: boolean;
  canManageMessages: boolean;
  communityId: Id<"communities">;
  channelId: Id<"channels">;
  onReply: (draft: ReplyDraft) => void;
  onJumpTo: (messageId: string) => void;
}) {
  // Durable: edits/deletes/reactions queue in the outbox and render through the
  // overlay, then flush to Convex (see src/lib/outbox.ts).
  const updateMessage = useOutboxMutation("edit", "channel");
  const removeMessage = useOutboxMutation("delete", "channel");
  const toggleReaction = useOutboxMutation("react", "channel");

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const canDelete = message.isMine || canManageMessages;

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  const startEdit = () => {
    setDraft(message.text ?? "");
    setEditing(true);
  };

  const saveEdit = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (trimmed !== message.text)
      await updateMessage({ channelId, messageId: message.id, text: trimmed });
    setEditing(false);
  };

  const requestDelete = (shiftKey: boolean) => {
    if (shiftKey) void removeMessage({ channelId, messageId: message.id });
    else setConfirmDelete(true);
  };

  const reply = () =>
    onReply({
      id: message.id,
      authorName: message.author?.name ?? "Unknown",
      authorImageUrl: message.author?.imageUrl,
      text: message.text,
      hasAttachment: message.attachments.length > 0,
    });

  const content = (
    <div
      // See the twin in message-list.tsx: a stable hook for custom CSS.
      data-slot="message-row"
      data-message-id={message.id}
      data-pending={message.__pending ? "" : undefined}
      className={cn(
        "group relative flex flex-col rounded transition-colors",
        mentionsMe ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-accent/30",
        startsGroup && "mt-3",
        highlighted && "!bg-primary/20",
        message.__pending && !message.__failed && "opacity-60",
        message.__failed && "border-l-2 border-destructive/60 bg-destructive/5"
      )}
    >
      {/* Browser-native virtualization: offscreen rows skip layout/paint
          until near the viewport, keeping scroll at 60fps even with hundreds
          of heavy rows (markdown, code blocks, images). `containIntrinsicSize`
          reserves space so the scrollbar stays honest.

          It sits on this inner box rather than on the row, because
          `content-visibility` paint-contains as well: on the row it clipped
          the hover actions, which straddle its top edge, and made the row a
          stacking context no z-index could climb out of. The row's padding
          moved in with it, so what's clipped is exactly what was before. */}
      <div
        className="flex flex-col px-2 py-0.5"
        style={
          {
            contentVisibility: "auto",
            containIntrinsicSize: "auto 72px",
          } as React.CSSProperties
        }
      >
      {message.replyTo && (
        <MessageReplyPreview
          reply={message.replyTo}
          onJump={message.replyTo.deleted ? undefined : () => onJumpTo(message.replyTo!.id)}
        />
      )}
      <div className="flex gap-1">
      <div className="w-9 mt-1 shrink-0">
        {/* See the twin in message-list.tsx: the popover needs the author's id
            to size itself around their frame. */}
        {startsGroup && message.author && (
          <Popover>
            <PopoverTrigger asChild>
              <Avatar size="default" className="cursor-pointer">
                <AvatarImage src={message.author?.imageUrl} alt={message.author?.name ?? ""} className="rounded-md" />
                <AvatarFallback>{(message.author?.name ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                <AvatarDecoration value={message.author?.avatarDecoration} />
              </Avatar>
            </PopoverTrigger>
            <ProfilePopoverContent
              userId={message.author.id}
              communityId={communityId}
              side="top"
            >
              {message.author && (
                <UserProfileContent
                  userId={message.author.id}
                  communityId={communityId}
                  name={message.author.name}
                  username={message.author.username}
                  imageUrl={message.author.imageUrl}
                />
              )}
            </ProfilePopoverContent>
          </Popover>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {startsGroup && (
          <div className="flex items-baseline gap-2">
            <span
              className="text-sm font-semibold"
              style={message.author?.roleColor ? { color: message.author.roleColor } : undefined}
            >
              {message.author?.name ?? "Unknown"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {formatMessageTimestamp(message.createdAt)}
            </span>
          </div>
        )}

        {editing ? (
          <div className="space-y-1">
            <Textarea
              ref={editRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void saveEdit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                }
              }}
              className="min-h-8 resize-none"
              rows={1}
            />
            <p className="text-[11px] text-muted-foreground">Escape to cancel · Enter to save</p>
          </div>
        ) : (
          <>
            {message.text && (
              <MessageContent
                text={message.text}
                communityId={communityId}
                edited={!!message.editedAt}
              />
            )}
            {message.attachments.map((attachment) => (
              <AttachmentView
                key={attachment.id}
                attachment={attachment}
                author={message.author ?? undefined}
                createdAt={message.createdAt}
              />
            ))}
            <MessageReactions
              reactions={message.reactions}
              onToggle={(emoji, desired) =>
                void toggleReaction({ channelId, messageId: message.id, emoji, desired })
              }
            />
            {message.__failed && message.__opId && (
              <OutboxFailedFooter opId={message.__opId} />
            )}
          </>
        )}
      </div>
      </div>
      </div>

      {!editing && !message.__pending && (
        <MessageHoverActions
          canEdit={message.isMine}
          canDelete={canDelete}
          communityId={communityId}
          onReact={(emoji) =>
            void toggleReaction({ channelId, messageId: message.id, emoji, desired: "add" })
          }
          onReply={reply}
          onEdit={startEdit}
          onDelete={requestDelete}
        />
      )}
    </div>
  );

  // A queued send has no server row to edit, react to or delete — skip the
  // menus until it lands.
  if (message.__pending) {
    return content;
  }

  return (
    <>
      <MessageContextMenu
        canEdit={message.isMine}
        canDelete={canDelete}
        communityId={communityId}
        onReact={(emoji) =>
          void toggleReaction({ channelId, messageId: message.id, emoji, desired: "add" })
        }
        onReply={reply}
        onEdit={startEdit}
        onDelete={requestDelete}
      >
        {content}
      </MessageContextMenu>
      <DeleteMessageDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={() => void removeMessage({ channelId, messageId: message.id })}
      />
    </>
  );
});

/** The "couldn't send" affordance under a failed optimistic row. */
function OutboxFailedFooter({ opId }: { opId: string }) {
  return (
    <p className="mt-0.5 text-[11px] text-destructive">
      Couldn&apos;t send ·{" "}
      <button
        type="button"
        className="underline underline-offset-2 hover:no-underline"
        onClick={() => retryNow(opId)}
      >
        Retry
      </button>{" "}
      ·{" "}
      <button
        type="button"
        className="underline underline-offset-2 hover:no-underline"
        onClick={() => discard(opId)}
      >
        Delete
      </button>
    </p>
  );
}

function MessageListSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-2 py-2 h-full justify-end">
      {[48, 32, 64, 40, 56].map((w, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className={`h-3.5 w-${w}`} style={{ width: `${w}%` }} />
            {i % 2 === 0 && <Skeleton className="h-3.5" style={{ width: `${w - 12}%` }} />}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChannelMessageList({
  channelId,
  channelName,
  communityId,
  canManageMessages,
  onAtBottomChange,
  onReply,
}: ChannelMessageListProps) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.channelMessages.list,
    { channelId },
    { initialNumItems: 30 }
  );
  // Every mount of a paginated query is a fresh query as far as Convex is
  // concerned, so this is `LoadingFirstPage` on every visit even when nothing
  // has changed. Show the last page we know about meanwhile — see
  // src/lib/message-cache.ts.
  const me = useQuery(api.users.getCurrentUser);
  const myUserId = me?._id as string | undefined;
  const overlayMe = useMemo(
    () =>
      me
        ? {
            _id: me._id,
            name: me.name,
            username: me.username,
            imageUrl: me.imageUrl,
            avatarDecoration: me.avatarDecoration,
          }
        : null,
    [me]
  );
  const loadingFirstPage = status === "LoadingFirstPage";
  const cached = useCachedFirstPage<MessageDoc>(
    channelMessagesKey(channelId),
    results,
    loadingFirstPage
  );
  // Splice in anything still queued in the outbox — downstream of the cache
  // seam, so the persistent mirror only ever sees real server rows.
  const messages = useOutboxOverlay<MessageDoc>(
    channelMessagesKey(channelId),
    cached,
    overlayMe
  );
  const chronological = [...messages].reverse();

  const latest = chronological[chronological.length - 1];

  const { containerRef, contentRef, onScroll } = useStickToBottom({
    viewKey: channelId,
    latestKey: latest?.id,
    // Sending re-pins: whatever the reader was looking at, putting a message
    // into the conversation is a request to be at the end of it.
    latestIsMine: latest?.isMine ?? false,
  });

  // `containerRef` is a callback ref (see useStickToBottom) — keep our own
  // handle so a reply preview click can scroll to its target.
  const scrollElRef = useRef<HTMLDivElement | null>(null);
  const setScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollElRef.current = node;
      containerRef(node);
    },
    [containerRef]
  );

  const [highlightId, setHighlightId] = useState<string | null>(null);
  const jumpTo = useCallback((messageId: string) => {
    const el = scrollElRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${messageId}"]`
    );
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlightId(messageId);
    window.setTimeout(
      () => setHighlightId((current) => (current === messageId ? null : current)),
      1600
    );
  }, []);

  // Only truly cold channels get a skeleton now: anything opened before, or
  // warmed by the preloader, has a page to show.
  if (loadingFirstPage && chronological.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageListSkeleton />
      </div>
    );
  }

  return (
    <div
      ref={setScrollRef}
      // One handler for both jobs: the hook decides whether new messages should
      // still follow the reader down, and hands back the same answer this view
      // needs for its own "at the bottom" state.
      onScroll={() => onAtBottomChange?.(onScroll())}
      className="min-h-0 flex-1 overflow-y-auto px-4 py-2 bg-gradient-to-t from-background to-transparent [scrollbar-gutter:stable] overscroll-contain"
      style={{ willChange: "scroll-position" } as React.CSSProperties}
    >
      {/* min-h-full + justify-end pins short conversations to the bottom of
          the scroll area (like a normal chat) instead of leaving them
          stranded at the top; once content overflows this behaves like a
          regular top-down scrolling list. Deliberately not shadcn's
          ScrollArea here: Radix wraps its Viewport's children in a
          `display: table` div, which ignores the `min-h-full` this pin
          relies on, so short conversations render top-anchored instead. */}
      <div ref={contentRef} className="flex min-h-full flex-col justify-end gap-0.5">
        {status === "Exhausted" && <ChannelWelcome channelName={channelName} />}

        {status === "CanLoadMore" && (
          <div className="flex justify-center py-2">
            <Button variant="ghost" size="sm" onClick={() => loadMore(30)}>
              Load earlier messages
            </Button>
          </div>
        )}

        {chronological.map((message, index) => {
          const prev = chronological[index - 1];
          const newDay = !prev || !isSameDay(prev.createdAt, message.createdAt);
          const startsGroup =
            newDay ||
            prev.author?.id !== message.author?.id ||
            message.createdAt - prev.createdAt > GROUP_WINDOW_MS ||
            // A reply always shows its own header, so the spine has an avatar
            // to point at — like Discord.
            !!message.replyTo;

          return (
            <Fragment key={message.id}>
              {newDay && <MessageDayDivider ts={message.createdAt} />}
              <MessageRow
                message={message}
                startsGroup={startsGroup}
                mentionsMe={
                  !!myUserId && mentionsUserDirectly(message.text ?? "", myUserId)
                }
                highlighted={highlightId === message.id}
                canManageMessages={canManageMessages}
                communityId={communityId}
                channelId={channelId}
                onReply={(draft) => onReply?.(draft)}
                onJumpTo={jumpTo}
              />
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DeleteMessageDialog } from "@/components/home/delete-message-dialog";
import { MessageContent } from "@/components/home/message-content";
import { MessageContextMenu } from "@/components/home/message-context-menu";
import { MessageHoverActions } from "@/components/home/message-hover-actions";
import { MessageReactions } from "@/components/home/message-reactions";
import { UserProfileContent } from "@/components/community/member-profile-card";
import { ProfilePopoverContent } from "@/components/profile/profile-popover";
import { useStickToBottom } from "@/hooks/use-stick-to-bottom";
import {
  AttachmentView,
  type AttachmentSummary,
} from "@/components/home/message-attachment";
import {
  Avatar,
  AvatarDecoration,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EMPTY_EMOJI_MAP } from "@/lib/custom-emoji";
import {
  conversationMessagesKey,
  useCachedFirstPage,
} from "@/lib/message-cache";
import { discard, retryNow } from "@/lib/outbox";
import { useOutboxOverlay } from "@/lib/outbox-overlay";
import { useOutboxMutation } from "@/hooks/use-outbox-mutation";
import { cn } from "@/lib/utils";

interface MessageListProps {
  conversationId: Id<"conversations">;
}

interface ReactionSummary {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

interface MessageDoc {
  id: Id<"messages">;
  /** The client idempotency key of the send that created this row, when it
   * came through the outbox — how a pending optimistic row is matched to its
   * real one. */
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
  } | null;
  attachments: AttachmentSummary[];
  reactions: ReactionSummary[];
  /** Overlay-only: a queued send not yet acked by the server. */
  __pending?: boolean;
  /** Overlay-only: the queued op behind this row has permanently failed. */
  __failed?: boolean;
  /** Overlay-only: the outbox op id, for Retry / Discard. */
  __opId?: string;
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;


function MessageRow({
  message,
  startsGroup,
  conversationId,
}: {
  message: MessageDoc;
  startsGroup: boolean;
  conversationId: Id<"conversations">;
}) {
  // Durable: edits/deletes/reactions queue in the outbox and render through the
  // overlay, then flush to Convex (see src/lib/outbox.ts).
  const updateMessage = useOutboxMutation("edit", "dm");
  const removeMessage = useOutboxMutation("delete", "dm");
  const toggleReaction = useOutboxMutation("react", "dm");

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

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
      await updateMessage({ conversationId, messageId: message.id, text: trimmed });
    setEditing(false);
  };

  const requestDelete = (shiftKey: boolean) => {
    if (shiftKey) void removeMessage({ conversationId, messageId: message.id });
    else setConfirmDelete(true);
  };

  const content = (
    <div
      // A stable hook for custom CSS — utility classes get rewritten as this
      // component is edited, whereas a slot name is something a user's
      // stylesheet can rely on. See src/lib/css-snippets.ts.
      data-slot="message-row"
      data-pending={message.__pending ? "" : undefined}
      className={cn(
        "group relative flex gap-3 rounded px-2 py-0.5 hover:bg-accent/30",
        startsGroup && "mt-3",
        message.__pending && !message.__failed && "opacity-60",
        message.__failed && "border-l-2 border-destructive/60 bg-destructive/5"
      )}
    >
      <div className="w-9 shrink-0">
        {/* Guarded on the author here rather than inside the popover: the
            popover now needs their id to work out how much room their frame
            wants, and an avatar with nobody behind it opens nothing useful. */}
        {startsGroup && message.author && (
          <Popover>
            <PopoverTrigger asChild>
              <Avatar size="default" className="cursor-pointer">
                <AvatarImage src={message.author?.imageUrl} alt={message.author?.name ?? ""} className="rounded-md" />
                <AvatarFallback>{(message.author?.name ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                <AvatarDecoration value={message.author?.avatarDecoration} />
              </Avatar>
            </PopoverTrigger>
            <ProfilePopoverContent userId={message.author.id} side="top">
              {message.author && (
                <UserProfileContent
                  userId={message.author.id}
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
            <span className="text-sm font-semibold">{message.author?.name ?? "Unknown"}</span>
            <span className="text-[11px] text-muted-foreground">
              {new Date(message.createdAt).toLocaleString()}
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
            <p className="text-[11px] text-muted-foreground">
              Escape to cancel · Enter to save
            </p>
          </div>
        ) : (
          <>
            {message.text && (
              <MessageContent
                text={message.text}
                suffix={
                  message.editedAt && (
                    <span className="ml-1 text-[10px] text-muted-foreground">(edited)</span>
                  )
                }
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
                void toggleReaction({ conversationId, messageId: message.id, emoji, desired })
              }
            />
            {message.__failed && message.__opId && (
              <OutboxFailedFooter opId={message.__opId} />
            )}
          </>
        )}
      </div>

      {!editing && !message.__pending && (
        <MessageHoverActions
          canEdit={message.isMine}
          canDelete={message.isMine}
          onReact={(emoji) =>
            void toggleReaction({ conversationId, messageId: message.id, emoji, desired: "add" })
          }
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
        canDelete={message.isMine}
        onReact={(emoji) =>
          void toggleReaction({ conversationId, messageId: message.id, emoji, desired: "add" })
        }
        onEdit={startEdit}
        onDelete={requestDelete}
      >
        {content}
      </MessageContextMenu>
      <DeleteMessageDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={() => void removeMessage({ conversationId, messageId: message.id })}
      />
    </>
  );
}

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
    <div className="flex flex-col gap-4 px-2 py-2">
      {[48, 32, 64, 40, 56].map((w, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3.5" style={{ width: `${w}%` }} />
            {i % 2 === 0 && <Skeleton className="h-3.5" style={{ width: `${w - 12}%` }} />}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MessageList({ conversationId }: MessageListProps) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.messages.list,
    { conversationId },
    { initialNumItems: 30 }
  );
  const me = useQuery(api.users.getCurrentUser);
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
  // A revisit is a cold query as far as Convex is concerned, so show the last
  // known page while it re-resolves — see src/lib/message-cache.ts.
  const loadingFirstPage = status === "LoadingFirstPage";
  const cached = useCachedFirstPage<MessageDoc>(
    conversationMessagesKey(conversationId),
    results,
    loadingFirstPage
  );
  // Splice in anything still queued in the outbox — downstream of the cache
  // seam, so the persistent mirror only ever sees real server rows.
  const messages = useOutboxOverlay<MessageDoc>(
    conversationMessagesKey(conversationId),
    cached,
    overlayMe
  );
  const chronological = [...messages].reverse();

  const latest = chronological[chronological.length - 1];

  const { containerRef, contentRef, onScroll } = useStickToBottom({
    viewKey: conversationId,
    latestKey: latest?.id,
    // Sending re-pins: whatever the reader was looking at, putting a message
    // into the conversation is a request to be at the end of it.
    latestIsMine: latest?.isMine ?? false,
  });

  if (loadingFirstPage && chronological.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageListSkeleton />
      </div>
    );
  }

  return (
    <div ref={containerRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
      {/* min-h-full + justify-end pins short conversations to the bottom of
          the scroll area (like a normal chat) instead of leaving them
          stranded at the top; once content overflows this behaves like a
          regular top-down scrolling list. Deliberately not shadcn's
          ScrollArea here: Radix wraps its Viewport's children in a
          `display: table` div, which ignores the `min-h-full` this pin
          relies on, so short conversations render top-anchored instead. */}
      <div ref={contentRef} className="flex min-h-full flex-col justify-end gap-0.5">
        {status === "CanLoadMore" && (
          <div className="flex justify-center py-2">
            <Button variant="ghost" size="sm" onClick={() => loadMore(30)}>
              Load earlier messages
            </Button>
          </div>
        )}

        {chronological.map((message, index) => {
          const prev = chronological[index - 1];
          const startsGroup =
            !prev ||
            prev.author?.id !== message.author?.id ||
            message.createdAt - prev.createdAt > GROUP_WINDOW_MS;

          return (
            <MessageRow
              key={message.id}
              message={message}
              startsGroup={startsGroup}
              conversationId={conversationId}
            />
          );
        })}
      </div>
    </div>
  );
}

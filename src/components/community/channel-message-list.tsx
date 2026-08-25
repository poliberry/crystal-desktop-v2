"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Hash } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DeleteMessageDialog } from "@/components/home/delete-message-dialog";
import { MessageContent } from "@/components/home/message-content";
import { MessageContextMenu } from "@/components/home/message-context-menu";
import { MessageHoverActions } from "@/components/home/message-hover-actions";
import { MessageReactions } from "@/components/home/message-reactions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { ServerEmoji } from "@/lib/custom-emoji";
import {
  channelMessagesKey,
  useCachedFirstPage,
} from "@/lib/message-cache";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { UserProfileContent } from "./member-profile-card";
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
    <div className="px-1 pt-4 pb-6">
      <img src="/icons/channel.png" alt={channelName} className="size-30 opacity-40" style={{
        WebkitMaskImage:
          "linear-gradient(to bottom right, var(--accent) 0%, var(--accent) 5%, transparent 100%)",
        maskImage:
          "linear-gradient(to bottom right, var(--accent) 0%, var(--accent) 5%, transparent 100%)",
      }} />
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
  text: string | null;
  createdAt: number;
  editedAt: number | null;
  isMine: boolean;
  author: {
    id: Id<"users">;
    name: string;
    username: string;
    imageUrl?: string;
    /** Colour of the author's highest coloured role in this community. */
    roleColor?: string;
  } | null;
  attachments: AttachmentSummary[];
  reactions: ReactionSummary[];
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function MessageRow({
  message,
  startsGroup,
  canManageMessages,
  communityId,
}: {
  message: MessageDoc;
  startsGroup: boolean;
  canManageMessages: boolean;
  communityId: Id<"communities">;
}) {
  const updateMessage = useMutation(api.channelMessages.update);
  const removeMessage = useMutation(api.channelMessages.remove);
  const toggleReaction = useMutation(api.channelMessages.toggleReaction);

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
    if (trimmed !== message.text) await updateMessage({ messageId: message.id, text: trimmed });
    setEditing(false);
  };

  const requestDelete = (shiftKey: boolean) => {
    if (shiftKey) void removeMessage({ messageId: message.id });
    else setConfirmDelete(true);
  };

  const content = (
    <div
      className={cn(
        "group relative flex gap-1 rounded px-2 py-0.5 hover:bg-accent/30",
        startsGroup && "mt-3"
      )}
    >
      <div className="w-9 mt-1 shrink-0">
        {startsGroup && (
          <Popover>
            <PopoverTrigger asChild>
              <Avatar size="default" className="cursor-pointer">
                <AvatarImage src={message.author?.imageUrl} alt={message.author?.name ?? ""} className="rounded-md" />
                <AvatarFallback>{(message.author?.name ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-72 p-0">
              {message.author && (
                <UserProfileContent
                  userId={message.author.id}
                  communityId={communityId}
                  name={message.author.name}
                  username={message.author.username}
                  imageUrl={message.author.imageUrl}
                />
              )}
            </PopoverContent>
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
            <p className="text-[11px] text-muted-foreground">Escape to cancel · Enter to save</p>
          </div>
        ) : (
          <>
            {message.text && (
              <MessageContent
                text={message.text}
                communityId={communityId}
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
              onToggle={(emoji) => void toggleReaction({ messageId: message.id, emoji })}
            />
          </>
        )}
      </div>

      {!editing && (
        <MessageHoverActions
          canEdit={message.isMine}
          canDelete={canDelete}
          communityId={communityId}
          onReact={(emoji) => void toggleReaction({ messageId: message.id, emoji })}
          onEdit={startEdit}
          onDelete={requestDelete}
        />
      )}
    </div>
  );

  return (
    <>
      <MessageContextMenu
        canEdit={message.isMine}
        canDelete={canDelete}
        communityId={communityId}
        onReact={(emoji) => void toggleReaction({ messageId: message.id, emoji })}
        onEdit={startEdit}
        onDelete={requestDelete}
      >
        {content}
      </MessageContextMenu>
      <DeleteMessageDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={() => void removeMessage({ messageId: message.id })}
      />
    </>
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
  const loadingFirstPage = status === "LoadingFirstPage";
  const messages = useCachedFirstPage<MessageDoc>(
    channelMessagesKey(channelId),
    results,
    loadingFirstPage
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
      ref={containerRef}
      // One handler for both jobs: the hook decides whether new messages should
      // still follow the reader down, and hands back the same answer this view
      // needs for its own "at the bottom" state.
      onScroll={() => onAtBottomChange?.(onScroll())}
      className="min-h-0 flex-1 overflow-y-auto px-4 py-2 bg-gradient-to-t from-background to-transparent"
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
          const startsGroup =
            !prev ||
            prev.author?.id !== message.author?.id ||
            message.createdAt - prev.createdAt > GROUP_WINDOW_MS;

          return (
            <MessageRow
              key={message.id}
              message={message}
              startsGroup={startsGroup}
              canManageMessages={canManageMessages}
              communityId={communityId}
            />
          );
        })}
      </div>
    </div>
  );
}

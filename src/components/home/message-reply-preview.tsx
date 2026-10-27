"use client";

import { Image as ImageIcon } from "lucide-react";

import { MessagePreview } from "@/components/message-preview";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { OverlayReplyPreview } from "@/lib/outbox-overlay";
import { cn } from "@/lib/utils";

/**
 * The "replying to…" line above a message — the replied-to author and a
 * one-line snippet, joined by a Discord-style elbow to the avatar of the
 * message below. Clicking it jumps to the original if it's on screen.
 *
 * The list forces `startsGroup` for any message with a reply, so the elbow
 * always has an avatar directly beneath it to point at.
 *
 * The elbow is drawn the way Discord draws it: an absolutely-positioned box
 * living in the left margin, `right: 100%` so it always meets the content, with
 * just its left + top borders and a rounded corner.
 */
export function MessageReplyPreview({
  reply,
  onJump,
}: {
  reply: OverlayReplyPreview;
  onJump?: () => void;
}) {
  const clickable = !!onJump && !reply.deleted;
  return (
    <div
      onClick={clickable ? onJump : undefined}
      role={clickable ? "button" : undefined}
      className={cn(
        "relative my-0.5 ml-[44px] mr-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground",
        clickable && "cursor-pointer"
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-[-4px] left-[-26px] right-full top-1/2 mr-1 rounded-tl-[6px] border-l-2 border-t-2 border-muted-foreground/40"
      />

      {reply.deleted ? (
        <span className="truncate italic opacity-70">Original message was deleted</span>
      ) : (
        <>
          <Avatar className="size-4 shrink-0">
            <AvatarImage src={reply.authorImageUrl} alt="" className="rounded-md" />
            <AvatarFallback className="rounded-md bg-muted text-[8px]">
              {reply.authorName.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="shrink-0 font-medium text-foreground/75">@{reply.authorName}</span>
          {reply.text ? (
            <span
              className={cn(
                "min-w-0 flex-1 truncate opacity-90",
                clickable && "transition-opacity hover:opacity-100"
              )}
            >
              <MessagePreview text={reply.text} className="inline" />
            </span>
          ) : reply.hasAttachment ? (
            <span className="flex shrink-0 items-center gap-1 italic opacity-80">
              Click to see attachment
              <ImageIcon className="size-3" />
            </span>
          ) : (
            <span className="shrink-0 italic opacity-70">Jump to message</span>
          )}
        </>
      )}
    </div>
  );
}

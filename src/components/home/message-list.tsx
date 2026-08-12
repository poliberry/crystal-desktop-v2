"use client";

import { usePaginatedQuery } from "convex/react";
import { File as FileIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MessageContent } from "@/components/home/message-content";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MessageListProps {
  conversationId: Id<"conversations">;
}

interface AttachmentSummary {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  url: string | null;
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentView({ attachment }: { attachment: AttachmentSummary }) {
  if (!attachment.url) return null;
  if (attachment.fileType.startsWith("image/")) {
    return (
      <img
        src={attachment.url}
        alt={attachment.fileName}
        className="mt-1 max-h-80 max-w-full rounded-md border"
      />
    );
  }
  if (attachment.fileType.startsWith("video/")) {
    return (
      <video src={attachment.url} controls className="mt-1 max-h-80 max-w-full rounded-md border" />
    );
  }
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      download={attachment.fileName}
      className="mt-1 flex w-fit items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm hover:bg-muted/60"
    >
      <FileIcon className="size-4 text-muted-foreground" />
      <span className="max-w-48 truncate">{attachment.fileName}</span>
      <span className="text-xs text-muted-foreground">{formatBytes(attachment.fileSize)}</span>
    </a>
  );
}

export function MessageList({ conversationId }: MessageListProps) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.messages.list,
    { conversationId },
    { initialNumItems: 30 }
  );
  const chronological = [...results].reverse();

  const bottomRef = useRef<HTMLDivElement>(null);
  const lastIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const lastId = chronological[chronological.length - 1]?.id;
    if (lastId && lastId !== lastIdRef.current) {
      lastIdRef.current = lastId;
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [chronological]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-2">
      {status === "CanLoadMore" && (
        <div className="flex justify-center py-2">
          <Button variant="ghost" size="sm" onClick={() => loadMore(30)}>
            Load earlier messages
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        {chronological.map((message, index) => {
          const prev = chronological[index - 1];
          const startsGroup =
            !prev ||
            prev.author?.id !== message.author?.id ||
            message.createdAt - prev.createdAt > GROUP_WINDOW_MS;

          return (
            <div
              key={message.id}
              className={cn(
                "flex gap-3 rounded px-2 py-0.5 hover:bg-accent/30",
                startsGroup && "mt-3"
              )}
            >
              <div className="w-9 shrink-0">
                {startsGroup && (
                  <Avatar size="sm">
                    <AvatarImage src={message.author?.imageUrl} alt={message.author?.name ?? ""} />
                    <AvatarFallback>
                      {(message.author?.name ?? "?").slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>
              <div className="min-w-0 flex-1">
                {startsGroup && (
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold">
                      {message.author?.name ?? "Unknown"}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(message.createdAt).toLocaleString()}
                    </span>
                  </div>
                )}
                {message.text && <MessageContent text={message.text} />}
                {message.attachments.map((attachment) => (
                  <AttachmentView key={attachment.id} attachment={attachment} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}

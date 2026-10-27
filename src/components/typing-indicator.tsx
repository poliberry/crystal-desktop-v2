"use client";

import { useQuery } from "convex/react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

interface TypingIndicatorProps {
  channelId?: Id<"channels">;
  conversationId?: Id<"conversations">;
}

export function TypingIndicator({ channelId, conversationId }: TypingIndicatorProps) {
  const args = channelId ? { channelId } : conversationId ? { conversationId } : null;
  const typingUsers = useQuery(api.typing.list, args ?? "skip");

  if (!typingUsers?.length) return null;

  let text: string;
  if (typingUsers.length === 1) {
    text = `${typingUsers[0].name} is typing...`;
  } else if (typingUsers.length === 2) {
    text = `${typingUsers[0].name} and ${typingUsers[1].name} are typing...`;
  } else {
    text = "Multiple people are typing...";
  }

  return (
    <div className="flex items-center gap-2 shrink-0 px-4 pb-0.5 pt-1 text-xs text-muted-foreground italic">
      <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse [animation-delay:300ms]" />
          </div>
      {text}
    </div>
  );
}

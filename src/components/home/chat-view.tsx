"use client";

import { useMutation, useQuery } from "convex/react";
import { PhoneCall, Users } from "lucide-react";
import { useEffect } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MessageComposer } from "@/components/home/message-composer";
import { MessageList } from "@/components/home/message-list";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

interface ChatViewProps {
  conversationId: Id<"conversations">;
  onStartCall: () => void;
}

export function ChatView({ conversationId, onStartCall }: ChatViewProps) {
  const conversation = useQuery(api.conversations.get, { conversationId });
  const callParticipants = useQuery(api.calls.listParticipants, { conversationId }) ?? [];
  const markRead = useMutation(api.conversations.markRead);

  useEffect(() => {
    void markRead({ conversationId });
  }, [conversationId, markRead]);

  if (!conversation) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const isGroup = conversation.type === "group";
  const title = isGroup
    ? conversation.name || conversation.members.map((m) => m.name).join(", ")
    : (conversation.members[0]?.name ?? "Unknown");
  const avatarUser = isGroup ? undefined : conversation.members[0];

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          {isGroup ? (
            <div className="flex size-8 items-center justify-center rounded-full bg-muted">
              <Users className="size-4" />
            </div>
          ) : (
            <Avatar size="sm">
              <AvatarImage src={avatarUser?.imageUrl} alt={title} />
              <AvatarFallback>{title.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          )}
          <div>
            <p className="text-sm font-semibold">{title}</p>
            {isGroup && (
              <p className="text-xs text-muted-foreground">
                {conversation.members.length + 1} members
              </p>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant={callParticipants.length > 0 ? "default" : "secondary"}
          className="gap-1.5"
          onClick={onStartCall}
        >
          <PhoneCall className="size-4" />
          {callParticipants.length > 0 ? `Join call (${callParticipants.length})` : "Call"}
        </Button>
      </div>

      <MessageList conversationId={conversationId} />
      <MessageComposer conversationId={conversationId} />
    </div>
  );
}

"use client";

import { useMutation, useQuery } from "convex/react";
import { PanelRightClose, PanelRightOpen, PhoneCall } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useCall } from "@/components/call/call-provider";
import { DmMemberList } from "@/components/home/dm-member-list";
import { GroupAvatar } from "@/components/home/group-avatar";
import { MessageComposer } from "@/components/home/message-composer";
import { MessageList } from "@/components/home/message-list";
import { TypingIndicator } from "@/components/typing-indicator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ChatViewProps {
  conversationId: Id<"conversations">;
  onStartCall: () => void;
}

export function ChatView({ conversationId, onStartCall }: ChatViewProps) {
  const conversation = useQuery(api.conversations.get, { conversationId });
  const callParticipants = useQuery(api.calls.listParticipants, { conversationId }) ?? [];
  const markRead = useMutation(api.conversations.markRead);
  const { activeCall } = useCall();
  const isActiveCall = activeCall?.kind === "dm" && activeCall.conversationId === conversationId;
  const [showMembers, setShowMembers] = useState(true);

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
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            {isGroup ? (
              <GroupAvatar imageUrl={conversation.imageUrl} members={conversation.members} />
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

          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant={isActiveCall || callParticipants.length > 0 ? "default" : "secondary"}
              className="gap-1.5"
              onClick={onStartCall}
            >
              <PhoneCall className="size-4" />
              {isActiveCall
                ? "Return to call"
                : callParticipants.length > 0
                  ? `Join call (${callParticipants.length})`
                  : "Call"}
            </Button>

            {isGroup && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={() => setShowMembers((v) => !v)}>
                      {showMembers ? (
                        <PanelRightClose className="size-4" />
                      ) : (
                        <PanelRightOpen className="size-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {showMembers ? "Hide member list" : "Show member list"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>

        <MessageList conversationId={conversationId} />
        <TypingIndicator conversationId={conversationId} />
        <MessageComposer conversationId={conversationId} />
      </div>

      {isGroup && showMembers && <DmMemberList conversationId={conversationId} />}
    </div>
  );
}

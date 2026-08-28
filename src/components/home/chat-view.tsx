"use client";

import { useMutation, useQuery } from "convex/react";
import { PanelRightClose, PanelRightOpen, PhoneCall } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useCall } from "@/components/call/call-provider";
import { DmMemberList } from "@/components/home/dm-member-list";
import { GroupAvatar } from "@/components/home/group-avatar";
import { GroupSettingsDialog } from "@/components/home/group-settings-dialog";
import { CakeRain } from "@/components/home/cake-rain";
import { MessageComposer } from "@/components/home/message-composer";
import { MessageList } from "@/components/home/message-list";
import { TypingIndicator } from "@/components/typing-indicator";
import { useWindowFocus } from "@/hooks/use-window-focus";
import {
  Avatar,
  AvatarDecoration,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { decorationSrc } from "@/lib/avatar-decorations";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * How recent a birthday wish has to be for the cakes to fall for it.
 *
 * Opening a conversation subscribes you to its latest wish whenever it was
 * sent, so there has to be a line between "this just happened" and "this
 * happened at some point". Half a minute is long enough to cover a slow
 * round trip and short enough that nobody sees a stranger's cakes.
 */
const WISH_FRESH_MS = 30_000;

interface ChatViewProps {
  conversationId: Id<"conversations">;
  /** `silent` skips ringing the other members and just connects — the
   * Shift-click path. */
  onStartCall: (options: { silent: boolean }) => void;
}

export function ChatView({ conversationId, onStartCall }: ChatViewProps) {
  const conversation = useQuery(api.conversations.get, { conversationId });
  const callParticipants = useQuery(api.calls.listParticipants, { conversationId }) ?? [];
  const markRead = useMutation(api.conversations.markRead);
  const focused = useWindowFocus();
  const { activeCall } = useCall();
  const isActiveCall = activeCall?.kind === "dm" && activeCall.conversationId === conversationId;
  const [showMembers, setShowMembers] = useState(true);
  const [editingGroup, setEditingGroup] = useState(false);
  /**
   * A birthday wish landing in this conversation — for either person, sender
   * or recipient — sets the cakes off.
   *
   * "Landing" is the fresh-enough test below rather than anything about who
   * sent it: the two clients learn about the message the same way, so they
   * play it at the same moment without either of them being told to.
   */
  const latestWish = useQuery(api.messages.latestBirthdayWish, { conversationId });
  const [raining, setRaining] = useState(false);
  const playedWish = useRef<string | null>(null);

  useEffect(() => {
    if (!latestWish) return;
    if (playedWish.current === latestWish.id) return;
    // Marked seen either way, so a wish that was already old when this
    // conversation was opened is passed over once rather than reconsidered on
    // every re-render.
    playedWish.current = latestWish.id;
    if (Date.now() - latestWish.createdAt < WISH_FRESH_MS) setRaining(true);
  }, [latestWish]);

  /**
   * Read means read *by someone who was there*: this conversation open in a
   * focused window. A DM left open in a background window stays unread.
   *
   * `conversation?.unread` is a dependency so a message landing while you're
   * sitting here is marked read too, rather than lighting up the rail for a
   * conversation you're looking at.
   */
  useEffect(() => {
    if (!focused) return;
    void markRead({ conversationId });
  }, [conversationId, focused, conversation?.unread, markRead]);

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
  // Everyone in here whose birthday it is — the composer prompt is about them.
  // A plural list because a group DM can, eventually, have two.
  const birthdayMembers = conversation.members
    .filter((member) => member.isBirthday)
    .map((member) => ({ name: member.name }));

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
          {/* For a group the whole identity block is the way into its
              settings — the icon and name are what you'd click to change
              them, so there's no separate button for it. */}
          {isGroup ? (
            <button
              type="button"
              onClick={() => setEditingGroup(true)}
              title="Group settings"
              className="flex items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-accent/60"
            >
              <GroupAvatar imageUrl={conversation.imageUrl} members={conversation.members} />
              <div>
                <p className="text-sm font-semibold">{title}</p>
                <p className="text-xs text-muted-foreground">
                  {conversation.members.length + 1} members
                </p>
              </div>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <Avatar size="sm">
                <AvatarImage src={avatarUser?.imageUrl} alt={title} />
                <AvatarFallback>{title.slice(0, 2).toUpperCase()}</AvatarFallback>
                <AvatarDecoration src={decorationSrc(avatarUser?.avatarDecoration)} />
              </Avatar>
              <p className="text-sm font-semibold">{title}</p>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant={isActiveCall || callParticipants.length > 0 ? "default" : "secondary"}
              className="gap-1.5"
              title="Shift-click to join without ringing anyone"
              onClick={(e) => onStartCall({ silent: e.shiftKey })}
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
        <MessageComposer
          conversationId={conversationId}
          birthdayMembers={birthdayMembers}
        />
      </div>

      {isGroup && showMembers && <DmMemberList conversationId={conversationId} />}

      {isGroup && (
        <GroupSettingsDialog
          conversationId={conversationId}
          name={conversation.name ?? null}
          imageUrl={conversation.imageUrl}
          members={conversation.members}
          fallbackName={conversation.members.map((m) => m.name).join(", ")}
          open={editingGroup}
          onOpenChange={setEditingGroup}
        />
      )}

      {raining && <CakeRain onDone={() => setRaining(false)} />}
    </div>
  );
}

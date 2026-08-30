"use client";

import { useMutation, useQuery } from "convex/react";
import { Image as ImageIcon, PanelRightClose, PanelRightOpen, PhoneCall } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useCall } from "@/components/call/call-provider";
import { DmMemberList } from "@/components/home/dm-member-list";
import { GroupAvatar } from "@/components/home/group-avatar";
import { GroupSettingsDialog } from "@/components/home/group-settings-dialog";
import { CakeRain } from "@/components/home/cake-rain";
import { MessageComposer } from "@/components/home/message-composer";
import { DmProfilePanel } from "@/components/home/dm-profile-panel";
import { MessageList } from "@/components/home/message-list";
import { PresenceBadge } from "@/components/presence-dot";
import {
  presenceHeadline,
  topActivity,
} from "@/components/rich-presence-card";
import type { FriendStatus } from "@/lib/presence";
import type { RichPresenceActivity } from "@/types/desktop-api";
import { TypingIndicator } from "@/components/typing-indicator";
import { ChatBackground } from "@/components/chat-decoration";
import { ChatDecorationEditor } from "@/components/chat-decoration-editor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWindowFocus } from "@/hooks/use-window-focus";
import {
  Avatar,
  AvatarDecoration,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
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
  const [editingBackground, setEditingBackground] = useState(false);
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
  const activities = (avatarUser?.activities ?? []) as RichPresenceActivity[];
  // Both, when there are both — see `presenceHeadline`.
  const headerLine = presenceHeadline(avatarUser?.customStatus, topActivity(activities));
  const panelName = isGroup ? "member list" : "profile";
  // Everyone in here whose birthday it is — the composer prompt is about them.
  // A plural list because a group DM can, eventually, have two.
  const birthdayMembers = conversation.members
    .filter((member) => member.isBirthday)
    .map((member) => ({ name: member.name }));

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ChatBackground
        url={conversation?.backgroundUrl}
        opacity={conversation?.backgroundOpacity}
      />
      <div className="relative isolate flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
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
            <div className="flex min-w-0 items-center gap-2">
              <Avatar size="default">
                <AvatarImage src={avatarUser?.imageUrl} alt={title} />
                <AvatarFallback>{title.slice(0, 2).toUpperCase()}</AvatarFallback>
                <AvatarDecoration value={avatarUser?.avatarDecoration} />
                {avatarUser && (
                  <PresenceBadge
                    status={avatarUser.status as FriendStatus}
                    activities={activities}
                    accent={avatarUser.borderGradientStart}
                    isBirthday={avatarUser.isBirthday}
                    decorated={!!avatarUser.avatarDecoration}
                  />
                )}
              </Avatar>
              <div className="min-w-0 flex flex-row gap-2 items-center">
                <p className="truncate text-sm font-semibold leading-tight">{title}</p>
                {/* Their own words first, then whatever they are doing. Nothing
                    at all when there is neither: the dot on the avatar already
                    says whether they are reachable, and a line repeating it in
                    words would be the same fact twice. */}
                {headerLine && (
                  <p className="flex items-center gap-1 truncate text-xs text-muted-foreground leading-tight">
                    <span className="truncate">{headerLine}</span>
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            {/* A group reaches this through its settings dialog, where the
                icon and name already live. A one-to-one DM has no such dialog,
                so the wallpaper gets its own button. */}
            {!isGroup && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditingBackground(true)}
                    >
                      <ImageIcon className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Chat background</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
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
                  {showMembers ? `Hide ${panelName}` : `Show ${panelName}`}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <MessageList conversationId={conversationId} />
        <TypingIndicator conversationId={conversationId} />
        <MessageComposer
          conversationId={conversationId}
          birthdayMembers={birthdayMembers}
        />
      </div>

      {showMembers &&
        (isGroup ? (
          <DmMemberList conversationId={conversationId} />
        ) : (
          avatarUser && (
            <DmProfilePanel conversationId={conversationId} userId={avatarUser.id} />
          )
        ))}

      {/* The wallpaper editor for a one-to-one DM. A group reaches the same
          component through its settings dialog. */}
      <Dialog open={editingBackground} onOpenChange={setEditingBackground}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Chat background</DialogTitle>
            <DialogDescription>
              A picture behind your messages. Both of you see it.
            </DialogDescription>
          </DialogHeader>
          <ChatDecorationEditor
            target={{ kind: "conversation", conversationId }}
            backgroundUrl={conversation.backgroundUrl}
            backgroundOpacity={conversation.backgroundOpacity}
          />
        </DialogContent>
      </Dialog>

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

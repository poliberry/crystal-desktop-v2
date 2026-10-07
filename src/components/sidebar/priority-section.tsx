"use client";

import { useMutation, useQuery } from "convex/react";
import {
  AtSign,
  Hash,
  MonitorUp,
  Phone,
  Reply,
  Star,
  StarOff,
  UserPlus,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { GroupAvatar } from "@/components/home/group-avatar";
import { useNavigation } from "@/components/home/navigation-context";
import { useTabs } from "@/components/home/tabs-context";
import { MessagePreview } from "@/components/message-preview";
import { CountBadge } from "@/components/sidebar/sidebar-section";
import { GLASS_BASE, GLASS_GOLD } from "@/components/sidebar/glass";
import { useOpenChannel } from "@/components/sidebar/use-open-channel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useCachedQuery } from "@/hooks/use-cached-query";
import { cn } from "@/lib/utils";

type Alert = NonNullable<ReturnType<typeof useQuery<typeof api.priority.alerts>>>[number];

const ALERT_ICON: Record<Alert["kind"], LucideIcon> = {
  friend_request: UserPlus,
  mention: AtSign,
  reply: Reply,
  call: Phone,
  stream: MonitorUp,
};

const ROW =
  "group relative flex w-full cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-left outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/10";

/** Something that can't wait: who it's from, what they did, and a way to
 * dismiss it. Clicking goes to where it happened. */
function AlertRow({ alert }: { alert: Alert }) {
  const nav = useNavigation();
  const markRead = useMutation(api.notifications.markRead);
  const Icon = ALERT_ICON[alert.kind];

  const dismiss = () => {
    if (alert.notificationId) void markRead({ notificationId: alert.notificationId });
  };

  const open = () => {
    if (alert.kind === "friend_request") {
      nav.goHome();
    } else if (alert.communityId && alert.channelId) {
      nav.openCommunity(alert.communityId, alert.channelId);
    } else if (alert.conversationId) {
      nav.openConversation(alert.conversationId);
    }
    // Looking at it is the answer to it; leaving it lit would nag.
    dismiss();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className={cn(ROW, "bg-black/20")}
    >
      <div className="relative shrink-0">
        <Avatar size="default">
          <AvatarImage src={alert.actorImageUrl ?? undefined} alt={alert.actorName ?? ""} />
          <AvatarFallback>{(alert.actorName ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-yellow-400 text-black ring-2 ring-black/40">
          <Icon className="size-2.5" />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold">{alert.title}</p>
        {alert.body && (
          <p className="flex truncate text-[11px] text-muted-foreground">
            <MessagePreview text={alert.body} />
          </p>
        )}
      </div>
      {alert.notificationId && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={(e) => {
            e.stopPropagation();
            dismiss();
          }}
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-white/10 hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function RemoveFromPriority({ onRemove }: { onRemove: () => void }) {
  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={onRemove}>
        <StarOff className="size-4" />
        Remove from Priority
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

function PriorityConversation({
  conversation,
}: {
  conversation: any;
}) {
  const conversationId = conversation.id as Id<"conversations">;
  const nav = useNavigation();
  const { activeTab } = useTabs();
  const setPriority = useMutation(api.priority.setConversation);

  const isGroup = conversation.type === "group";
  const other = conversation.members[0];
  const title = isGroup
    ? conversation.name || conversation.members.map((m: any) => m.name).join(", ")
    : (other?.name ?? "Unknown");
  const attachment = conversation.lastMessageAttachment;
  const body =
    conversation.lastMessageText ??
    (attachment ? (attachment.count > 1 ? `${attachment.count} files` : attachment.fileName) : null);
  const active =
    activeTab.target.type === "dm" && activeTab.target.conversationId === conversationId;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={() => nav.openConversation(conversationId)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              nav.openConversation(conversationId);
            }
          }}
          className={cn(ROW, active && "bg-white/15")}
        >
          {isGroup ? (
            <GroupAvatar size="default" imageUrl={conversation.imageUrl} members={conversation.members} />
          ) : (
            <Avatar size="default" className="rounded-md">
              <AvatarImage src={other?.imageUrl} alt={title} className="rounded-md" />
              <AvatarFallback>{title.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0 flex-1">
            <p className={cn("truncate text-sm", conversation.unread ? "font-semibold" : "font-medium")}>
              {title}
            </p>
            <p className="flex w-full truncate text-xs text-muted-foreground">
              {body ? (
                <MessagePreview
                  text={body}
                  prefix={`${conversation.lastMessageMine ? "Me:" : ""}${attachment ? "📎" : ""}`.trim() || undefined}
                />
              ) : (
                <span className="truncate">No messages yet</span>
              )}
            </p>
          </div>
          <CountBadge count={conversation.unreadCount} />
        </div>
      </ContextMenuTrigger>
      <RemoveFromPriority
        onRemove={() => void setPriority({ conversationId, priority: false })}
      />
    </ContextMenu>
  );
}

type PriorityChannel = Extract<
  NonNullable<ReturnType<typeof useQuery<typeof api.priority.list>>>[number],
  { kind: "channel" }
>;

function PriorityChannelRow({ item }: { item: PriorityChannel }) {
  const { activeTab } = useTabs();
  const openChannel = useOpenChannel();
  const setPriority = useMutation(api.priority.setChannel);
  const isVoice = item.channelType === "voice";
  const active =
    activeTab.target.type === "channel" && activeTab.target.channelId === item.channelId;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={() => openChannel(item.communityId, item.channelId, isVoice ? "voice" : "text")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openChannel(item.communityId, item.channelId, isVoice ? "voice" : "text");
            }
          }}
          className={cn(ROW, active && "bg-white/15")}
        >
          <Avatar size="default" className="rounded-md">
            <AvatarImage src={item.communityImageUrl ?? undefined} alt={item.communityName} className="rounded-md" />
            <AvatarFallback>{item.communityName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className={cn("flex items-center gap-1 truncate text-sm", item.unread ? "font-semibold" : "font-medium")}>
              {isVoice ? (
                <Volume2 className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <Hash className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{item.channelName}</span>
            </p>
            <p className="flex w-full truncate text-xs text-muted-foreground">
              {item.last ? (
                <MessagePreview
                  text={item.last.text || item.last.attachmentName || ""}
                  prefix={`${item.last.authorName}:${item.last.text ? "" : " 📎"}`}
                />
              ) : (
                <span className="truncate">{item.communityName}</span>
              )}
            </p>
          </div>
          {item.mentionCount > 0 ? (
            <CountBadge count={item.mentionCount} />
          ) : item.unread ? (
            <span aria-label="Unread messages" className="size-2 shrink-0 rounded-full bg-foreground" />
          ) : null}
        </div>
      </ContextMenuTrigger>
      <RemoveFromPriority
        onRemove={() => void setPriority({ channelId: item.channelId, priority: false })}
      />
    </ContextMenu>
  );
}

/**
 * The Priority card: DMs, groups and channels the user has marked as VIPs, but
 * only while one of them has something waiting — and the time-sensitive
 * notifications about those same conversations.
 *
 * Absent otherwise. A card that sat here permanently would be one more thing
 * to scroll past on the days nothing important is happening, and its absence
 * is itself the signal: when it appears, it is because a VIP needs you.
 * Marking something as a VIP is done from its right-click menu.
 */
export function PrioritySection() {
  const alerts = useQuery(api.priority.alerts);
  const items = useQuery(api.priority.list);
  const conversations =
    useCachedQuery(api.conversations.listMine, {}, "conversations.listMine") ?? [];

  const priorityConversationIds = new Set<string>();
  const priorityChannelIds = new Set<string>();
  for (const item of items ?? []) {
    if (item.kind === "conversation") priorityConversationIds.add(item.conversationId);
    else priorityChannelIds.add(item.channelId);
  }

  // What is actually waiting. A conversation is unread until it's opened; a
  // channel is waiting when it has unread messages or an unread mention.
  const waitingConversations = (items ?? []).flatMap((item) => {
    if (item.kind !== "conversation") return [];
    const conversation = conversations.find((c: any) => c.id === item.conversationId);
    return conversation?.unread ? [conversation as any] : [];
  });
  const waitingChannels = (items ?? []).flatMap((item) =>
    item.kind === "channel" && (item.unread || item.mentionCount > 0) ? [item] : [],
  );
  // Only the notifications that are about a VIP; a friend request or a mention
  // in an ordinary channel has the inbox.
  const priorityAlerts = (alerts ?? []).filter(
    (alert) =>
      (alert.conversationId && priorityConversationIds.has(alert.conversationId)) ||
      (alert.channelId && priorityChannelIds.has(alert.channelId)),
  );

  if (
    waitingConversations.length === 0 &&
    waitingChannels.length === 0 &&
    priorityAlerts.length === 0
  ) {
    return null;
  }

  return (
    <section className={cn(GLASS_BASE, GLASS_GOLD, "p-2")}>
      {/* A soft highlight in the corner the gradient starts from, so the card
          reads as lit glass rather than a flat tint. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-10 -left-10 size-32 rounded-full bg-yellow-200/20 blur-2xl"
      />
      <div className="relative flex flex-col gap-1">
        <div className="flex items-center gap-1.5 px-1 pb-0.5">
          <Star className="size-3.5 fill-yellow-300 text-yellow-300" />
          <span className="text-xs font-semibold tracking-wide text-yellow-100 uppercase">
            Priority
          </span>
        </div>

        {priorityAlerts.length > 0 && (
          <div className="flex flex-col gap-1">
            {priorityAlerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
          </div>
        )}

        {(waitingConversations.length > 0 || waitingChannels.length > 0) && (
          <div className="flex flex-col gap-0.5">
            {waitingConversations.map((conversation) => (
              <PriorityConversation key={conversation.id} conversation={conversation} />
            ))}
            {waitingChannels.map((item) => (
              <PriorityChannelRow key={item.channelId} item={item} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

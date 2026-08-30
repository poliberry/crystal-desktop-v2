"use client";

import { useQuery } from "convex/react";
import { SearchIcon, ShoppingBag, Sparkles, Users } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { GroupAvatar } from "@/components/home/group-avatar";
import { Nameplate } from "@/components/profile/nameplate";
import { NewDmDialog } from "@/components/home/new-dm-dialog";
import { SelectionPill } from "@/components/home/selection-pill";
import { UserCard } from "@/components/home/user-card";
import {
  Avatar,
  AvatarDecoration,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { MessagePreview } from "@/components/message-preview";
import { PresenceDot } from "@/components/presence-dot";
import {
  activitySummary,
  topActivity,
} from "@/components/rich-presence-card";
import { STATUS_LABEL, type FriendStatus } from "@/lib/presence";
import type { RichPresenceActivity } from "@/types/desktop-api";
import { useCachedQuery } from "@/hooks/use-cached-query";
import { cn } from "@/lib/utils";

interface NavSidebarProps {
  search: string;
  onSearchChange: (value: string) => void;
  isFriendsActive: boolean;
  activeConversationId: Id<"conversations"> | null;
  onSelectFriends: () => void;
  onSelectConversation: (id: Id<"conversations">) => void;
}

function matches(search: string, ...fields: string[]) {
  if (!search.trim()) return true;
  const needle = search.trim().toLowerCase();
  return fields.some((field) => field.toLowerCase().includes(needle));
}

const NOW_MS = () => Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

function DmListSkeleton() {
  return (
    <div className="flex flex-col gap-0.5">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-2.5 px-2 py-2">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-3.5" style={{ width: `${45 + (i % 3) * 15}%` }} />
            <Skeleton className="h-3" style={{ width: `${60 + (i % 2) * 20}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function NavSidebar({
  search,
  onSearchChange,
  isFriendsActive,
  activeConversationId,
  onSelectFriends,
  onSelectConversation,
}: NavSidebarProps) {
  const rawConversations = useCachedQuery(
    api.conversations.listMine,
    {},
    "conversations.listMine"
  );
  const conversations = rawConversations ?? [];
  const filtered = conversations.filter((c) =>
    matches(search, c.name ?? "", ...c.members.map((m) => m.name))
  );

  return (
    <div className="flex w-64 shrink-0 flex-col border-x backdrop-blur-xl shadow-md">
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="relative">
        <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-8"
        />
      </div>

      <nav className="flex flex-col gap-1">
        <Button
          variant={isFriendsActive ? "secondary" : "ghost"}
          className="justify-start gap-2"
          onClick={onSelectFriends}
        >
          <Users className="size-4" />
          Friends
        </Button>
        <Button variant="ghost" className="justify-start gap-2" disabled>
          <ShoppingBag className="size-4" />
          Marketplace
          <Badge variant="outline" className="ml-auto">
            Soon
          </Badge>
        </Button>
        <Button variant="ghost" className="justify-start gap-2" disabled>
          <Sparkles className="size-4" />
          Subscriptions
          <Badge variant="outline" className="ml-auto">
            Soon
          </Badge>
        </Button>
      </nav>

      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Direct messages
        </span>
        <NewDmDialog onCreated={onSelectConversation} />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 pr-2">
          {rawConversations === undefined ? (
            <DmListSkeleton />
          ) : filtered.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">No conversations yet.</p>
          ) : (
            filtered.map((conversation) => {
              const isGroup = conversation.type === "group";
              const title = isGroup
                ? conversation.name || conversation.members.map((m) => m.name).join(", ")
                : (conversation.members[0]?.name ?? "Unknown");
              const avatarUser = isGroup ? undefined : conversation.members[0];
              const active = conversation.id === activeConversationId;
              const otherMember = !isGroup ? conversation.members[0] : undefined;
              const isOffline = !isGroup && otherMember?.status === "offline";

              const lastMsgAt = conversation.lastMessageAt;
              const stale = lastMsgAt !== undefined && NOW_MS() - lastMsgAt > DAY_MS;
              // Hidden while they're offline: an icon for what they were last
              // playing is a claim about right now. Invisible needs no
              // separate check — presence resolves it to offline for everyone
              // but the user themselves.
              const activities = otherMember?.activities as RichPresenceActivity[] | undefined;
              const activity = !isGroup && !isOffline ? topActivity(activities) : null;

              // A conversation nobody has touched in a day is better described
              // by what the other person is up to than by a stale line of
              // chat. Their own words about it first, then whatever we can
              // detect, then just whether they're reachable. Someone offline
              // gets no presence line at all — their status, like their
              // activity, is a claim about right now, and being offline is
              // already said by the dimmed row and the presence dot.
              const presenceLine = isOffline
                ? null
                : otherMember?.customStatus ||
                  activitySummary(activity) ||
                  (otherMember ? STATUS_LABEL[otherMember.status as FriendStatus] : null);
              /**
               * The last thing said, or the last thing sent.
               *
               * A file with no words is still a message — the row used to say
               * "No messages yet" about a conversation whose last event was a
               * photo. The paperclip carries that, and when there are words
               * too they are what the line is for, so the clip just precedes
               * them.
               */
              const attachment = conversation.lastMessageAttachment;
              const attachmentText =
                attachment && !conversation.lastMessageText
                  ? attachment.count > 1
                    ? `${attachment.count} files`
                    : attachment.fileName
                  : null;
              const body = conversation.lastMessageText ?? attachmentText;
              // A day-old conversation is still better described by what the
              // other person is up to than by a stale line of chat, exactly as
              // before — the preview only speaks when the presence line
              // doesn't.
              const presenceWins = !isGroup && stale && !!presenceLine;
              const preview =
                body === null || presenceWins
                  ? null
                  : {
                      // "Me:" first, then the clip: whose turn it is is the
                      // first thing a one-line preview has to answer.
                      prefix: `${conversation.lastMessageMine ? "Me:" : ""}${
                        attachment ? "📎" : ""
                      }`.trim(),
                      body,
                    };
              const fallback =
                (!isGroup && stale ? presenceLine : null) ?? "No messages yet";

              return (
                <button
                  key={conversation.id}
                  onClick={() => onSelectConversation(conversation.id)}
                  className={cn(
                    "group relative flex items-center gap-2.5 overflow-hidden rounded-md px-2 py-2 text-left hover:bg-accent/60",
                    active && "bg-accent",
                    isOffline && !active && "opacity-60 hover:opacity-90"
                  )}
                >
                  {/* Same left-edge pill as the community rail: a stub for
                      unread, full row height for the DM you're reading. */}
                  <SelectionPill
                    state={active ? "active" : conversation.unread ? "unread" : "idle"}
                  />
                  {/* Nameplate behind the row, faded out towards the name so
                      it decorates rather than competes with it. */}
                  <Nameplate url={otherMember?.nameplateUrl} />
                  {isGroup ? (
                    <GroupAvatar size="default" imageUrl={conversation.imageUrl} members={conversation.members} />
                  ) : (
                    <Avatar size="default" className="relative rounded-md">
                      <AvatarImage src={avatarUser?.imageUrl} alt={title} className="rounded-md" />
                      <AvatarFallback>{title.slice(0, 2).toUpperCase()}</AvatarFallback>
                      <AvatarDecoration value={otherMember?.avatarDecoration} />
                      {/* The badge slot is presence's now — unread moved to
                          the pill on the left edge, so the two no longer
                          compete for the same corner of the avatar. */}
                      {otherMember && (
                        <PresenceDot
                          status={otherMember.status as FriendStatus}
                          activities={activities}
                          accent={otherMember.borderGradientStart}
                          isBirthday={otherMember.isBirthday}
                          decorated={!!otherMember.avatarDecoration}
                          className="absolute -right-0.5 -bottom-0.5 z-10"
                        />
                      )}
                    </Avatar>
                  )}
                  <div className="relative min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-sm",
                        conversation.unread ? "font-semibold" : "font-medium"
                      )}
                    >
                      {title}
                    </p>
                    <p className="flex w-42 items-center gap-1 truncate text-xs text-muted-foreground">
                      {preview ? (
                        <MessagePreview
                          text={preview.body}
                          prefix={preview.prefix || undefined}
                        />
                      ) : (
                        <span className="truncate">{fallback}</span>
                      )}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
      </div>
    </div>
  );
}

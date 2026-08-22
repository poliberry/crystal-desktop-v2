"use client";

import { useQuery } from "convex/react";
import { SearchIcon, ShoppingBag, Sparkles, Users } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { GroupAvatar } from "@/components/home/group-avatar";
import { NewDmDialog } from "@/components/home/new-dm-dialog";
import { UserCard } from "@/components/home/user-card";
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
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
  const rawConversations = useQuery(api.conversations.listMine);
  const conversations = rawConversations ?? [];
  const filtered = conversations.filter((c) =>
    matches(search, c.name ?? "", ...c.members.map((m) => m.name))
  );

  return (
    <div className="flex w-64 shrink-0 flex-col m-2 bg-accent/40 backdrop-blur-xl shadow-md rounded-2xl">
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
              const subtitle =
                !isGroup && stale && !isOffline && otherMember?.customStatus
                  ? otherMember.customStatus
                  : (conversation.lastMessageText ?? "No messages yet");

              return (
                <button
                  key={conversation.id}
                  onClick={() => onSelectConversation(conversation.id)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-accent/60",
                    active && "bg-accent",
                    isOffline && !active && "opacity-60 hover:opacity-90"
                  )}
                >
                  {isGroup ? (
                    <GroupAvatar size="sm" imageUrl={conversation.imageUrl} members={conversation.members} />
                  ) : (
                    <Avatar size="sm">
                      <AvatarImage src={avatarUser?.imageUrl} alt={title} />
                      <AvatarFallback>{title.slice(0, 2).toUpperCase()}</AvatarFallback>
                      {conversation.unread && <AvatarBadge className="bg-primary" />}
                    </Avatar>
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-sm",
                        conversation.unread ? "font-semibold" : "font-medium"
                      )}
                    >
                      {title}
                    </p>
                    <p className="truncate w-46 text-xs text-muted-foreground">{subtitle}</p>
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

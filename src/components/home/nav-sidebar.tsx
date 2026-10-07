"use client";

import { SearchIcon, ShoppingBag, Sparkles } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DmConversationRow, DmListSkeleton } from "@/components/home/dm-conversation-row";
import { NewDmDialog } from "@/components/home/new-dm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useCachedQuery } from "@/hooks/use-cached-query";
import { cn } from "@/lib/utils";
import { UsersIcon } from "@animateicons/react/lucide";
import { useUiPreferences } from "../ui-preferences-provider";

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

export function NavSidebar({
  search,
  onSearchChange,
  isFriendsActive,
  activeConversationId,
  onSelectFriends,
  onSelectConversation,
}: NavSidebarProps) {
  const { communityNavStyle } = useUiPreferences();
  const rawConversations = useCachedQuery(
    api.conversations.listMine,
    {},
    "conversations.listMine",
  );
  const conversations = rawConversations ?? [];
  const filtered = conversations.filter((c: any) =>
    matches(search, c.name ?? "", ...c.members.map((m: any) => m.name)),
  );
  const compact = communityNavStyle !== "rail";

  return (
    <div className={cn(compact ? "w-80" : "w-64","flex shrink-0 flex-col border-x border-t rounded-tl-xl bg-background shadow-md")}>
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
            <UsersIcon duration={0.8} className="size-4" />
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
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                No conversations yet.
              </p>
            ) : (
              filtered.map((conversation: any) => (
                <DmConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === activeConversationId}
                  onSelect={onSelectConversation}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

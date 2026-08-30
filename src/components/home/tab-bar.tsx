"use client";

import { useQuery } from "convex/react";
import { Hash, Home, Pin, PinOff, X } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { GroupAvatar } from "@/components/home/group-avatar";
import { type Tab, useTabs } from "@/components/home/tabs-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

function DmTabLabel({ conversationId }: { conversationId: Id<"conversations"> }) {
  const conversation = useQuery(api.conversations.get, { conversationId });
  if (!conversation) return <span className="truncate">Direct message</span>;

  const isGroup = conversation.type === "group";
  const title = isGroup
    ? conversation.name || conversation.members.map((m) => m.name).join(", ")
    : (conversation.members[0]?.name ?? "Unknown");

  return (
    <>
      {isGroup ? (
        <GroupAvatar size="sm" imageUrl={conversation.imageUrl} members={conversation.members} />
      ) : (
        <Avatar size="sm" className="size-4 rounded-md">
          <AvatarImage src={conversation.members[0]?.imageUrl} alt={title} className="rounded-md" />
          <AvatarFallback className="text-[8px]">{title.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      )}
      <span className="truncate">{title}</span>
    </>
  );
}

function ChannelTabLabel({ channelId }: { channelId: Id<"channels"> }) {
  const channel = useQuery(api.channels.get, { channelId });
  const community = useQuery(
    api.communities.get,
    channel ? { communityId: channel.communityId } : "skip"
  );
  const communityName = channel?.communityName ?? "…";
  const channelName = channel?.name ?? "channel";

  return (
    <>
      <Avatar size="sm" className="size-4 shrink-0">
        <AvatarImage src={community?.imageUrl} alt={communityName} className="rounded-md" />
        <AvatarFallback className="text-[8px]">{communityName.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 items-center gap-1">
        <span className="max-w-20 shrink-0 truncate text-muted-foreground">{communityName}</span>
        <span className="shrink-0 text-muted-foreground/60">|</span>
        <span className="flex min-w-0 items-center gap-0.5">
          <Hash className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{channelName}</span>
        </span>
      </span>
    </>
  );
}

function TabLabel({ tab }: { tab: Tab }) {
  switch (tab.target.type) {
    case "home":
      return (
        <>
          <Home className="size-3.5 shrink-0" />
          <span className="truncate">Home</span>
        </>
      );
    case "dm":
      return <DmTabLabel conversationId={tab.target.conversationId} />;
    case "channel":
      return <ChannelTabLabel channelId={tab.target.channelId} />;
  }
}

function TabButton({ tab }: { tab: Tab }) {
  const { activeTabId, activateTab, closeTab, togglePinTab } = useTabs();
  const isHome = tab.target.type === "home";
  const isActive = tab.id === activeTabId;

  return (
    <div
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      className={cn(
        "group flex h-7 max-w-56 min-w-0 items-center gap-1 rounded-md py-1 pr-1 pl-0 text-xs transition-colors",
        isActive ? "bg-background text-foreground" : "text-muted-foreground hover:bg-accent/60"
      )}
    >
      <button
        type="button"
        onClick={() => activateTab(tab.id)}
        className="flex min-w-0 flex-1 items-center gap-1.5"
      >
        <TabLabel tab={tab} />
      </button>
      {!isHome && (
        <>
          <button
            type="button"
            onClick={() => togglePinTab(tab.id)}
            title={tab.pinned ? "Unpin tab" : "Pin tab"}
            className={cn(
              "shrink-0 rounded p-0.5 hover:bg-accent",
              tab.pinned ? "opacity-70" : "opacity-0 group-hover:opacity-100"
            )}
          >
            {tab.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
          </button>
          <button
            type="button"
            onClick={() => closeTab(tab.id)}
            title="Close tab"
            className="shrink-0 rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </>
      )}
    </div>
  );
}

/** Browser-like tab bar under the top nav — each tab is a DM, a channel, or
 * the pinned Home tab. See `tabs-context.tsx` for the (client-side-only)
 * virtual routing backing this. */
export function TabBar() {
  const { tabs } = useTabs();

  return (
    <div
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto"
    >
      {tabs.map((tab) => (
        <TabButton key={tab.id} tab={tab} />
      ))}
    </div>
  );
}

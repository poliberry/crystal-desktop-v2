"use client";

import { useState } from "react";

import { ChatView } from "@/components/home/chat-view";
import { CommunityRail } from "@/components/home/community-rail";
import { DmCallView } from "@/components/home/dm-call-view";
import { FriendsPanel } from "@/components/home/friends-panel";
import { NavSidebar } from "@/components/home/nav-sidebar";
import type { Id } from "../../../convex/_generated/dataModel";

type View = "friends" | "dm" | "call";

export function HomeLayout() {
  const [view, setView] = useState<View>("friends");
  const [activeConversationId, setActiveConversationId] = useState<Id<"conversations"> | null>(
    null
  );
  const [search, setSearch] = useState("");

  const openConversation = (id: Id<"conversations">) => {
    setActiveConversationId(id);
    setView("dm");
  };

  if (view === "call" && activeConversationId) {
    return <DmCallView conversationId={activeConversationId} onBack={() => setView("dm")} />;
  }

  return (
    <div className="flex h-full">
      <CommunityRail />
      <NavSidebar
        search={search}
        onSearchChange={setSearch}
        isFriendsActive={view === "friends"}
        activeConversationId={view === "dm" ? activeConversationId : null}
        onSelectFriends={() => setView("friends")}
        onSelectConversation={openConversation}
      />
      {view === "dm" && activeConversationId ? (
        <ChatView conversationId={activeConversationId} onStartCall={() => setView("call")} />
      ) : (
        <FriendsPanel search={search} onMessageFriend={openConversation} />
      )}
    </div>
  );
}

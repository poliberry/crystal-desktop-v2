"use client";

import { useState } from "react";

import { CallStage } from "@/components/call/call-stage";
import { useCall } from "@/components/call/call-provider";
import { ChatView } from "@/components/home/chat-view";
import { CommunityRail } from "@/components/home/community-rail";
import { FriendsPanel } from "@/components/home/friends-panel";
import { NavSidebar } from "@/components/home/nav-sidebar";
import type { Id } from "../../../convex/_generated/dataModel";

type View = "friends" | "dm";

export function HomeLayout() {
  const [view, setView] = useState<View>("friends");
  const [activeConversationId, setActiveConversationId] = useState<Id<"conversations"> | null>(
    null
  );
  const [search, setSearch] = useState("");
  const { activeCall, expanded, joinCall, collapse } = useCall();

  // Navigating anywhere always shows that content — an in-progress call
  // keeps running (see the mini bar) but stops being the focused pane.
  const openConversation = (id: Id<"conversations">) => {
    setActiveConversationId(id);
    setView("dm");
    collapse();
  };

  const selectFriends = () => {
    setView("friends");
    collapse();
  };

  const showCallStage = expanded && !!activeCall;

  return (
    <div className="flex h-full">
      <CommunityRail />
      <NavSidebar
        search={search}
        onSearchChange={setSearch}
        isFriendsActive={view === "friends"}
        activeConversationId={view === "dm" ? activeConversationId : null}
        onSelectFriends={selectFriends}
        onSelectConversation={openConversation}
      />
      {showCallStage ? (
        <CallStage />
      ) : view === "dm" && activeConversationId ? (
        <ChatView
          conversationId={activeConversationId}
          onStartCall={() => void joinCall(activeConversationId)}
        />
      ) : (
        <FriendsPanel search={search} onMessageFriend={openConversation} />
      )}
    </div>
  );
}

"use client";

import { useState } from "react";

import { CallStage } from "@/components/call/call-stage";
import { useCall } from "@/components/call/call-provider";
import { ChatView } from "@/components/home/chat-view";
import { CommunityRail } from "@/components/home/community-rail";
import { FriendsPanel } from "@/components/home/friends-panel";
import { NavSidebar } from "@/components/home/nav-sidebar";
import { Button } from "@/components/ui/button";
import type { Id } from "../../../convex/_generated/dataModel";

type View = "friends" | "dm";

export function HomeLayout() {
  const [view, setView] = useState<View>("friends");
  const [activeConversationId, setActiveConversationId] = useState<Id<"conversations"> | null>(
    null
  );
  const [search, setSearch] = useState("");
  const { activeCall, expanded, joinCall, collapse, joinError, dismissJoinError } = useCall();

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
        <div className="flex min-w-0 flex-1 flex-col">
          {joinError && (
            <div className="flex items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span className="min-w-0 flex-1">{joinError}</span>
              <Button variant="ghost" size="sm" onClick={dismissJoinError}>
                Dismiss
              </Button>
            </div>
          )}
          <ChatView
            conversationId={activeConversationId}
            onStartCall={() => {
              dismissJoinError();
              void joinCall(activeConversationId);
            }}
          />
        </div>
      ) : (
        <FriendsPanel search={search} onMessageFriend={openConversation} />
      )}
    </div>
  );
}

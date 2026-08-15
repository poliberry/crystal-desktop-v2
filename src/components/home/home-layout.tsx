"use client";

import { useEffect, useState } from "react";

import { CallStage } from "@/components/call/call-stage";
import { useCall } from "@/components/call/call-provider";
import { ChannelView } from "@/components/community/channel-view";
import { CommunitySidebar } from "@/components/community/community-sidebar";
import { ChatView } from "@/components/home/chat-view";
import { CommunityRail } from "@/components/home/community-rail";
import { FriendsPanel } from "@/components/home/friends-panel";
import { NavSidebar } from "@/components/home/nav-sidebar";
import { useNavigation, useRegisterNavigation } from "@/components/home/navigation-context";
import { getDesktopAPI } from "@/lib/desktop";
import type { Id } from "../../../convex/_generated/dataModel";

type DmView = "friends" | "dm";

export function HomeLayout() {
  const [dmView, setDmView] = useState<DmView>("friends");
  const [activeConversationId, setActiveConversationId] = useState<Id<"conversations"> | null>(
    null
  );
  const [search, setSearch] = useState("");

  const [selectedCommunityId, setSelectedCommunityId] = useState<Id<"communities"> | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<Id<"channels"> | null>(null);

  const { activeCall, expanded, joinDmCall, joinChannelCall, collapse } = useCall();

  // Navigating anywhere always shows that content — an in-progress call
  // keeps running (see the mini bar) but stops being the focused pane.
  const openConversation = (id: Id<"conversations">) => {
    setActiveConversationId(id);
    setDmView("dm");
    setSelectedCommunityId(null);
    collapse();
  };

  const selectFriends = () => {
    setDmView("friends");
    setSelectedCommunityId(null);
    collapse();
  };

  const selectCommunity = (id: Id<"communities">, channelId?: Id<"channels">) => {
    setSelectedCommunityId(id);
    setSelectedChannelId(channelId ?? null);
    collapse();
  };

  const selectChannel = (channelId: Id<"channels">, type: "text" | "voice") => {
    if (type === "voice") {
      if (selectedCommunityId) void joinChannelCall(channelId, selectedCommunityId);
      return;
    }
    setSelectedChannelId(channelId);
    collapse();
  };

  useRegisterNavigation({ openConversation, openCommunity: selectCommunity });

  const nav = useNavigation();

  // Tells the Electron main process what's on screen right now, so the
  // background notifier (electron/backgroundNotifier.ts) doesn't also pop an
  // OS notification for the conversation/channel you're already looking at.
  useEffect(() => {
    const view =
      dmView === "dm" && activeConversationId
        ? { kind: "conversation" as const, id: activeConversationId }
        : selectedCommunityId && selectedChannelId
          ? { kind: "channel" as const, id: selectedChannelId }
          : null;
    void getDesktopAPI()?.notifications.setActiveView(view);
  }, [dmView, activeConversationId, selectedCommunityId, selectedChannelId]);

  // Clicking a background notification lands here.
  useEffect(() => {
    return getDesktopAPI()?.notifications.onNavigate((target) => {
      if (target.kind === "conversation") {
        nav.openConversation(target.conversationId as Id<"conversations">);
      } else {
        nav.openCommunity(target.communityId as Id<"communities">, target.channelId as Id<"channels">);
      }
    });
  }, [nav]);

  const showCallStage = expanded && !!activeCall;

  return (
    <div className="flex h-full">
      <CommunityRail
        selectedCommunityId={selectedCommunityId}
        onSelectHome={selectFriends}
        onSelectCommunity={selectCommunity}
      />

      {selectedCommunityId ? (
        <CommunitySidebar
          communityId={selectedCommunityId}
          selectedChannelId={selectedChannelId}
          onSelectChannel={selectChannel}
        />
      ) : (
        <NavSidebar
          search={search}
          onSearchChange={setSearch}
          isFriendsActive={dmView === "friends"}
          activeConversationId={dmView === "dm" ? activeConversationId : null}
          onSelectFriends={selectFriends}
          onSelectConversation={openConversation}
        />
      )}

      {showCallStage ? (
        <CallStage />
      ) : selectedCommunityId && selectedChannelId ? (
        <ChannelView channelId={selectedChannelId} />
      ) : selectedCommunityId ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Select a channel
        </div>
      ) : dmView === "dm" && activeConversationId ? (
        <ChatView
          conversationId={activeConversationId}
          onStartCall={() => void joinDmCall(activeConversationId)}
        />
      ) : (
        <FriendsPanel search={search} onMessageFriend={openConversation} />
      )}
    </div>
  );
}

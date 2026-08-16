"use client";

import { useEffect, useState } from "react";

import { CallStage } from "@/components/call/call-stage";
import { useCall } from "@/components/call/call-provider";
import { ChannelView } from "@/components/community/channel-view";
import { CommunitySidebar } from "@/components/community/community-sidebar";
import { ChatView } from "@/components/home/chat-view";
import { FriendsPanel } from "@/components/home/friends-panel";
import { NavSidebar } from "@/components/home/nav-sidebar";
import { useNavigation, useRegisterNavigation } from "@/components/home/navigation-context";
import { Button } from "@/components/ui/button";
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

  const { activeCall, expanded, joinDmCall, joinChannelCall, expand, collapse, joinError, dismissJoinError } = useCall();

  // Navigation never collapses an active call — the call stage stays visible
  // until the user explicitly clicks "Back" in the call stage or disconnects.
  // collapse() is only called by the call stage's own back button and leaveCall.
  const openConversation = (id: Id<"conversations">) => {
    setActiveConversationId(id);
    setDmView("dm");
    setSelectedCommunityId(null);
  };

  const selectFriends = () => {
    setDmView("friends");
    setSelectedCommunityId(null);
  };

  const selectCommunity = (id: Id<"communities">, channelId?: Id<"channels">) => {
    setSelectedCommunityId(id);
    setSelectedChannelId(channelId ?? null);
  };

  const selectChannel = (channelId: Id<"channels">, type: "text" | "voice") => {
    if (type === "voice") {
      if (!selectedCommunityId) return;
      // Already connected — just expand back to the full call stage
      if (activeCall?.kind === "channel" && activeCall.channelId === channelId) {
        expand();
        return;
      }
      dismissJoinError();
      void joinChannelCall(channelId, selectedCommunityId);
      return;
    }
    setSelectedChannelId(channelId);
    collapse();
  };

  useRegisterNavigation({ openConversation, openCommunity: selectCommunity, goHome: selectFriends });

  const nav = useNavigation();

  const showCallStage = expanded && !!activeCall;

  // Tells the Electron main process what's on screen right now, so the
  // background notifier (electron/backgroundNotifier.ts) doesn't also pop an
  // OS notification for the conversation/channel you're already looking at.
  // While the call stage is expanded it covers whatever conversation/channel
  // was selected underneath it, so this must report null there — otherwise
  // messages in that now-hidden conversation/channel get silently suppressed.
  useEffect(() => {
    const view = showCallStage
      ? null
      : dmView === "dm" && activeConversationId
        ? { kind: "conversation" as const, id: activeConversationId }
        : selectedCommunityId && selectedChannelId
          ? { kind: "channel" as const, id: selectedChannelId }
          : null;
    void getDesktopAPI()?.notifications.setActiveView(view);
  }, [showCallStage, dmView, activeConversationId, selectedCommunityId, selectedChannelId]);

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

  return (
    <div className={`flex h-full ${selectedCommunityId && "bg-[url('/backgrounds/chat-bkg.jpg')] bg-cover bg-center"}`}>
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
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {joinError && (
            <div className="flex items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span className="min-w-0 flex-1">{joinError}</span>
              <Button variant="ghost" size="sm" onClick={dismissJoinError}>
                Dismiss
              </Button>
            </div>
          )}

          {selectedCommunityId && selectedChannelId ? (
            <ChannelView channelId={selectedChannelId} />
          ) : selectedCommunityId ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Select a channel
            </div>
          ) : dmView === "dm" && activeConversationId ? (
            <ChatView
              conversationId={activeConversationId}
              onStartCall={() => {
                dismissJoinError();
                void joinDmCall(activeConversationId);
              }}
            />
          ) : (
            <FriendsPanel search={search} onMessageFriend={openConversation} />
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

import { CallPip } from "@/components/call/call-pip";
import { CallStage } from "@/components/call/call-stage";
import { useCall } from "@/components/call/call-provider";
import { ChannelView } from "@/components/community/channel-view";
import { CommunityMembersSection } from "@/components/community/community-members-section";
import { ServerOverview } from "@/components/community/server-overview";
import { CommunitySidebar } from "@/components/community/community-sidebar";
import { ChatView } from "@/components/home/chat-view";
import { useUiPreferences } from "@/components/ui-preferences-provider";
import { CommunityRail } from "@/components/home/community-rail";
import { FriendsPanel } from "@/components/home/friends-panel";
import { NavSidebar } from "@/components/home/nav-sidebar";
import { useNavigation, useRegisterNavigation } from "@/components/home/navigation-context";
import { type TabTarget, useTabs } from "@/components/home/tabs-context";
import { WindowTitle } from "@/components/home/window-title";
import { Button } from "@/components/ui/button";
import { getDesktopAPI } from "@/lib/desktop";
import type { Id } from "../../../convex/_generated/dataModel";
import { UserCard } from "./user-card";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useUser } from "@clerk/react";

export function HomeLayout() {
  const { user } = useUser();
  const [search, setSearch] = useState("");
  const [pendingCommunityId, setPendingCommunityId] = useState<Id<"communities"> | null>(null);
  const pendingModeRef = useRef<"replace" | "new">("new");
  const [overviewFor, setOverviewFor] = useState<Id<"communities"> | null>(null);
  const [membersSection, setMembersSection] = useState(false);

  const { activeCall, expanded, joinDmCall, joinChannelCall, expand, collapse, joinError, dismissJoinError } = useCall();
  const { tabs, activeTab, openTab, activateTab, closeTab } = useTabs();
  const { communityNavStyle, tabsEnabled } = useUiPreferences();
  const target = activeTab.target;

  const browsingCommunityId: Id<"communities"> | null =
    pendingCommunityId ?? (target.type === "channel" ? target.communityId : null);
  const getOrCreateStripeUser = useAction(api.users.createOrGetStripeUser);
  const myPermissions = useQuery(
    api.roles.myPermissions,
    browsingCommunityId ? { communityId: browsingCommunityId } : "skip",
  ) ?? 0;

  useEffect(() => {
    setPendingCommunityId(null);
    setOverviewFor(null);
    setMembersSection(false);
    if (user?.organizationMemberships?.[0]?.organization.id === "org_3IfKYp4cyTPeYWtsN12lj8VWVKc") {
      getOrCreateStripeUser();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab.id]);

  const collapseIfCovering = () => {
    if (expanded && activeCall) collapse();
  };

  const navigateTo = (next: TabTarget) => {
    if (!tabsEnabled) {
      for (const tab of tabs) {
        if (tab.target.type !== "home") closeTab(tab.id);
      }
    }
    collapseIfCovering();
    openTab(next);
  };

  const shownTabId = useRef(activeTab.id);
  useEffect(() => {
    if (shownTabId.current === activeTab.id) return;
    shownTabId.current = activeTab.id;
    collapse();
  }, [activeTab.id, collapse]);

  const openConversation = (id: Id<"conversations">) => {
    setPendingCommunityId(null);
    navigateTo({ type: "dm", conversationId: id });
  };

  const selectFriends = () => {
    setPendingCommunityId(null);
    setMembersSection(false);
    navigateTo({ type: "home" });
  };

  const openCommunityChannel = (
    communityId: Id<"communities">,
    channelId: Id<"channels">,
    mode: "replace" | "new"
  ) => {
    const target: TabTarget = { type: "channel", communityId, channelId };
    if (!tabsEnabled) {
      navigateTo(target);
      return;
    }
    const effectiveMode = mode === "replace" && activeTab.pinned ? "new" : mode;
    if (effectiveMode === "replace" && activeTab.id !== "home") {
      closeTab(activeTab.id);
    }
    collapseIfCovering();
    openTab(target);
  };

  const openCommunity = (
    id: Id<"communities">,
    channelId: Id<"channels"> | undefined,
    mode: "replace" | "new"
  ) => {
    setMembersSection(false);
    if (channelId) {
      openCommunityChannel(id, channelId, mode);
      return;
    }
    const existing = tabs.find((t) => t.target.type === "channel" && t.target.communityId === id);
    if (existing) {
      collapseIfCovering();
      activateTab(existing.id);
      return;
    }

    pendingModeRef.current = mode;
    setMembersSection(false);
    setPendingCommunityId(id);
    collapse();
  };

  const selectCommunity = (id: Id<"communities">, channelId?: Id<"channels">) => {
    openCommunity(id, channelId, "new");
  };

  const selectCommunityFromRail = (id: Id<"communities">, mode: "replace" | "new" = "replace") => {
    openCommunity(id, undefined, mode);
  };

  const selectChannel = (channelId: Id<"channels">, type: "text" | "voice") => {
    if (!browsingCommunityId) return;
    // Picking a channel is how you leave the overview.
    setOverviewFor(null);
    setMembersSection(false);
    if (type === "voice") {
      // Already connected — just expand back to the full call stage
      if (activeCall?.kind === "channel" && activeCall.channelId === channelId) {
        expand();
        return;
      }
      dismissJoinError();
      void joinChannelCall(channelId, browsingCommunityId);
      return;
    }
    const mode = pendingCommunityId === browsingCommunityId ? pendingModeRef.current : "new";
    openCommunityChannel(browsingCommunityId, channelId, mode);
    collapse();
  };

  useRegisterNavigation({ openConversation, openCommunity: selectCommunity, goHome: selectFriends });

  const nav = useNavigation();

  const showCallStage = expanded && !!activeCall;

  useEffect(() => {
    const view = showCallStage
      ? null
      : target.type === "dm"
        ? { kind: "conversation" as const, id: target.conversationId }
        : target.type === "channel"
          ? { kind: "channel" as const, id: target.channelId }
          : null;
    void getDesktopAPI()?.notifications.setActiveView(view);
  }, [showCallStage, target]);

  useEffect(() => {
    return getDesktopAPI()?.notifications.onNavigate((notif) => {
      if (notif.kind === "conversation") {
        nav.openConversation(notif.conversationId as Id<"conversations">);
      } else {
        nav.openCommunity(notif.communityId as Id<"communities">, notif.channelId as Id<"channels">);
      }
    });
  }, [nav]);

  const openCommunityIds = new Set(
    tabs.flatMap((t) => (t.target.type === "channel" ? [t.target.communityId] : []))
  );

  const showCommunityPlaceholder =
    browsingCommunityId !== null && !(target.type === "channel" && target.communityId === browsingCommunityId);

  const showOverview =
    overviewFor !== null && overviewFor === browsingCommunityId;

  return (
    <div className={`flex h-full`}>
      <WindowTitle target={target} />

      {communityNavStyle === "rail" && (
        <CommunityRail
          selectedCommunityId={browsingCommunityId}
          onSelectHome={selectFriends}
          onSelectCommunity={selectCommunityFromRail}
          canOpenInCurrentTab={!tabsEnabled || !activeTab.pinned}
          openCommunityIds={openCommunityIds}
        />
      )}

      {browsingCommunityId ? (
        <CommunitySidebar
          communityId={browsingCommunityId}
          selectedChannelId={
            !membersSection && target.type === "channel" && target.communityId === browsingCommunityId ? target.channelId : null
          }
          onSelectMembers={() => { setMembersSection(true); setOverviewFor(null); collapseIfCovering(); }}
          membersSelected={membersSection}
          onSelectChannel={selectChannel}
          onSelectOverview={() => { setMembersSection(false); setOverviewFor(browsingCommunityId); }}
          overviewSelected={showOverview}
        />
      ) : (
        <NavSidebar
          search={search}
          onSearchChange={setSearch}
          isFriendsActive={target.type === "home"}
          activeConversationId={target.type === "dm" ? target.conversationId : null}
          onSelectFriends={selectFriends}
          onSelectConversation={openConversation}
        />
      )}
      {activeCall && (
        <div className={showCallStage ? "flex min-h-0 min-w-0 flex-1 flex-col border-t" : "hidden"}>
          <CallStage />
        </div>
      )}
      {!showCallStage && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t">
          {joinError && (
            <div className="flex items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span className="min-w-0 flex-1">{joinError}</span>
              <Button variant="ghost" size="sm" onClick={dismissJoinError}>
                Dismiss
              </Button>
            </div>
          )}

          {/* Checked first: the overview covers whatever channel tab is
              active, and is dismissed by picking a channel. */}
          {membersSection && browsingCommunityId ? (
            <CommunityMembersSection
              communityId={browsingCommunityId}
              permissions={myPermissions}
            />
          ) : showOverview && browsingCommunityId ? (
            <ServerOverview
              communityId={browsingCommunityId}
              onOpenChannel={(channelId) => selectChannel(channelId, "text")}
            />
          ) : target.type === "channel" ? (
            <ChannelView channelId={target.channelId} />
          ) : showCommunityPlaceholder && browsingCommunityId ? (
            // Where "Select a channel" used to be. A server's overview is
            // exactly what belongs in the moment somebody has opened it and
            // hasn't chosen anything yet — and it still says "pick a channel"
            // when nobody has set one up.
            <ServerOverview
              communityId={browsingCommunityId}
              onOpenChannel={(channelId) =>
                openCommunityChannel(browsingCommunityId, channelId, "replace")
              }
            />
          ) : target.type === "dm" ? (
            <ChatView
              conversationId={target.conversationId}
              onStartCall={({ silent }) => {
                dismissJoinError();
                void joinDmCall(target.conversationId, { ring: !silent });
              }}
            />
          ) : (
            <FriendsPanel search={search} onMessageFriend={openConversation} />
          )}
        </div>
      )}

      <UserCard />

      {/* The call's mini player, while the call screen is collapsed. Rendered
          here rather than by CallProvider so the provider doesn't have to
          import a component that reads its own context back out. */}
      <CallPip />
    </div>
  );
}

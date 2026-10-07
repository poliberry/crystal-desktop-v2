"use client";

import { useEffect, useRef, useState } from "react";

import { CallPip } from "@/components/call/call-pip";
import { CallStage } from "@/components/call/call-stage";
import { useCall } from "@/components/call/call-provider";
import { CommunityFinaleHost } from "@/components/community/community-finale-host";
import { ChannelView } from "@/components/community/channel-view";
import { CommunityMembersSection } from "@/components/community/community-members-section";
import { ServerOverview } from "@/components/community/server-overview";
import { ChatView } from "@/components/home/chat-view";
import { useUiPreferences } from "@/components/ui-preferences-provider";
import { FriendsPanel } from "@/components/home/friends-panel";
import { useNavigation, useRegisterNavigation } from "@/components/home/navigation-context";
import { type PageTarget, type TabTarget, isPageTarget, useTabs } from "@/components/home/tabs-context";
import { WindowTitle } from "@/components/home/window-title";
import { PageHost } from "@/components/pages/page-host";
import { usePage } from "@/components/pages/page-context";
import { Button } from "@/components/ui/button";
import { getDesktopAPI } from "@/lib/desktop";
import type { Id } from "../../../convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

export function HomeLayout() {
  const [pendingCommunityId, setPendingCommunityId] = useState<Id<"communities"> | null>(null);
  const pendingModeRef = useRef<"replace" | "new">("new");
  const [overviewFor, setOverviewFor] = useState<Id<"communities"> | null>(null);
  const [membersSection, setMembersSection] = useState(false);

  const { activeCall, expanded, joinDmCall, joinChannelCall, expand, collapse, joinError, dismissJoinError } = useCall();
  const { tabs, activeTab, openTab, activateTab, closeTab, leavePage } = useTabs();
  const { page } = usePage();
  const { tabsEnabled } = useUiPreferences();
  const target = activeTab.target;

  const browsingCommunityId: Id<"communities"> | null =
    pendingCommunityId ?? (target.type === "channel" ? target.communityId : null);
  const myPermissions = useQuery(
    api.roles.myPermissions,
    browsingCommunityId ? { communityId: browsingCommunityId } : "skip",
  ) ?? 0;

  // Set by a navigation that steps off a page *and* sets one of the states
  // below in the same breath: the tab changes as a result, and the reset that
  // follows every tab change would wipe what it just set.
  const keepViewState = useRef(false);

  useEffect(() => {
    if (keepViewState.current) {
      keepViewState.current = false;
      return;
    }
    setPendingCommunityId(null);
    setOverviewFor(null);
    setMembersSection(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab.id]);

  // A server's front page, members list and not-yet-picked-channel view are
  // all drawn in place of a place's own content, so they can't be drawn over a
  // page. Step back to the last place first, leaving the page open in its tab.
  const stepOffPage = () => {
    if (!isPageTarget(target)) return;
    keepViewState.current = true;
    leavePage();
  };

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
    // A pinned tab, or a page, is never the thing a channel replaces.
    const effectiveMode =
      mode === "replace" && (activeTab.pinned || isPageTarget(activeTab.target)) ? "new" : mode;
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
      // The sidebar can open a channel in a server other than the one being
      // browsed, or the one that's already the active tab — neither changes the
      // tab, so the reset on tab change never runs. Clear them here instead.
      setPendingCommunityId(null);
      setOverviewFor(null);
      openCommunityChannel(id, channelId, mode);
      return;
    }
    const existing = tabs.find((t) => t.target.type === "channel" && t.target.communityId === id);
    if (existing) {
      collapseIfCovering();
      activateTab(existing.id);
      return;
    }

    stepOffPage();
    pendingModeRef.current = mode;
    setMembersSection(false);
    setPendingCommunityId(id);
    collapse();
  };

  const selectCommunity = (id: Id<"communities">, channelId?: Id<"channels">) => {
    openCommunity(id, channelId, "new");
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

  // Show a view of a server that isn't a channel. When the active tab is
  // already one of its channels the server is being browsed; otherwise it has
  // to be made the pending one first, or `showOverview` has nothing to match.
  const browseCommunity = (id: Id<"communities">) => {
    stepOffPage();
    if (target.type === "channel" && target.communityId === id) {
      setPendingCommunityId(null);
    } else {
      pendingModeRef.current = "new";
      setPendingCommunityId(id);
    }
    collapseIfCovering();
  };

  const openCommunityOverview = (id: Id<"communities">) => {
    setMembersSection(false);
    browseCommunity(id);
    setOverviewFor(id);
  };

  const openCommunityMembers = (id: Id<"communities">) => {
    setOverviewFor(null);
    browseCommunity(id);
    setMembersSection(true);
  };

  const openPage = (next: PageTarget) => navigateTo(next);

  useRegisterNavigation({
    openConversation,
    openCommunity: selectCommunity,
    goHome: selectFriends,
    openCommunityOverview,
    openCommunityMembers,
    openPage,
  });

  const nav = useNavigation();

  const showCallStage = expanded && !!activeCall;

  useEffect(() => {
    // Neither the call screen nor a page is showing the conversation, so a
    // message in it is news.
    const view = showCallStage || page
      ? null
      : target.type === "dm"
        ? { kind: "conversation" as const, id: target.conversationId }
        : target.type === "channel"
          ? { kind: "channel" as const, id: target.channelId }
          : null;
    void getDesktopAPI()?.notifications.setActiveView(view);
  }, [showCallStage, page, target]);

  useEffect(() => {
    return getDesktopAPI()?.notifications.onNavigate((notif) => {
      if (notif.kind === "conversation") {
        nav.openConversation(notif.conversationId as Id<"conversations">);
      } else {
        nav.openCommunity(notif.communityId as Id<"communities">, notif.channelId as Id<"channels">);
      }
    });
  }, [nav]);

  const showCommunityPlaceholder =
    browsingCommunityId !== null && !(target.type === "channel" && target.communityId === browsingCommunityId);

  const showOverview =
    overviewFor !== null && overviewFor === browsingCommunityId;

  return (
    <div className="flex h-full min-w-0">
      <WindowTitle target={target} />

      {activeCall && (
        <div className={showCallStage ? "flex min-h-0 min-w-0 flex-1 flex-col border-t" : "hidden"}>
          <CallStage />
        </div>
      )}
      {page && !showCallStage && <PageHost key={activeTab.id} page={page} />}
      {!showCallStage && !page && (
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
            <FriendsPanel search="" onMessageFriend={openConversation} />
          )}
        </div>
      )}

      {/* The call's mini player, while the call screen is collapsed. Rendered
          here rather than by CallProvider so the provider doesn't have to
          import a component that reads its own context back out. */}
      <CallPip />

      {/* The end-of-create-community overlay, which has to outlive the page. */}
      <CommunityFinaleHost />
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

import { CallStage } from "@/components/call/call-stage";
import { useCall } from "@/components/call/call-provider";
import { ChannelView } from "@/components/community/channel-view";
import { CommunitySidebar } from "@/components/community/community-sidebar";
import { ChatView } from "@/components/home/chat-view";
import { useUiPreferences } from "@/components/ui-preferences-provider";
import { CommunityRail } from "@/components/home/community-rail";
import { FriendsPanel } from "@/components/home/friends-panel";
import { NavSidebar } from "@/components/home/nav-sidebar";
import { useNavigation, useRegisterNavigation } from "@/components/home/navigation-context";
import { type TabTarget, useTabs } from "@/components/home/tabs-context";
import { Button } from "@/components/ui/button";
import { getDesktopAPI } from "@/lib/desktop";
import type { Id } from "../../../convex/_generated/dataModel";
import { UserCard } from "./user-card";

export function HomeLayout() {
  const [search, setSearch] = useState("");
  // Set the moment a community is picked (rail/popover/search) so its
  // sidebar shows immediately, even before a channel tab exists for it —
  // takes priority over the active tab's own community below, since it
  // reflects the freshest click. Cleared as soon as the active tab changes
  // to anything (its job — bridging the gap until a channel tab opens — is
  // done at that point either way, matched or not), so it never lingers and
  // overrides a later, unrelated tab switch.
  const [pendingCommunityId, setPendingCommunityId] = useState<Id<"communities"> | null>(null);
  // Whether the channel tab that eventually opens for `pendingCommunityId`
  // (via CommunitySidebar's auto-select-first-channel effect) should replace
  // the active tab or open alongside it — set by whatever triggered the
  // pending state (rail click, shift-click, right-click menu). A ref since
  // it's only ever read synchronously when that tab actually opens.
  const pendingModeRef = useRef<"replace" | "new">("new");

  const { activeCall, expanded, joinDmCall, joinChannelCall, expand, collapse, joinError, dismissJoinError } = useCall();
  const { tabs, activeTab, openTab, activateTab, closeTab } = useTabs();
  const { communityNavStyle, tabsEnabled } = useUiPreferences();
  const target = activeTab.target;

  const browsingCommunityId: Id<"communities"> | null =
    pendingCommunityId ?? (target.type === "channel" ? target.communityId : null);

  useEffect(() => {
    setPendingCommunityId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab.id]);

  // With tabs disabled, opening something new replaces whatever the other
  // (non-Home) tab was instead of adding another one — the classic
  // single-view behavior, since there's no tab bar to show/manage extras.
  const navigateTo = (next: TabTarget) => {
    if (!tabsEnabled) {
      for (const tab of tabs) {
        if (tab.target.type !== "home") closeTab(tab.id);
      }
    }
    openTab(next);
  };

  // Navigation never collapses an active call — the call stage stays visible
  // until the user explicitly clicks "Back" in the call stage or disconnects.
  // collapse() is only called by the call stage's own back button and leaveCall.
  const openConversation = (id: Id<"conversations">) => {
    setPendingCommunityId(null);
    navigateTo({ type: "dm", conversationId: id });
  };

  const selectFriends = () => {
    setPendingCommunityId(null);
    navigateTo({ type: "home" });
  };

  // Opens a specific channel tab. "replace" closes the active tab first
  // (unless it's pinned, or it's Home — pinned tabs are protected from being
  // silently swapped out); "new" just adds alongside it. Ignored (always
  // "replace") when tabs are globally disabled, since there's nowhere for
  // extras to go.
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
    openTab(target);
  };

  const openCommunity = (
    id: Id<"communities">,
    channelId: Id<"channels"> | undefined,
    mode: "replace" | "new"
  ) => {
    if (channelId) {
      openCommunityChannel(id, channelId, mode);
      return;
    }
    const existing = tabs.find((t) => t.target.type === "channel" && t.target.communityId === id);
    if (existing) {
      activateTab(existing.id);
      return;
    }
    // No channel tab open for this community yet — show its sidebar right
    // away; CommunitySidebar's own auto-select-first-channel effect opens
    // one shortly (via selectChannel below), which becomes the new tab.
    pendingModeRef.current = mode;
    setPendingCommunityId(id);
  };

  /** Search results / the communities popover — matches every other DM or
   * channel selection outside the rail: always opens a new tab. */
  const selectCommunity = (id: Id<"communities">, channelId?: Id<"channels">) => {
    openCommunity(id, channelId, "new");
  };

  /** The community rail: switching servers replaces the active tab by
   * default (like following a link), unless the caller asks otherwise. */
  const selectCommunityFromRail = (id: Id<"communities">, mode: "replace" | "new" = "replace") => {
    openCommunity(id, undefined, mode);
  };

  const selectChannel = (channelId: Id<"channels">, type: "text" | "voice") => {
    if (!browsingCommunityId) return;
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
    // Only true when this fires as the direct follow-up of a rail click that
    // hadn't picked a channel yet (see `openCommunity`) — an ordinary click
    // on a channel row while just browsing a community's sidebar normally
    // always opens a new tab, matching every other sidebar selection.
    const mode = pendingCommunityId === browsingCommunityId ? pendingModeRef.current : "new";
    openCommunityChannel(browsingCommunityId, channelId, mode);
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
      : target.type === "dm"
        ? { kind: "conversation" as const, id: target.conversationId }
        : target.type === "channel"
          ? { kind: "channel" as const, id: target.channelId }
          : null;
    void getDesktopAPI()?.notifications.setActiveView(view);
  }, [showCallStage, target]);

  // Clicking a background notification lands here.
  useEffect(() => {
    return getDesktopAPI()?.notifications.onNavigate((notif) => {
      if (notif.kind === "conversation") {
        nav.openConversation(notif.conversationId as Id<"conversations">);
      } else {
        nav.openCommunity(notif.communityId as Id<"communities">, notif.channelId as Id<"channels">);
      }
    });
  }, [nav]);

  // Communities that already have a channel tab open — the rail's
  // right-click menu labels those "Open tab" (it focuses the existing tab)
  // instead of "Open in new tab".
  const openCommunityIds = new Set(
    tabs.flatMap((t) => (t.target.type === "channel" ? [t.target.communityId] : []))
  );

  const showCommunityPlaceholder =
    browsingCommunityId !== null && !(target.type === "channel" && target.communityId === browsingCommunityId);

  return (
    <div className={`flex h-full`}>
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
            target.type === "channel" && target.communityId === browsingCommunityId ? target.channelId : null
          }
          onSelectChannel={selectChannel}
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

      {/* Kept mounted (just hidden) for as long as a call is active, rather
          than unmounted on collapse — CallStage/RoomView/CallGrid own the
          audio elements and screen-share subscription state, and unmounting
          them on every collapse/expand cycle tore down remote audio and
          reset "watching" screen-share subscriptions back to none. */}
      {activeCall && (
        <div className={showCallStage ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}>
          <CallStage />
        </div>
      )}
      {!showCallStage && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {joinError && (
            <div className="flex items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span className="min-w-0 flex-1">{joinError}</span>
              <Button variant="ghost" size="sm" onClick={dismissJoinError}>
                Dismiss
              </Button>
            </div>
          )}

          {target.type === "channel" ? (
            <ChannelView channelId={target.channelId} />
          ) : showCommunityPlaceholder ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              Select a channel
            </div>
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
    </div>
  );
}

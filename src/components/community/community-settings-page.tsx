"use client";

import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ErrorBoundary } from "@/components/error-boundary";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CommunitySettingsChannelsTab } from "@/components/community/community-settings-channels-tab";
import { ClanSettings } from "@/components/community/settings/clan-settings";
import { CreatorSettings } from "@/components/community/settings/creator-settings";
import { BotsSettings } from "@/components/community/settings/bots-settings";
import { ServersSettings } from "@/components/community/settings/servers-settings";
import { CommunitySettingsEmojisTab } from "@/components/community/community-settings-emojis-tab";
import { CommunitySettingsGeneralTab } from "@/components/community/community-settings-general-tab";
import { CommunitySettingsRolesTab } from "@/components/community/community-settings-roles-tab";
import { CommunitySettingsSoundboardTab } from "@/components/community/community-settings-soundboard-tab";
import { PageSidebar } from "@/components/pages/page-sidebar";
import {
  SettingsSaveBar,
  SettingsSaveProvider,
  useConfirmLeave,
} from "@/components/settings/settings-save";
import { SETTINGS_NAV_BUTTON, SectionTransition, SettingsPageLayout } from "@/components/settings/settings-ui";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { DeleteCommunityOverlay } from "@/components/community/delete-community-overlay";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { useState } from "react";

interface CommunitySettingsPageProps {
  communityId: Id<"communities">;
  /** Called when the page should go away on its own — the community was
   * deleted from inside it. */
  onClose: () => void;
}

const data = {
  navMain: [
    {
      title: "Community Settings",
      items: [
        { title: "General" },
        { title: "Roles" },
        { title: "Channels" },
        { title: "Emojis" },
        { title: "Soundboard" },
      ],
    },
  ],
};

/**
 * A community's settings, as a page.
 *
 * Works out what the caller may do itself rather than being told: it is opened
 * from a menu in three places, and each of them would otherwise have to
 * subscribe to the permissions just to pass them on.
 */
export function CommunitySettingsPage(props: CommunitySettingsPageProps) {
  // Around everything, the sidebar's menu included: that is drawn into another
  // part of the window, but still reads this context to ask before leaving a tab.
  return (
    <SettingsSaveProvider>
      <CommunitySettingsPageInner {...props} />
    </SettingsSaveProvider>
  );
}

function CommunitySettingsPageInner({ communityId, onClose }: CommunitySettingsPageProps) {
  const [selectedTab, setSelectedTab] = useState("General");
  const confirmLeave = useConfirmLeave();
  /** Changing tab with edits still unsaved asks first, and drops them if the
   * answer is yes — they belong to the tab being left. */
  const selectTab = (tab: string) => {
    if (tab === selectedTab) return;
    if (!confirmLeave()) return;
    setSelectedTab(tab);
  };
  const community = useQuery(api.communities.get, { communityId });
  const permissions = useQuery(api.roles.myPermissions, { communityId }) ?? 0;

  const canManageCommunity = hasPermission(permissions, PERMISSIONS.MANAGE_COMMUNITY);
  const canManageRoles = hasPermission(permissions, PERMISSIONS.MANAGE_ROLES);
  const canManageChannels = hasPermission(permissions, PERMISSIONS.MANAGE_CHANNELS);
  const canManageEmojis = hasPermission(permissions, PERMISSIONS.MANAGE_EMOJIS);
  const isOwner = community?.isOwner ?? false;
  // What a kind of community adds to its settings.
  const kind = (community as { kind?: "creator" | "clan" } | null | undefined)?.kind;
  const canManageServers = hasPermission(permissions, PERMISSIONS.MANAGE_GAME_SERVERS);
  const canManageIntegrations = hasPermission(permissions, PERMISSIONS.MANAGE_INTEGRATIONS);
  const navItems = [
    ...data.navMain[0].items,
    ...(canManageIntegrations ? [{ title: "Bots" }] : []),
    ...(kind === "creator" ? [{ title: "Creator" }] : []),
    ...(kind === "clan" ? [{ title: "Clan" }] : []),
    ...(kind && canManageServers ? [{ title: "Game servers" }] : []),
  ];
  // What to draw while it is being deleted, taken on click: the community
  // query goes null the moment the delete lands, mid-animation.
  const [deleting, setDeleting] = useState<{ name: string; iconUrl?: string; bannerUrl?: string } | null>(null);

  return (
    <div className="settings-surface relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      {/* The menu lives in the unified sidebar while this page is open — see
          `PageSidebar`. */}
      <PageSidebar>
        <SidebarContent>
          {/* We create a SidebarGroup for each parent. */}
          {data.navMain.map((item) => (
            <SidebarGroup key={item.title}>
              <SidebarGroupLabel>{item.title}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((child) => (
                    <SidebarMenuItem key={child.title}>
                      <SidebarMenuButton
                        type="button"
                        className={SETTINGS_NAV_BUTTON}
                        onClick={() => selectTab(child.title)}
                        isActive={selectedTab === child.title}
                      >
                        {child.title}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
          {/* Only the owner can delete it — the server refuses anyone else. */}
          {isOwner && (
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      type="button"
                      className="hover:bg-destructive/30 hover:text-destructive cursor-pointer transition-colors"
                      disabled={!community}
                      onClick={() =>
                        community &&
                        setDeleting({ name: community.name, iconUrl: community.imageUrl, bannerUrl: community.bannerUrl })
                      }
                    >
                      Delete Community
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
      </PageSidebar>
      {/* The Soundboard panel is the tallest here (upload form, uploaded
          clips, built-in clips), so the panel has to scroll on its own. The
          boundary is keyed on the tab so a panel that throws doesn't take the
          page down with it — which reads as the page ignoring clicks. */}
      <SectionTransition
        sectionKey={selectedTab}
        index={navItems.findIndex((item) => item.title === selectedTab)}
      >
        <ScrollArea horizontal className="min-h-0 w-full flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block">
          <SettingsPageLayout
            title={selectedTab}
            description={community ? `${community.name} · community settings` : "Community settings"}
          >
            <ErrorBoundary key={selectedTab} label={selectedTab}>
              {selectedTab === "General" && (
                <CommunitySettingsGeneralTab
                  communityId={communityId}
                  canManage={canManageCommunity}
                />
              )}
              {selectedTab === "Roles" && (
                <CommunitySettingsRolesTab
                  communityId={communityId}
                  canManage={canManageRoles}
                />
              )}
              {selectedTab === "Channels" && (
                <CommunitySettingsChannelsTab
                  communityId={communityId}
                  canManage={canManageChannels}
                />
              )}
              {selectedTab === "Emojis" && (
                <CommunitySettingsEmojisTab
                  communityId={communityId}
                  canManage={canManageEmojis}
                />
              )}
              {/* Uploading soundboard clips is gated on the same MANAGE_EMOJIS
              permission as emojis and stickers. */}
              {selectedTab === "Soundboard" && (
                <CommunitySettingsSoundboardTab
                  communityId={communityId}
                  canManage={canManageEmojis}
                />
              )}
              {selectedTab === "Creator" && <CreatorSettings communityId={communityId} />}
              {selectedTab === "Clan" && <ClanSettings communityId={communityId} canManage={canManageCommunity} />}
              {selectedTab === "Bots" && <BotsSettings communityId={communityId} />}
              {selectedTab === "Game servers" && <ServersSettings communityId={communityId} />}
            </ErrorBoundary>
          </SettingsPageLayout>
        </ScrollArea>
      </SectionTransition>
      {/* The one place edits are saved from, for whichever tab is open. */}
      <SettingsSaveBar />
      {deleting && (
        <DeleteCommunityOverlay
          communityId={communityId}
          {...deleting}
          onCancel={() => setDeleting(null)}
          onDeleted={onClose}
        />
      )}
    </div>
  );
}

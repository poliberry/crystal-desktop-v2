"use client";

import type { Id } from "../../../convex/_generated/dataModel";
import { ErrorBoundary } from "@/components/error-boundary";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CommunitySettingsChannelsTab } from "@/components/community/community-settings-channels-tab";
import { CommunitySettingsEmojisTab } from "@/components/community/community-settings-emojis-tab";
import { CommunitySettingsGeneralTab } from "@/components/community/community-settings-general-tab";
import { CommunitySettingsMembersTab } from "@/components/community/community-settings-members-tab";
import { CommunitySettingsRolesTab } from "@/components/community/community-settings-roles-tab";
import { CommunitySettingsSoundboardTab } from "@/components/community/community-settings-soundboard-tab";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { useState } from "react";

interface CommunitySettingsDialogProps {
  communityId: Id<"communities">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManageCommunity: boolean;
  canManageRoles: boolean;
  canManageChannels: boolean;
  canManageEmojis: boolean;
  canKick: boolean;
  isOwner: boolean;
}

const data = {
  navMain: [
    {
      title: "Community Settings",
      items: [
        { title: "General" },
        { title: "Roles" },
        { title: "Channels" },
        { title: "Members" },
        { title: "Emojis" },
        { title: "Soundboard" },
      ],
    },
  ],
};

export function CommunitySettingsDialog({
  communityId,
  open,
  onOpenChange,
  canManageCommunity,
  canManageRoles,
  canManageChannels,
  canManageEmojis,
  canKick,
  isOwner,
}: CommunitySettingsDialogProps) {
  const [selectedTab, setSelectedTab] = useState("General");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-10 bottom-0 left-0 right-0 translate-x-0 translate-y-0 min-w-full max-h-full rounded-none p-0"
        overlayClassName="top-10"
        showCloseButton={true}
      >
        <SidebarProvider>
          <Sidebar>
            <SidebarContent>
              {/* We create a SidebarGroup for each parent. */}
              {data.navMain.map((item) => (
                <SidebarGroup key={item.title}>
                  <SidebarGroupLabel>{item.title}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {item.items.map((child) => (
                        <SidebarMenuItem key={child.title}>
                          <SidebarMenuButton
                            type="button"
                            onClick={() => setSelectedTab(child.title)}
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
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton className="hover:bg-destructive/30 hover:text-destructive cursor-pointer transition-colors">
                        Delete Community
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <SidebarInset className="min-h-0 overflow-hidden">
            {/* The Soundboard panel is the tallest here (upload form, uploaded
                clips, built-in clips) and SidebarInset doesn't scroll on its
                own, so its lower half was unreachable. The boundary is keyed on
                the tab so a panel that throws doesn't take the dialog down with
                it — which reads as the dialog ignoring clicks. */}
            <ScrollArea className="h-full min-h-0">
              <ErrorBoundary key={selectedTab} label={selectedTab}>
                {selectedTab === "General" && (
                  <CommunitySettingsGeneralTab
                    communityId={communityId}
                    canManage={canManageCommunity}
                    isOwner={isOwner}
                    onDeleted={() => onOpenChange(false)}
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
                {selectedTab === "Members" && (
                  <CommunitySettingsMembersTab
                    communityId={communityId}
                    canManageRoles={canManageRoles}
                    canKick={canKick}
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
              </ErrorBoundary>
            </ScrollArea>
          </SidebarInset>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}

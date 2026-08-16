"use client";

import type { Id } from "../../../convex/_generated/dataModel";
import { CommunitySettingsChannelsTab } from "@/components/community/community-settings-channels-tab";
import { CommunitySettingsGeneralTab } from "@/components/community/community-settings-general-tab";
import { CommunitySettingsMembersTab } from "@/components/community/community-settings-members-tab";
import { CommunitySettingsRolesTab } from "@/components/community/community-settings-roles-tab";
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
  canKick: boolean;
  isOwner: boolean;
}

const data = {
  versions: ["1.0.1", "1.1.0-alpha", "2.0.0-beta1"],
  navMain: [
    {
      title: "Server Settings",
      url: "#",
      items: [
        {
          title: "General",
          url: "#",
        },
        {
          title: "Roles",
          url: "#",
        },
        {
          title: "Channels",
          url: "#",
        },
        {
          title: "Members",
          url: "#",
        },
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
                      {item.items.map((item) => (
                        <SidebarMenuItem key={item.title}>
                          <SidebarMenuButton
                            asChild
                            onClick={() => setSelectedTab(item.title)}
                            isActive={selectedTab === item.title}
                          >
                            <a href={item.url}>{item.title}</a>
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
          <SidebarInset>
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
          </SidebarInset>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}

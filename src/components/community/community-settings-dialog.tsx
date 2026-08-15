"use client";

import type { Id } from "../../../convex/_generated/dataModel";
import { CommunitySettingsChannelsTab } from "@/components/community/community-settings-channels-tab";
import { CommunitySettingsGeneralTab } from "@/components/community/community-settings-general-tab";
import { CommunitySettingsMembersTab } from "@/components/community/community-settings-members-tab";
import { CommunitySettingsRolesTab } from "@/components/community/community-settings-roles-tab";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Community settings</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="general" className="min-h-0 flex-1">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="roles">Roles</TabsTrigger>
            <TabsTrigger value="channels">Channels</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
          </TabsList>

          <div className="mt-3 max-h-[55vh] overflow-y-auto pr-1">
            <TabsContent value="general">
              <CommunitySettingsGeneralTab
                communityId={communityId}
                canManage={canManageCommunity}
                isOwner={isOwner}
                onDeleted={() => onOpenChange(false)}
              />
            </TabsContent>
            <TabsContent value="roles">
              <CommunitySettingsRolesTab communityId={communityId} canManage={canManageRoles} />
            </TabsContent>
            <TabsContent value="channels">
              <CommunitySettingsChannelsTab communityId={communityId} canManage={canManageChannels} />
            </TabsContent>
            <TabsContent value="members">
              <CommunitySettingsMembersTab
                communityId={communityId}
                canManageRoles={canManageRoles}
                canKick={canKick}
              />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

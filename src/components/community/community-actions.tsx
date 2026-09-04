"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  FolderPlus,
  Hash,
  LogOut,
  Settings,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CommunitySettingsDialog } from "@/components/community/community-settings-dialog";
import { CreateCategoryDialog } from "@/components/community/create-category-dialog";
import { CreateChannelDialog } from "@/components/community/create-channel-dialog";
import { InviteDialog } from "@/components/community/invite-dialog";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";

/**
 * A community's own actions — the things its header dropdown offers, described
 * as data instead of markup.
 *
 * The rail's right-click menu and the sidebar's header dropdown are different
 * Radix primitives (`ContextMenu` vs `DropdownMenu`) with different item
 * components, so there's no one component both can render. Describing the list
 * once and letting each menu draw it is what keeps the two from drifting —
 * before this, right-clicking a server in the rail offered only "open".
 */
export interface CommunityActionItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Styled as destructive, and put last. */
  destructive?: boolean;
  /** Whether a separator belongs above this item. Set on the first item of
   * each group, and never on the first item overall — a menu shouldn't open
   * with a rule across the top. */
  separatorBefore?: boolean;
}

export interface CommunityActionHandlers {
  invite: () => void;
  createChannel: () => void;
  createCategory: () => void;
  communitySettings: () => void;
  leave: () => void;
}

export function communityActionItems({
  permissions,
  isOwner,
  handlers,
}: {
  /** The caller's permission bits in this community (`roles.myPermissions`). */
  permissions: number;
  isOwner: boolean;
  handlers: CommunityActionHandlers;
}): CommunityActionItem[] {
  const items: CommunityActionItem[] = [];

  if (hasPermission(permissions, PERMISSIONS.CREATE_INVITE)) {
    items.push({
      key: "invite",
      label: "Invite People",
      icon: UserPlus,
      onSelect: handlers.invite,
    });
  }

  if (hasPermission(permissions, PERMISSIONS.MANAGE_CHANNELS)) {
    items.push({
      key: "create-channel",
      label: "Create Channel",
      icon: Hash,
      onSelect: handlers.createChannel,
      separatorBefore: items.length > 0,
    });
    items.push({
      key: "create-category",
      label: "Create Category",
      icon: FolderPlus,
      onSelect: handlers.createCategory,
    });
  }

  if (hasPermission(permissions, PERMISSIONS.MANAGE_COMMUNITY)) {
    items.push({
      key: "settings",
      label: "Community Settings",
      icon: Settings,
      onSelect: handlers.communitySettings,
      separatorBefore: items.length > 0,
    });
  }

  // The owner can't leave their own server — deleting it is a Community
  // Settings action, deliberately further away than a menu item.
  if (!isOwner) {
    items.push({
      key: "leave",
      label: "Leave Server",
      icon: LogOut,
      onSelect: handlers.leave,
      destructive: true,
      separatorBefore: items.length > 0,
    });
  }

  return items;
}

/**
 * The same actions, wired to their dialogs — for a menu outside the community
 * sidebar, which already owns copies of these.
 *
 * `enabled` gates the permission subscription: the rail renders one of these
 * per server, and a menu nobody has opened has no business holding a live
 * query per server. Callers flip it on the first time the menu opens.
 */
export function useCommunityActions({
  communityId,
  isOwner,
  enabled = true,
}: {
  communityId: Id<"communities">;
  isOwner: boolean;
  enabled?: boolean;
}): { items: CommunityActionItem[]; dialogs: React.ReactNode } {
  const permissions =
    useQuery(api.roles.myPermissions, enabled ? { communityId } : "skip") ?? 0;
  const leaveCommunity = useMutation(api.communities.leave);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const items = communityActionItems({
    permissions,
    isOwner,
    handlers: {
      invite: () => setInviteOpen(true),
      createChannel: () => setCreateChannelOpen(true),
      createCategory: () => setCreateCategoryOpen(true),
      communitySettings: () => setSettingsOpen(true),
      leave: () => void leaveCommunity({ communityId }),
    },
  });

  // Mounted only while open, unlike the sidebar's copies: there's one of these
  // per server in the rail, and each of these dialogs subscribes to something
  // as soon as it exists.
  const dialogs = (
    <>
      {inviteOpen && (
        <InviteDialog communityId={communityId} open onOpenChange={setInviteOpen} />
      )}
      {createChannelOpen && (
        <CreateChannelDialog
          communityId={communityId}
          open
          onOpenChange={setCreateChannelOpen}
        />
      )}
      {createCategoryOpen && (
        <CreateCategoryDialog
          communityId={communityId}
          open
          onOpenChange={setCreateCategoryOpen}
        />
      )}
      {settingsOpen && (
        <CommunitySettingsDialog
          communityId={communityId}
          open
          onOpenChange={setSettingsOpen}
          canManageCommunity={hasPermission(permissions, PERMISSIONS.MANAGE_COMMUNITY)}
          canManageRoles={hasPermission(permissions, PERMISSIONS.MANAGE_ROLES)}
          canManageChannels={hasPermission(permissions, PERMISSIONS.MANAGE_CHANNELS)}
          canManageEmojis={hasPermission(permissions, PERMISSIONS.MANAGE_EMOJIS)}
          isOwner={isOwner}
        />
      )}
    </>
  );

  return { items, dialogs };
}

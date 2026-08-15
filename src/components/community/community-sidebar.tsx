"use client";

import { DndContext, PointerSensor, closestCenter, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery } from "convex/react";
import { ChevronDown, Hash, MoreVertical, Plus, Settings, UserPlus, Volume2 } from "lucide-react";
import type { Room } from "livekit-client";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useCall } from "@/components/call/call-provider";
import { CommunitySettingsDialog } from "@/components/community/community-settings-dialog";
import { CreateCategoryDialog } from "@/components/community/create-category-dialog";
import { CreateChannelDialog } from "@/components/community/create-channel-dialog";
import { EditCategoryDialog } from "@/components/community/edit-category-dialog";
import { EditChannelDialog } from "@/components/community/edit-channel-dialog";
import { InviteDialog } from "@/components/community/invite-dialog";
import { VoiceChannelParticipants } from "@/components/community/voice-channel-participants";
import { UserCard } from "@/components/home/user-card";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type ChannelRow = {
  id: Id<"channels">;
  name: string;
  type: "text" | "voice";
  topic?: string;
  categoryId: Id<"channelCategories"> | null;
  position: number;
};

interface CommunitySidebarProps {
  communityId: Id<"communities">;
  selectedChannelId: Id<"channels"> | null;
  onSelectChannel: (channelId: Id<"channels">, type: "text" | "voice") => void;
}

export function CommunitySidebar({ communityId, selectedChannelId, onSelectChannel }: CommunitySidebarProps) {
  const community = useQuery(api.communities.get, { communityId });
  const channels = useQuery(api.channels.list, { communityId }) ?? [];
  const categories = useQuery(api.channelCategories.list, { communityId }) ?? [];
  const myPermissions = useQuery(api.roles.myPermissions, { communityId }) ?? 0;
  const { activeCall, controller } = useCall();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false);
  const [createChannelFor, setCreateChannelFor] = useState<Id<"channelCategories"> | null | undefined>(undefined);
  const [editingChannel, setEditingChannel] = useState<ChannelRow | null>(null);
  const [editingCategory, setEditingCategory] = useState<{ id: Id<"channelCategories">; name: string } | null>(null);

  const canManageChannels = hasPermission(myPermissions, PERMISSIONS.MANAGE_CHANNELS);
  const canCreateInvite = hasPermission(myPermissions, PERMISSIONS.CREATE_INVITE);

  useEffect(() => {
    if (!selectedChannelId && channels.length > 0) {
      const firstText = [...channels].sort((a, b) => a.position - b.position).find((c) => c.type === "text");
      if (firstText) onSelectChannel(firstText.id, "text");
    }
    // Only auto-select once channels first load for this community.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels.length > 0]);

  if (!community) {
    return <div className="flex w-64 shrink-0 flex-col border-r bg-background/40" />;
  }

  return (
    <div className="flex w-64 shrink-0 flex-col border-r bg-background/40">
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-3">
        <p className="truncate text-sm font-semibold">{community.name}</p>
        <div className="flex items-center gap-0.5">
          {canCreateInvite && (
            <Button variant="ghost" size="icon" className="size-7" onClick={() => setInviteOpen(true)}>
              <UserPlus className="size-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="size-7" onClick={() => setSettingsOpen(true)}>
            <Settings className="size-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <ChannelTree
          communityId={communityId}
          channels={channels}
          categories={categories}
          selectedChannelId={selectedChannelId}
          onSelectChannel={onSelectChannel}
          canManageChannels={canManageChannels}
          activeVoiceChannelId={activeCall?.kind === "channel" ? activeCall.channelId : null}
          liveRoom={controller.room}
          onCreateChannel={(categoryId) => setCreateChannelFor(categoryId)}
          onEditChannel={setEditingChannel}
          onEditCategory={setEditingCategory}
          onCreateCategory={() => setCreateCategoryOpen(true)}
        />
      </ScrollArea>

      <UserCard />

      <InviteDialog communityId={communityId} open={inviteOpen} onOpenChange={setInviteOpen} />
      {createChannelFor !== undefined && (
        <CreateChannelDialog
          communityId={communityId}
          categoryId={createChannelFor ?? undefined}
          open
          onOpenChange={(open) => !open && setCreateChannelFor(undefined)}
        />
      )}
      <CreateCategoryDialog communityId={communityId} open={createCategoryOpen} onOpenChange={setCreateCategoryOpen} />
      <EditChannelDialog channel={editingChannel} onOpenChange={(open) => !open && setEditingChannel(null)} />
      <EditCategoryDialog category={editingCategory} onOpenChange={(open) => !open && setEditingCategory(null)} />

      <CommunitySettingsDialog
        communityId={communityId}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        canManageCommunity={hasPermission(myPermissions, PERMISSIONS.MANAGE_COMMUNITY)}
        canManageRoles={hasPermission(myPermissions, PERMISSIONS.MANAGE_ROLES)}
        canManageChannels={canManageChannels}
        canKick={hasPermission(myPermissions, PERMISSIONS.KICK_MEMBERS)}
        isOwner={community.isOwner}
      />
    </div>
  );
}

interface ChannelTreeProps {
  communityId: Id<"communities">;
  channels: ChannelRow[];
  categories: { id: Id<"channelCategories">; name: string; position: number }[];
  selectedChannelId: Id<"channels"> | null;
  activeVoiceChannelId: Id<"channels"> | null;
  onSelectChannel: (channelId: Id<"channels">, type: "text" | "voice") => void;
  canManageChannels: boolean;
  liveRoom: Room | null;
  onCreateChannel: (categoryId: Id<"channelCategories"> | null) => void;
  onEditChannel: (channel: ChannelRow) => void;
  onEditCategory: (category: { id: Id<"channelCategories">; name: string }) => void;
  onCreateCategory: () => void;
}

function channelKey(id: Id<"channels">) {
  return `chan:${id}`;
}
function categoryKey(id: Id<"channelCategories">) {
  return `cat:${id}`;
}
function dropzoneKey(categoryId: Id<"channelCategories"> | null) {
  return `dropzone:${categoryId ?? "none"}`;
}

function ChannelTree({
  communityId,
  channels,
  categories,
  selectedChannelId,
  activeVoiceChannelId,
  onSelectChannel,
  canManageChannels,
  liveRoom,
  onCreateChannel,
  onEditChannel,
  onEditCategory,
  onCreateCategory,
}: ChannelTreeProps) {
  const reorderChannels = useMutation(api.channels.reorder);
  const reorderCategories = useMutation(api.channelCategories.reorder);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const { uncategorized, categoryBuckets } = useMemo(() => {
    const sortedCategories = [...categories].sort((a, b) => a.position - b.position);
    const byCategory = new Map<string, ChannelRow[]>();
    for (const channel of channels) {
      const key = channel.categoryId ?? "none";
      const list = byCategory.get(key) ?? [];
      list.push(channel);
      byCategory.set(key, list);
    }
    for (const list of byCategory.values()) list.sort((a, b) => a.position - b.position);

    return {
      uncategorized: byCategory.get("none") ?? [],
      categoryBuckets: sortedCategories.map((c) => ({ id: c.id, name: c.name, channels: byCategory.get(c.id) ?? [] })),
    };
  }, [channels, categories]);

  // Combined view (uncategorized bucket first) purely for the drag-end
  // lookup below — rendering uses `uncategorized`/`categoryBuckets`
  // separately so CategorySection's props stay non-nullable.
  const buckets: BucketData[] = [
    { id: null, name: null, channels: uncategorized },
    ...categoryBuckets,
  ];

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data.current as { type: string; categoryId?: Id<"channelCategories"> | null } | undefined;
    const overData = over.data.current as { type: string; categoryId?: Id<"channelCategories"> | null } | undefined;
    if (!activeData) return;

    if (activeData.type === "category") {
      if (overData?.type !== "category" || active.id === over.id) return;
      const order = categories.map((c) => categoryKey(c.id));
      const oldIndex = order.indexOf(String(active.id));
      const newIndex = order.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(order, oldIndex, newIndex).map(
        (key) => key.slice(4) as Id<"channelCategories">
      );
      void reorderCategories({ communityId, orderedCategoryIds: reordered });
      return;
    }

    if (activeData.type === "channel") {
      const sourceCategoryId = activeData.categoryId ?? null;
      const destCategoryId =
        overData?.type === "channel" || overData?.type === "channel-dropzone" ? (overData.categoryId ?? null) : undefined;
      if (destCategoryId === undefined) return;

      const destBucket = buckets.find((b) => b.id === destCategoryId);
      if (!destBucket) return;
      const destIds = destBucket.channels.map((c) => channelKey(c.id));

      if (sourceCategoryId === destCategoryId) {
        const oldIndex = destIds.indexOf(String(active.id));
        const newIndex = overData?.type === "channel" ? destIds.indexOf(String(over.id)) : destIds.length - 1;
        if (oldIndex === -1 || newIndex === -1) return;
        const reordered = arrayMove(destIds, oldIndex, newIndex).map((key) => key.slice(5) as Id<"channels">);
        void reorderChannels({ communityId, categoryId: destCategoryId, orderedChannelIds: reordered });
      } else {
        const insertIndex = overData?.type === "channel" ? destIds.indexOf(String(over.id)) : destIds.length;
        const next = [...destIds];
        next.splice(insertIndex === -1 ? next.length : insertIndex, 0, String(active.id));
        const reordered = next.map((key) => key.slice(5) as Id<"channels">);
        void reorderChannels({ communityId, categoryId: destCategoryId, orderedChannelIds: reordered });
      }
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-3 p-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Channels</span>
          {canManageChannels && (
            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="icon" className="size-5" onClick={onCreateCategory} title="New category">
                <Plus className="size-3.5" />
              </Button>
            </div>
          )}
        </div>

        <ChannelBucket
          bucket={{ id: null, name: null, channels: uncategorized }}
          selectedChannelId={selectedChannelId}
          activeVoiceChannelId={activeVoiceChannelId}
          onSelectChannel={onSelectChannel}
          canManageChannels={canManageChannels}
          liveRoom={liveRoom}
          onCreateChannel={onCreateChannel}
          onEditChannel={onEditChannel}
        />

        <SortableContext items={categories.map((c) => categoryKey(c.id))} strategy={verticalListSortingStrategy}>
          {categoryBuckets.map((bucket) => (
            <CategorySection
              key={bucket.id}
              bucket={bucket}
              selectedChannelId={selectedChannelId}
              activeVoiceChannelId={activeVoiceChannelId}
              onSelectChannel={onSelectChannel}
              canManageChannels={canManageChannels}
              liveRoom={liveRoom}
              onCreateChannel={onCreateChannel}
              onEditChannel={onEditChannel}
              onEditCategory={onEditCategory}
            />
          ))}
        </SortableContext>
      </div>
    </DndContext>
  );
}

interface BucketData {
  id: Id<"channelCategories"> | null;
  name: string | null;
  channels: ChannelRow[];
}

interface CategoryBucketData {
  id: Id<"channelCategories">;
  name: string;
  channels: ChannelRow[];
}

function CategorySection({
  bucket,
  selectedChannelId,
  activeVoiceChannelId,
  onSelectChannel,
  canManageChannels,
  liveRoom,
  onCreateChannel,
  onEditChannel,
  onEditCategory,
}: {
  bucket: CategoryBucketData;
  selectedChannelId: Id<"channels"> | null;
  activeVoiceChannelId: Id<"channels"> | null;
  onSelectChannel: (channelId: Id<"channels">, type: "text" | "voice") => void;
  canManageChannels: boolean;
  liveRoom: Room | null;
  onCreateChannel: (categoryId: Id<"channelCategories"> | null) => void;
  onEditChannel: (channel: ChannelRow) => void;
  onEditCategory: (category: { id: Id<"channelCategories">; name: string }) => void;
}) {
  const categoryId = bucket.id;
  const [collapsed, setCollapsed] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: categoryKey(categoryId),
    data: { type: "category" },
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="group/cat flex items-center justify-between px-1"
            {...attributes}
            {...listeners}
          >
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
            >
              <ChevronDown className={cn("size-3 shrink-0 transition-transform", collapsed && "-rotate-90")} />
              <span className="truncate">{bucket.name}</span>
            </button>
            {canManageChannels && (
              <div className="flex items-center gap-0.5 opacity-0 group-hover/cat:opacity-100">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  onClick={() => onCreateChannel(categoryId)}
                  title="New channel"
                >
                  <Plus className="size-3.5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-5">
                      <MoreVertical className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEditCategory({ id: categoryId, name: bucket.name })}>
                      Edit category
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onCreateChannel(categoryId)}>New channel</ContextMenuItem>
          {canManageChannels && (
            <ContextMenuItem onClick={() => onEditCategory({ id: categoryId, name: bucket.name })}>
              Edit category
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {!collapsed && (
        <ChannelBucket
          bucket={bucket}
          selectedChannelId={selectedChannelId}
          activeVoiceChannelId={activeVoiceChannelId}
          onSelectChannel={onSelectChannel}
          canManageChannels={canManageChannels}
          liveRoom={liveRoom}
          onCreateChannel={onCreateChannel}
          onEditChannel={onEditChannel}
        />
      )}
    </div>
  );
}

function ChannelBucket({
  bucket,
  selectedChannelId,
  activeVoiceChannelId,
  onSelectChannel,
  canManageChannels,
  liveRoom,
  onCreateChannel,
  onEditChannel,
}: {
  bucket: BucketData;
  selectedChannelId: Id<"channels"> | null;
  activeVoiceChannelId: Id<"channels"> | null;
  onSelectChannel: (channelId: Id<"channels">, type: "text" | "voice") => void;
  canManageChannels: boolean;
  liveRoom: Room | null;
  onCreateChannel: (categoryId: Id<"channelCategories"> | null) => void;
  onEditChannel: (channel: ChannelRow) => void;
}) {
  const { setNodeRef } = useDroppable({
    id: dropzoneKey(bucket.id),
    data: { type: "channel-dropzone", categoryId: bucket.id },
  });

  return (
    <SortableContext items={bucket.channels.map((c) => channelKey(c.id))} strategy={verticalListSortingStrategy}>
      <div ref={setNodeRef} className="mt-1 flex min-h-2 flex-col gap-0.5">
        {bucket.channels.map((channel) => (
          <ChannelItem
            key={channel.id}
            channel={channel}
            active={selectedChannelId === channel.id || (channel.type === "voice" && activeVoiceChannelId === channel.id)}
            isVoiceActive={channel.type === "voice" && activeVoiceChannelId === channel.id}
            onSelectChannel={onSelectChannel}
            canManageChannels={canManageChannels}
            liveRoom={liveRoom}
            onEditChannel={onEditChannel}
          />
        ))}
        {bucket.channels.length === 0 && bucket.id === null && (
          <p className="px-2 py-1 text-xs text-muted-foreground">No channels yet.</p>
        )}
        {canManageChannels && bucket.id === null && bucket.channels.length === 0 && (
          <button
            type="button"
            onClick={() => onCreateChannel(null)}
            className="px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Create a channel
          </button>
        )}
      </div>
    </SortableContext>
  );
}

function ChannelItem({
  channel,
  active,
  isVoiceActive,
  onSelectChannel,
  canManageChannels,
  liveRoom,
  onEditChannel,
}: {
  channel: ChannelRow;
  active: boolean;
  isVoiceActive: boolean;
  onSelectChannel: (channelId: Id<"channels">, type: "text" | "voice") => void;
  canManageChannels: boolean;
  liveRoom: Room | null;
  onEditChannel: (channel: ChannelRow) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: channelKey(channel.id),
    data: { type: "channel", categoryId: channel.categoryId },
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group/chan relative" {...attributes} {...listeners}>
            <button
              type="button"
              onClick={() => onSelectChannel(channel.id, channel.type)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/60",
                active && "bg-accent text-foreground",
                !active && "text-muted-foreground"
              )}
            >
              {channel.type === "text" ? (
                <Hash className="size-4 shrink-0" />
              ) : (
                <Volume2 className={cn("size-4 shrink-0", isVoiceActive && "text-emerald-500")} />
              )}
              <span className="truncate">{channel.name}</span>
              {isVoiceActive && <span className="ml-auto text-[10px] text-emerald-500">Connected</span>}
            </button>

            {canManageChannels && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-1/2 right-1 size-5 -translate-y-1/2 opacity-0 group-hover/chan:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEditChannel(channel)}>Edit channel</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </ContextMenuTrigger>
        {canManageChannels && (
          <ContextMenuContent>
            <ContextMenuItem onClick={() => onEditChannel(channel)}>Edit channel</ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>

      {channel.type === "voice" && (
        <VoiceChannelParticipants channelId={channel.id} liveRoom={isVoiceActive ? liveRoom : null} />
      )}
    </div>
  );
}

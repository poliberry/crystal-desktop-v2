"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery } from "convex/react";
import {
  ChevronDown,
  FolderPlus,
  Hash,
  LogOut,
  Settings,
  UserPlus,
  Volume2,
} from "lucide-react";
import type { Room } from "livekit-client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useCall } from "@/components/call/call-provider";
import { CommunitySettingsDialog } from "@/components/community/community-settings-dialog";
import { CreateCategoryDialog } from "@/components/community/create-category-dialog";
import { CreateChannelDialog } from "@/components/community/create-channel-dialog";
import { EditCategoryDialog } from "@/components/community/edit-category-dialog";
import { EditChannelDialog } from "@/components/community/edit-channel-dialog";
import { InviteDialog } from "@/components/community/invite-dialog";
import {
  VoiceChannelHoverCard,
  VoiceChannelParticipants,
} from "@/components/community/voice-channel-participants";
import { UserCard } from "@/components/home/user-card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
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

type ActiveDragItem =
  | {
      type: "channel";
      id: Id<"channels">;
      name: string;
      channelType: "text" | "voice";
    }
  | { type: "category"; id: Id<"channelCategories">; name: string }
  | null;

interface CommunitySidebarProps {
  communityId: Id<"communities">;
  selectedChannelId: Id<"channels"> | null;
  onSelectChannel: (channelId: Id<"channels">, type: "text" | "voice") => void;
}

/**
 * Which community this sidebar is showing.
 *
 * A context rather than a prop because it's constant for the whole subtree
 * and only one leaf deep inside it — the voice channel roster, which resolves
 * members against their profile *here* — actually needs it. Threading it down
 * through ChannelTree → CategorySection → ChannelBucket → ChannelItem adds a
 * parameter to four components that have no use for it.
 */
const SidebarCommunityContext = createContext<Id<"communities"> | null>(null);

function useSidebarCommunityId(): Id<"communities"> {
  const communityId = useContext(SidebarCommunityContext);
  if (!communityId) {
    throw new Error("useSidebarCommunityId must be used within <CommunitySidebar>");
  }
  return communityId;
}

function ChannelListSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-2">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-8 rounded-md" />
        <Skeleton className="h-8 rounded-md" />
        <Skeleton className="h-8 rounded-md" />
      </div>
      <Skeleton className="h-3 w-24" />
      <div className="flex flex-col gap-1">
        <Skeleton className="h-8 rounded-md" />
        <Skeleton className="h-8 rounded-md" />
      </div>
      <Skeleton className="h-3 w-20" />
      <div className="flex flex-col gap-1">
        <Skeleton className="h-8 rounded-md" />
      </div>
    </div>
  );
}

export function CommunitySidebar({
  communityId,
  selectedChannelId,
  onSelectChannel,
}: CommunitySidebarProps) {
  const community = useQuery(api.communities.get, { communityId });
  const rawChannels = useQuery(api.channels.list, { communityId });
  const rawCategories = useQuery(api.channelCategories.list, { communityId });
  const channels = rawChannels ?? [];
  const categories = rawCategories ?? [];
  const isLoadingChannels =
    rawChannels === undefined || rawCategories === undefined;

  const myPermissions = useQuery(api.roles.myPermissions, { communityId }) ?? 0;
  const { activeCall, controller, expanded } = useCall();
  // While the call stage covers the content pane, no text channel is
  // actually on screen — so its sidebar row shouldn't still look "active"
  // (previously it stayed highlighted from before the call was expanded).
  const showCallStage = expanded && !!activeCall;
  const effectiveSelectedChannelId = showCallStage ? null : selectedChannelId;
  const leaveCommunity = useMutation(api.communities.leave);
  const deleteChannel = useMutation(api.channels.remove);
  const deleteCategory = useMutation(api.channelCategories.remove);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createCategoryOpen, setCreateCategoryOpen] = useState(false);
  const [createChannelFor, setCreateChannelFor] = useState<
    Id<"channelCategories"> | null | undefined
  >(undefined);
  const [editingChannel, setEditingChannel] = useState<ChannelRow | null>(null);
  const [editingCategory, setEditingCategory] = useState<{
    id: Id<"channelCategories">;
    name: string;
  } | null>(null);

  const canManageChannels = hasPermission(
    myPermissions,
    PERMISSIONS.MANAGE_CHANNELS,
  );
  const canCreateInvite = hasPermission(
    myPermissions,
    PERMISSIONS.CREATE_INVITE,
  );
  const canManageEmojis = hasPermission(
    myPermissions,
    PERMISSIONS.MANAGE_EMOJIS,
  );
  const canManageCommunity = hasPermission(
    myPermissions,
    PERMISSIONS.MANAGE_COMMUNITY,
  );

  useEffect(() => {
    if (!selectedChannelId && channels.length > 0) {
      const firstText = [...channels]
        .sort((a, b) => a.position - b.position)
        .find((c) => c.type === "text");
      if (firstText) onSelectChannel(firstText.id, "text");
    }
    // Deliberately keyed on communityId/selectedChannelId (not `channels`
    // itself, and not just `channels.length > 0`) — this component doesn't
    // remount when `communityId` changes (no `key` prop upstream), so a
    // dependency on the loading-boolean alone only re-fires on a true/false
    // *transition*. Switching to a community whose channel list is already
    // cached from earlier in the session never produces that transition
    // (`channels.length > 0` is `true` before and after), so the effect
    // would silently never re-run and no channel would ever get selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, selectedChannelId, channels.length > 0]);

  if (!community) {
    return (
      <div className="flex w-64 shrink-0 flex-col m-2 bg-accent/40 backdrop-blur-xl shadow-md rounded-2xl">
        <div className="flex h-14 shrink-0 items-center border-b px-3">
          <Skeleton className="h-4 w-36" />
        </div>
        <ChannelListSkeleton />
      </div>
    );
  }

  const hasBanner = !!community.bannerUrl;

  return (
    <SidebarCommunityContext.Provider value={communityId}>
    <div className="flex w-64 shrink-0 flex-col bg-accent/40 backdrop-blur-xl shadow-md">
      <DropdownMenu>
        {/* Banner + trigger share a relative container so the trigger can
            overlay the bottom of the banner with a gradient backdrop */}
        <div className={cn("relative shrink-0", hasBanner ? "h-32" : "h-12")}>
          {hasBanner && (
            <>
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{
                  backgroundImage: `url(${community.bannerUrl})`,
                }}
              />
              {/* Fade banner to sidebar background at the bottom */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-background" />
            </>
          )}
          <DropdownMenuTrigger asChild>
            <button className="absolute inset-x-0 top-0 flex h-12 w-full items-center justify-between px-3 text-left transition-colors hover:bg-accent/20">
              <p className="truncate text-sm font-semibold">{community.name}</p>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
        </div>
        <DropdownMenuContent className="w-56" align="start">
          {canCreateInvite && (
            <DropdownMenuItem onClick={() => setInviteOpen(true)}>
              <UserPlus className="size-4" />
              Invite People
            </DropdownMenuItem>
          )}
          {canManageChannels && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setCreateChannelFor(null)}>
                <Hash className="size-4" />
                Create Channel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCreateCategoryOpen(true)}>
                <FolderPlus className="size-4" />
                Create Category
              </DropdownMenuItem>
            </>
          )}
          {canManageCommunity && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                <Settings className="size-4" />
                Community Settings
              </DropdownMenuItem>
            </>
          )}
          {!community.isOwner && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => void leaveCommunity({ communityId })}
              >
                <LogOut className="size-4" />
                Leave Server
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <ScrollArea className="min-h-0 flex-1">
            {isLoadingChannels ? (
              <ChannelListSkeleton />
            ) : (
              <ChannelTree
                communityId={communityId}
                channels={channels}
                categories={categories}
                selectedChannelId={effectiveSelectedChannelId}
                onSelectChannel={onSelectChannel}
                canManageChannels={canManageChannels}
                activeVoiceChannelId={
                  activeCall?.kind === "channel" ? activeCall.channelId : null
                }
                liveRoom={controller.room}
                onCreateChannel={(categoryId) =>
                  setCreateChannelFor(categoryId)
                }
                onEditChannel={setEditingChannel}
                onDeleteChannel={(channelId) =>
                  void deleteChannel({ channelId })
                }
                onEditCategory={setEditingCategory}
                onDeleteCategory={(categoryId) =>
                  void deleteCategory({ categoryId })
                }
                onCreateCategory={() => setCreateCategoryOpen(true)}
              />
            )}
          </ScrollArea>
        </ContextMenuTrigger>
        {canManageChannels && (
          <ContextMenuContent>
            <ContextMenuItem onClick={() => setCreateChannelFor(null)}>
              <Hash className="size-4" />
              Create Channel
            </ContextMenuItem>
            <ContextMenuItem onClick={() => setCreateCategoryOpen(true)}>
              <FolderPlus className="size-4" />
              Create Category
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>

      <InviteDialog
        communityId={communityId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />
      {createChannelFor !== undefined && (
        <CreateChannelDialog
          communityId={communityId}
          categoryId={createChannelFor ?? undefined}
          open
          onOpenChange={(open) => !open && setCreateChannelFor(undefined)}
        />
      )}
      <CreateCategoryDialog
        communityId={communityId}
        open={createCategoryOpen}
        onOpenChange={setCreateCategoryOpen}
      />
      <EditChannelDialog
        channel={editingChannel}
        onOpenChange={(open) => !open && setEditingChannel(null)}
      />
      <EditCategoryDialog
        category={editingCategory}
        onOpenChange={(open) => !open && setEditingCategory(null)}
      />
      <CommunitySettingsDialog
        communityId={communityId}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        canManageCommunity={hasPermission(
          myPermissions,
          PERMISSIONS.MANAGE_COMMUNITY,
        )}
        canManageRoles={hasPermission(myPermissions, PERMISSIONS.MANAGE_ROLES)}
        canManageChannels={canManageChannels}
        canManageEmojis={canManageEmojis}
        canKick={hasPermission(myPermissions, PERMISSIONS.KICK_MEMBERS)}
        isOwner={community.isOwner}
      />
    </div>
    </SidebarCommunityContext.Provider>
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
  onDeleteChannel: (channelId: Id<"channels">) => void;
  onEditCategory: (category: {
    id: Id<"channelCategories">;
    name: string;
  }) => void;
  onDeleteCategory: (categoryId: Id<"channelCategories">) => void;
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
  onDeleteChannel,
  onEditCategory,
  onDeleteCategory,
  onCreateCategory,
}: ChannelTreeProps) {
  const reorderChannels = useMutation(api.channels.reorder);
  const reorderCategories = useMutation(api.channelCategories.reorder);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const [activeItem, setActiveItem] = useState<ActiveDragItem>(null);
  /**
   * Tracks which droppable is currently under the dragged item and whether the
   * drop would insert before or after it. Used to render a hairline indicator
   * so the user can see exactly where the item will land.
   */
  const [overInfo, setOverInfo] = useState<{
    id: string;
    isBefore: boolean;
  } | null>(null);

  /**
   * Custom collision detection that restricts candidates to the same drag-type.
   *
   * With a single DndContext covering both category headers and channel rows,
   * the default `closestCenter` considers ALL droppables simultaneously. When
   * dragging a channel near a category boundary the category-header sortable
   * can "win" the collision even though it's the wrong type — the drop
   * indicator then snaps to completely the wrong position.
   *
   * Fix: filter droppable containers to only those whose ID prefix matches the
   * active item's type before handing off to `closestCenter`.
   */
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const activeData = args.active.data.current as
      { type?: string } | undefined;
    if (activeData?.type === "category") {
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) =>
          String(c.id).startsWith("cat:"),
        ),
      });
    }
    if (activeData?.type === "channel") {
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (c) =>
            String(c.id).startsWith("chan:") ||
            String(c.id).startsWith("dropzone:"),
        ),
      });
    }
    return closestCenter(args);
  }, []);

  const { uncategorized, categoryBuckets } = useMemo(() => {
    const sortedCategories = [...categories].sort(
      (a, b) => a.position - b.position,
    );
    const byCategory = new Map<string, ChannelRow[]>();
    for (const channel of channels) {
      const key = channel.categoryId ?? "none";
      const list = byCategory.get(key) ?? [];
      list.push(channel);
      byCategory.set(key, list);
    }
    for (const list of byCategory.values())
      list.sort((a, b) => a.position - b.position);

    return {
      uncategorized: byCategory.get("none") ?? [],
      categoryBuckets: sortedCategories.map((c) => ({
        id: c.id,
        name: c.name,
        channels: byCategory.get(c.id) ?? [],
      })),
    };
  }, [channels, categories]);

  const buckets: BucketData[] = [
    { id: null, name: null, channels: uncategorized },
    ...categoryBuckets,
  ];

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setOverInfo(null);
      return;
    }

    // Only show the line indicator when hovering directly over a same-type item
    // (not a dropzone, not a cross-type collision).
    const activeData = active.data.current as { type?: string } | undefined;
    const overData = over.data.current as { type?: string } | undefined;
    const relevantType =
      activeData?.type === "category" ? "category" : "channel";
    if (overData?.type !== relevantType) {
      setOverInfo(null);
      return;
    }

    // Compare the dragged item's current translated centre with the over
    // item's centre to decide before vs. after.
    const translated = active.rect.current.translated;
    if (!translated) {
      setOverInfo(null);
      return;
    }
    const activeCenter = translated.top + translated.height / 2;
    const overCenter = over.rect.top + over.rect.height / 2;
    setOverInfo({ id: String(over.id), isBefore: activeCenter < overCenter });
  };

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as
      { type: string; categoryId?: Id<"channelCategories"> | null } | undefined;
    if (!data) return;

    if (data.type === "category") {
      const cat = categories.find(
        (c) => categoryKey(c.id) === String(event.active.id),
      );
      if (cat) setActiveItem({ type: "category", id: cat.id, name: cat.name });
    } else if (data.type === "channel") {
      const chan = channels.find(
        (c) => channelKey(c.id) === String(event.active.id),
      );
      if (chan)
        setActiveItem({
          type: "channel",
          id: chan.id,
          name: chan.name,
          channelType: chan.type,
        });
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveItem(null);
    setOverInfo(null);
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data.current as
      { type: string; categoryId?: Id<"channelCategories"> | null } | undefined;
    const overData = over.data.current as
      { type: string; categoryId?: Id<"channelCategories"> | null } | undefined;
    if (!activeData) return;

    if (activeData.type === "category") {
      if (overData?.type !== "category" || active.id === over.id) return;
      const order = categories.map((c) => categoryKey(c.id));
      const oldIndex = order.indexOf(String(active.id));
      const newIndex = order.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(order, oldIndex, newIndex).map(
        (key) => key.slice(4) as Id<"channelCategories">,
      );
      void reorderCategories({ communityId, orderedCategoryIds: reordered });
      return;
    }

    if (activeData.type === "channel") {
      const sourceCategoryId = activeData.categoryId ?? null;
      const destCategoryId =
        overData?.type === "channel" || overData?.type === "channel-dropzone"
          ? (overData.categoryId ?? null)
          : undefined;
      if (destCategoryId === undefined) return;

      const destBucket = buckets.find((b) => b.id === destCategoryId);
      if (!destBucket) return;
      const destIds = destBucket.channels.map((c) => channelKey(c.id));

      if (sourceCategoryId === destCategoryId) {
        const oldIndex = destIds.indexOf(String(active.id));
        const newIndex =
          overData?.type === "channel"
            ? destIds.indexOf(String(over.id))
            : destIds.length - 1;
        if (oldIndex === -1 || newIndex === -1) return;
        const reordered = arrayMove(destIds, oldIndex, newIndex).map(
          (key) => key.slice(5) as Id<"channels">,
        );
        void reorderChannels({
          communityId,
          categoryId: destCategoryId,
          orderedChannelIds: reordered,
        });
      } else {
        const insertIndex =
          overData?.type === "channel"
            ? destIds.indexOf(String(over.id))
            : destIds.length;
        const next = [...destIds];
        next.splice(
          insertIndex === -1 ? next.length : insertIndex,
          0,
          String(active.id),
        );
        const reordered = next.map((key) => key.slice(5) as Id<"channels">);
        void reorderChannels({
          communityId,
          categoryId: destCategoryId,
          orderedChannelIds: reordered,
        });
      }
    }
  };

  // Only show the uncategorized bucket when it has channels, or when
  // there are no categories at all (so the "No channels yet" message appears).
  const showUncategorized = uncategorized.length > 0 || categories.length === 0;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col gap-2 p-2">
        {showUncategorized && (
          <ChannelBucket
            bucket={{ id: null, name: null, channels: uncategorized }}
            totalChannelCount={channels.length}
            selectedChannelId={selectedChannelId}
            activeVoiceChannelId={activeVoiceChannelId}
            onSelectChannel={onSelectChannel}
            canManageChannels={canManageChannels}
            liveRoom={liveRoom}
            onCreateChannel={onCreateChannel}
            onEditChannel={onEditChannel}
            onDeleteChannel={onDeleteChannel}
            overInfo={overInfo}
          />
        )}

        <SortableContext
          items={categories.map((c) => categoryKey(c.id))}
          strategy={verticalListSortingStrategy}
        >
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
              onDeleteChannel={onDeleteChannel}
              onEditCategory={onEditCategory}
              onDeleteCategory={onDeleteCategory}
              overInfo={overInfo}
            />
          ))}
        </SortableContext>
      </div>

      <DragOverlay dropAnimation={{ duration: 150, easing: "ease" }}>
        {activeItem?.type === "channel" && (
          <div className="flex items-center gap-2 rounded-md bg-accent px-2 py-1.5 text-sm opacity-90 shadow-md">
            {activeItem.channelType === "text" ? (
              <Hash className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <Volume2 className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{activeItem.name}</span>
          </div>
        )}
        {activeItem?.type === "category" && (
          <div className="flex items-center gap-1 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase opacity-90 shadow-sm">
            <ChevronDown className="size-3 shrink-0" />
            <span className="truncate">{activeItem.name}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * Hairline drop-position indicator rendered as an absolutely-positioned
 * overlay so it never shifts the layout of surrounding items.
 *
 * `position="top"`    → centred on the top boundary of its parent row
 * `position="bottom"` → centred on the bottom boundary
 *
 * Using `translate-y-[-50%]` / `translate-y-[50%]` keeps the 2 px line
 * centred exactly between rows regardless of the gap size.
 */
function DropLine({ position }: { position: "top" | "bottom" }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-1 z-10 flex items-center gap-1",
        position === "top"
          ? "top-0 -translate-y-1/2"
          : "bottom-0 translate-y-1/2",
      )}
    >
      <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary ring-1 ring-background" />
      <div className="h-px flex-1 rounded-full bg-primary" />
    </div>
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
  onDeleteChannel,
  onEditCategory,
  onDeleteCategory,
  overInfo,
}: {
  bucket: CategoryBucketData;
  selectedChannelId: Id<"channels"> | null;
  activeVoiceChannelId: Id<"channels"> | null;
  onSelectChannel: (channelId: Id<"channels">, type: "text" | "voice") => void;
  canManageChannels: boolean;
  liveRoom: Room | null;
  onCreateChannel: (categoryId: Id<"channelCategories"> | null) => void;
  onEditChannel: (channel: ChannelRow) => void;
  onDeleteChannel: (channelId: Id<"channels">) => void;
  onEditCategory: (category: {
    id: Id<"channelCategories">;
    name: string;
  }) => void;
  onDeleteCategory: (categoryId: Id<"channelCategories">) => void;
  overInfo: { id: string; isBefore: boolean } | null;
}) {
  const categoryId = bucket.id;
  const [collapsed, setCollapsed] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: categoryKey(categoryId),
    data: { type: "category" },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  const isDropTarget = overInfo?.id === categoryKey(categoryId);

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {isDropTarget && overInfo.isBefore && <DropLine position="top" />}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className="flex items-center px-1"
            {...attributes}
            {...listeners}
          >
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
            >
              <ChevronDown
                className={cn(
                  "size-3 shrink-0 transition-transform",
                  collapsed && "-rotate-90",
                )}
              />
              <span className="truncate">{bucket.name}</span>
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onCreateChannel(categoryId)}>
            <Hash className="size-4" />
            New Channel
          </ContextMenuItem>
          {canManageChannels && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() =>
                  onEditCategory({ id: categoryId, name: bucket.name })
                }
              >
                Edit Category
              </ContextMenuItem>
              <ContextMenuItem
                variant="destructive"
                onClick={() => onDeleteCategory(categoryId)}
              >
                Delete Category
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {isDropTarget && !overInfo.isBefore && <DropLine position="bottom" />}

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
          onDeleteChannel={onDeleteChannel}
          overInfo={overInfo}
        />
      )}
    </div>
  );
}

function ChannelBucket({
  bucket,
  totalChannelCount = 0,
  selectedChannelId,
  activeVoiceChannelId,
  onSelectChannel,
  canManageChannels,
  liveRoom,
  onCreateChannel,
  onEditChannel,
  onDeleteChannel,
  overInfo,
}: {
  bucket: BucketData;
  totalChannelCount?: number;
  selectedChannelId: Id<"channels"> | null;
  activeVoiceChannelId: Id<"channels"> | null;
  onSelectChannel: (channelId: Id<"channels">, type: "text" | "voice") => void;
  canManageChannels: boolean;
  liveRoom: Room | null;
  onCreateChannel: (categoryId: Id<"channelCategories"> | null) => void;
  onEditChannel: (channel: ChannelRow) => void;
  onDeleteChannel: (channelId: Id<"channels">) => void;
  overInfo: { id: string; isBefore: boolean } | null;
}) {
  const { setNodeRef } = useDroppable({
    id: dropzoneKey(bucket.id),
    data: { type: "channel-dropzone", categoryId: bucket.id },
  });

  const noChannelsAtAll = totalChannelCount === 0;

  return (
    <SortableContext
      items={bucket.channels.map((c) => channelKey(c.id))}
      strategy={verticalListSortingStrategy}
    >
      <div ref={setNodeRef} className="mt-1 flex min-h-2 flex-col gap-0.5">
        {bucket.channels.map((channel) => (
          <ChannelItem
            key={channel.id}
            channel={channel}
            active={
              selectedChannelId === channel.id ||
              (channel.type === "voice" && activeVoiceChannelId === channel.id)
            }
            isVoiceActive={
              channel.type === "voice" && activeVoiceChannelId === channel.id
            }
            onSelectChannel={onSelectChannel}
            canManageChannels={canManageChannels}
            liveRoom={liveRoom}
            onEditChannel={onEditChannel}
            onDeleteChannel={onDeleteChannel}
            overInfo={overInfo}
          />
        ))}
        {noChannelsAtAll && bucket.id === null && (
          <p className="px-2 py-1 text-xs text-muted-foreground">
            No channels yet. Right-click to create one.
          </p>
        )}
      </div>
    </SortableContext>
  );
}

/** Only voice channels get the "who's in here" hover card; text channels pass
 * their row straight through. */
function ChannelRowHover({
  channel,
  children,
}: {
  channel: ChannelRow;
  children: React.ReactNode;
}) {
  if (channel.type !== "voice") return <>{children}</>;
  return (
    <VoiceChannelHoverCard channelId={channel.id} channelName={channel.name}>
      {children}
    </VoiceChannelHoverCard>
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
  onDeleteChannel,
  overInfo,
}: {
  channel: ChannelRow;
  active: boolean;
  isVoiceActive: boolean;
  onSelectChannel: (channelId: Id<"channels">, type: "text" | "voice") => void;
  canManageChannels: boolean;
  liveRoom: Room | null;
  onEditChannel: (channel: ChannelRow) => void;
  onDeleteChannel: (channelId: Id<"channels">) => void;
  overInfo: { id: string; isBefore: boolean } | null;
}) {
  const communityId = useSidebarCommunityId();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: channelKey(channel.id),
    data: { type: "channel", categoryId: channel.categoryId },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  const isDropTarget = overInfo?.id === channelKey(channel.id);

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {isDropTarget && overInfo.isBefore && <DropLine position="top" />}
      {isDropTarget && !overInfo.isBefore && <DropLine position="bottom" />}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div {...attributes} {...listeners}>
            <ChannelRowHover channel={channel}>
              <button
                type="button"
                onClick={() => onSelectChannel(channel.id, channel.type)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                  active
                    ? "bg-accent text-foreground hover:bg-accent"
                    : isVoiceActive
                      ? "text-foreground hover:bg-accent/60"
                      : "text-muted-foreground hover:bg-accent/60",
                )}
              >
                {channel.type === "text" ? (
                  <Hash className="size-4 shrink-0" />
                ) : (
                  <Volume2
                    className={cn(
                      "size-4 shrink-0",
                      isVoiceActive && "text-emerald-500",
                    )}
                  />
                )}
                <span className="truncate">{channel.name}</span>
                {isVoiceActive && (
                  <span className="ml-auto text-[10px] text-emerald-500">
                    Connected
                  </span>
                )}
              </button>
            </ChannelRowHover>
          </div>
        </ContextMenuTrigger>
        {canManageChannels && (
          <ContextMenuContent>
            <ContextMenuItem onClick={() => onEditChannel(channel)}>
              Edit Channel
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onClick={() => onDeleteChannel(channel.id)}
            >
              Delete Channel
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>

      {channel.type === "voice" && (
        <VoiceChannelParticipants
          channelId={channel.id}
          communityId={communityId}
          liveRoom={isVoiceActive ? liveRoom : null}
        />
      )}
    </div>
  );
}

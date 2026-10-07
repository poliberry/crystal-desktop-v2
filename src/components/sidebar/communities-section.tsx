"use client";

import { ChannelGlyph } from "@/components/community/channel-glyph";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type Active,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Over,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery } from "convex/react";
import { animate, motion, useMotionValue } from "framer-motion";
import {
  Armchair,
  AtSign,
  BellOff,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  GripVertical,
  Hash,
  LayoutDashboard,
  Plus,
  Settings,
  Star,
  StarOff,
  Users,
  Volume2,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CachedBackground } from "@/components/cached-background";
import { useCall } from "@/components/call/call-provider";
import { useCommunityActions } from "@/components/community/community-actions";
import {
  VoiceChannelHoverCard,
  VoiceChannelParticipants,
} from "@/components/community/voice-channel-participants";
import { useNavigation } from "@/components/home/navigation-context";
import { useTabs } from "@/components/home/tabs-context";
import { useOpenCreateCommunity } from "@/components/pages/page-context";
import { MessagePreview } from "@/components/message-preview";
import { GLASS_BASE, GLASS_NEUTRAL } from "@/components/sidebar/glass";
import { CountBadge, SidebarSectionHeader } from "@/components/sidebar/sidebar-section";
import { useOpenChannel } from "@/components/sidebar/use-open-channel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useCachedQuery } from "@/hooks/use-cached-query";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type Preview = NonNullable<
  NonNullable<ReturnType<typeof useQuery<typeof api.sidebar.communityPreviews>>>[number]["preview"]
>;

interface CommunitySummary {
  id: Id<"communities">;
  name: string;
  imageUrl?: string;
  isOwner: boolean;
}

// --- Drag ids -----------------------------------------------------------------

function communityKey(id: Id<"communities">) {
  return `community:${id}`;
}
function channelKey(id: Id<"channels">) {
  return `chan:${id}`;
}
function dropzoneKey(categoryId: Id<"channelCategories"> | null) {
  return `dropzone:${categoryId ?? "none"}`;
}

/**
 * Hairline drop-position indicator rendered as an absolutely-positioned
 * overlay so it never shifts the layout of surrounding items.
 */
function DropLine({ position }: { position: "top" | "bottom" }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-1 z-30 flex items-center gap-1",
        position === "top" ? "top-0 -translate-y-1/2" : "bottom-0 translate-y-1/2",
      )}
    >
      <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary ring-1 ring-background" />
      <div className="h-px flex-1 rounded-full bg-primary" />
    </div>
  );
}

/**
 * The pointer's viewport Y, kept current on every move. The drop hairline and
 * the landing slot are both derived from this rather than from the dragged
 * ghost's rect: with a `DragOverlay` the ghost's measured rect goes stale
 * mid-drag (and communities vary wildly in height once one is unfolded), so
 * comparing ghost-centre to row-centre freezes or guesses wrong. The cursor
 * against the hovered row's midpoint is what "before / after" means.
 *
 * Null while keyboard-dragging (no pointer position) — callers then fall back
 * to travel direction, which matches the landing slot for single-step moves.
 */
function usePointerY() {
  const ref = useRef<number | null>(null);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      ref.current = e.clientY;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
    };
  }, []);
  return ref;
}

type OverHalf = { id: string; isBefore: boolean };

/**
 * Which half of a sortable row the cursor is in, measured against its LIVE
 * rect. dnd-kit's `over.rect` is measured before the list's shift transforms
 * are applied, so once rows slide to preview the landing the measured rect
 * can sit a whole slot away from where the row is drawn — the live
 * `getBoundingClientRect` (transforms included) is what the cursor is
 * actually over. Rows carry their sortable id in `data-drop-id` for this.
 */
function liveHalf(
  pointerY: React.RefObject<number | null>,
  dropId: string,
): boolean | null {
  const y = pointerY.current;
  if (y == null) return null;
  const node = document.querySelector(`[data-drop-id="${dropId}"]`);
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  if (rect.height === 0) return null;
  return y < rect.top + rect.height / 2;
}

/**
 * What a community says about itself while it is folded: the newest message in
 * it, or — for a server set to mentions only — the newest time somebody
 * pinged you. Two lines, both truncated; the community's name is above them.
 */
function PreviewLines({ preview }: { preview: Preview }) {
  if (preview.kind === "message") {
    return (
      <>
        <p className="flex items-center gap-0.5 truncate text-[11px] text-muted-foreground/80">
          <Hash className="size-3 shrink-0" />
          <span className="truncate">{preview.channelName}</span>
        </p>
        <p className="flex w-full truncate text-xs text-muted-foreground">
          {preview.text ? (
            <MessagePreview text={preview.text} prefix={`${preview.authorName}:`} />
          ) : (
            // A message that was only a file: the file's name is the content.
            <span className="truncate">
              {preview.authorName}: 📎 {preview.attachmentName ?? "Attachment"}
            </span>
          )}
        </p>
      </>
    );
  }

  const target =
    preview.mention === "everyone" ? "@everyone" : preview.mention === "here" ? "@here" : null;
  return (
    <>
      <p
        className={cn(
          "flex items-center gap-1 truncate text-[11px]",
          preview.unread ? "font-medium text-yellow-200" : "text-muted-foreground/80",
        )}
      >
        <AtSign className="size-3 shrink-0" />
        <span className="truncate">
          {preview.authorName} {target ? `pinged ${target}` : "mentioned you"} in #
          {preview.channelName}
        </span>
      </p>
      <p className="flex w-full truncate text-xs text-muted-foreground">
        <MessagePreview text={preview.text} />
      </p>
    </>
  );
}

function CommunityRow({
  community,
  preview,
  muted,
  mentionCount,
  hasUnread,
  voiceCount,
  selected,
  onClick,
}: {
  community: CommunitySummary;
  preview: Preview | null;
  muted: boolean;
  mentionCount: number;
  hasUnread: boolean;
  voiceCount: number;
  selected: boolean;
  onClick: () => void;
}) {
  // Nothing to say under the name — a quiet or muted server — and the row
  // shrinks to match: a smaller picture, centred on one line, rather than a
  // tall row with an empty second line in it.
  const oneLine = !preview;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group/row flex w-full gap-2.5 rounded-xl px-2 text-left outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/10",
        oneLine ? "items-center py-1.5" : "items-start py-2",
        selected && "bg-white/10",
        muted && "opacity-60 hover:opacity-90",
      )}
    >
      <Avatar size="lg" className={cn("rounded-xl", oneLine ? "size-8" : "size-10")}>
        <AvatarImage src={community.imageUrl} alt={community.name} className="rounded-xl" />
        <AvatarFallback className="rounded-xl">
          {community.name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p
            className={cn(
              "truncate text-sm",
              hasUnread || mentionCount > 0 ? "font-semibold" : "font-medium",
            )}
          >
            {community.name}
          </p>
          {muted && <BellOff className="size-3 shrink-0 text-muted-foreground" />}
          {voiceCount > 0 && (
            <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-emerald-500">
              <Volume2 className="size-3" />
              {voiceCount}
            </span>
          )}
        </div>
        {preview && <PreviewLines preview={preview} />}
      </div>
      {mentionCount > 0 ? (
        <CountBadge count={mentionCount} className={oneLine ? undefined : "mt-0.5"} />
      ) : hasUnread && !muted ? (
        <span
          aria-label="Unread messages"
          className={cn("size-2 shrink-0 rounded-full bg-foreground", !oneLine && "mt-2")}
        />
      ) : null}
    </button>
  );
}

// --- The unfolded card -------------------------------------------------------

interface ChannelRowData {
  id: Id<"channels">;
  name: string;
  type: "text" | "voice";
  isLounge?: boolean;
  surface?: string;
  categoryId: Id<"channelCategories"> | null;
  position: number;
}

interface CategoryData {
  id: Id<"channelCategories">;
  name: string;
  position: number;
}

function ChannelRow({
  channel,
  communityId,
  active,
  unread,
  priority,
  voiceConnected,
}: {
  channel: ChannelRowData;
  communityId: Id<"communities">;
  active: boolean;
  unread: boolean;
  priority: boolean;
  /** Whether the running call is this channel. */
  voiceConnected: boolean;
}) {
  const openChannel = useOpenChannel();
  const { controller } = useCall();
  const setPriority = useMutation(api.priority.setChannel);

  const button = (
    <button
      type="button"
      onClick={() => openChannel(communityId, channel.id, channel.type)}
      className={cn(
        "group/channel flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/10",
        active
          ? "bg-white/15 text-foreground"
          : voiceConnected
            ? "text-foreground"
            : "text-muted-foreground",
      )}
    >
      <span className="channel-grip hidden size-3 shrink-0 cursor-grab items-center justify-center text-muted-foreground/50 group-hover/channel:flex">
        <GripVertical className="size-3" />
      </span>
      <ChannelGlyph
        type={channel.type}
        surface={channel.surface}
        isLounge={channel.isLounge}
        className={cn("size-4 shrink-0", channel.type === "voice" && voiceConnected && "text-emerald-500")}
      />
      <span className={cn("truncate", unread && "font-semibold text-foreground")}>
        {channel.name}
      </span>
      {priority && <Star className="size-3 shrink-0 fill-yellow-300 text-yellow-300" />}
      {voiceConnected ? (
        <span className="ml-auto text-[10px] text-emerald-500">Connected</span>
      ) : (
        unread && (
          <span
            aria-label="Unread messages"
            className="ml-auto size-2 shrink-0 rounded-full bg-foreground"
          />
        )
      )}
    </button>
  );

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div>
            {channel.type === "voice" ? (
              <VoiceChannelHoverCard
                channelId={channel.id}
                communityId={communityId}
                channelName={channel.name}
              >
                {button}
              </VoiceChannelHoverCard>
            ) : (
              button
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() => void setPriority({ channelId: channel.id, priority: !priority })}
          >
            {priority ? <StarOff className="size-4" /> : <Star className="size-4" />}
            {priority ? "Remove from Priority" : "Add to Priority"}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {channel.type === "voice" && (
        <VoiceChannelParticipants
          channelId={channel.id}
          communityId={communityId}
          liveRoom={voiceConnected ? controller.room : null}
        />
      )}
    </div>
  );
}

/** A sortable channel row: the whole row drags (distance-gated so clicks still
 * open the channel), with a hairline showing exactly where it will land. */
function SortableChannelRow({
  channel,
  communityId,
  active,
  unread,
  priority,
  voiceConnected,
  dragEnabled,
  overInfo,
}: {
  channel: ChannelRowData;
  communityId: Id<"communities">;
  active: boolean;
  unread: boolean;
  priority: boolean;
  voiceConnected: boolean;
  dragEnabled: boolean;
  overInfo: { id: string; isBefore: boolean } | null;
}) {
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
    disabled: !dragEnabled,
  });

  if (!dragEnabled) {
    return (
      <ChannelRow
        channel={channel}
        communityId={communityId}
        active={active}
        unread={unread}
        priority={priority}
        voiceConnected={voiceConnected}
      />
    );
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };
  const isDropTarget = overInfo?.id === channelKey(channel.id);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative"
      data-drop-id={channelKey(channel.id)}
      {...attributes}
      {...listeners}
    >
      {isDropTarget && overInfo.isBefore && <DropLine position="top" />}
      {isDropTarget && !overInfo.isBefore && <DropLine position="bottom" />}
      <ChannelRow
        channel={channel}
        communityId={communityId}
        active={active}
        unread={unread}
        priority={priority}
        voiceConnected={voiceConnected}
      />
    </div>
  );
}

function CategoryGroup({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-2 first:mt-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-0.5 px-1 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span className="truncate">{name}</span>
      </button>
      {open && <div className="flex flex-col gap-0.5">{children}</div>}
    </div>
  );
}

function NavRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
    >
      <Icon className="size-4 shrink-0" />
      {label}
    </button>
  );
}

interface ChannelBucketData {
  id: Id<"channelCategories"> | null;
  channels: ChannelRowData[];
}

/**
 * A community's channels with drag-and-drop reordering, scoped to that
 * community. Each expanded card owns its own `DndContext` so a channel drag
 * never escapes into the community list around it: the outer list only
 * listens on its own grip handles, this one only on channel rows.
 *
 * Same-bucket reorders and cross-category moves go through the existing
 * `channels.reorder` mutation, which takes the destination bucket's full new
 * ordering — so both are the same call with different buckets.
 */
function CommunityChannelList({
  communityId,
  channels,
  categories,
  activeChannelId,
  activeVoiceId,
  unreadChannelIds,
  priorityChannelIds,
  canManageChannels,
}: {
  communityId: Id<"communities">;
  channels: ChannelRowData[];
  categories: CategoryData[];
  activeChannelId: Id<"channels"> | null;
  activeVoiceId: Id<"channels"> | null;
  unreadChannelIds: Set<string>;
  priorityChannelIds: Set<string>;
  canManageChannels: boolean;
}) {
  const reorderChannels = useMutation(api.channels.reorder);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeItem, setActiveItem] = useState<ChannelRowData | null>(null);
  const [overInfo, setOverInfo] = useState<OverHalf | null>(null);
  const pointerY = usePointerY();
  // Synchronous copy of the indicator for the drop handler — state may not
  // have flushed on the very frame the pointer is released.
  const overRef = useRef<OverHalf | null>(null);

  const collisionDetection: CollisionDetection = useCallback((args) => {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (c) => String(c.id).startsWith("chan:") || String(c.id).startsWith("dropzone:"),
      ),
    });
  }, []);

  const buckets: ChannelBucketData[] = useMemo(() => {
    const sortedCategories = [...categories].sort((a, b) => a.position - b.position);
    const byCategory = new Map<string, ChannelRowData[]>();
    for (const channel of channels) {
      const key = (channel.categoryId ?? "none") as string;
      const list = byCategory.get(key) ?? [];
      list.push(channel);
      byCategory.set(key, list);
    }
    for (const list of byCategory.values()) list.sort((a, b) => a.position - b.position);
    return [
      { id: null, channels: byCategory.get("none") ?? [] },
      ...sortedCategories.map((c) => ({
        id: c.id as Id<"channelCategories"> | null,
        channels: byCategory.get(c.id as string) ?? [],
      })),
    ];
  }, [channels, categories]);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.position - b.position),
    [categories],
  );

  // The hairline follows the cursor continuously — `onDragOver` only fires
  // when the hovered row *changes*, which would freeze the line at each row's
  // entry edge, so the same updater runs on every move too. State only
  // updates when the line actually flips rows or sides.
  const updateChannelHalf = (active: Active, over: Over | null) => {
    if (!over || active.id === over.id) {
      if (overRef.current) {
        overRef.current = null;
        setOverInfo(null);
      }
      return;
    }
    const overData = over.data.current as
      | { type?: string; categoryId?: Id<"channelCategories"> | null }
      | undefined;
    if (overData?.type !== "channel") {
      if (overRef.current) {
        overRef.current = null;
        setOverInfo(null);
      }
      return;
    }
    // Cursor half decides: top half lands before the row, bottom half after —
    // measured against the row's live rect, which includes the shift the list
    // applies to preview the landing. Keyboard drags have no cursor, so the
    // travel direction is the landing side instead.
    let isBefore = liveHalf(pointerY, String(over.id));
    if (isBefore == null && pointerY.current == null) {
      const activeData = active.data.current as
        | { categoryId?: Id<"channelCategories"> | null }
        | undefined;
      if ((overData?.categoryId ?? null) === (activeData?.categoryId ?? null)) {
        const ids = buckets
          .find((b) => b.id === (overData?.categoryId ?? null))
          ?.channels.map((c) => channelKey(c.id));
        const oldIndex = ids?.indexOf(String(active.id)) ?? -1;
        const newIndex = ids?.indexOf(String(over.id)) ?? -1;
        isBefore = newIndex < oldIndex;
      } else {
        isBefore = true;
      }
    }
    if (isBefore == null) return;
    const cur = overRef.current;
    if (!cur || cur.id !== String(over.id) || cur.isBefore !== isBefore) {
      const info = { id: String(over.id), isBefore };
      overRef.current = info;
      setOverInfo(info);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    updateChannelHalf(event.active, event.over);
  };

  const handleDragMove = (event: DragMoveEvent) => {
    updateChannelHalf(event.active, event.over);
  };

  const handleDragStart = (event: DragStartEvent) => {
    overRef.current = null;
    setOverInfo(null);
    const found = channels.find((c) => channelKey(c.id) === String(event.active.id));
    if (found) setActiveItem(found);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const halfAtDrop = overRef.current;
    setActiveItem(null);
    setOverInfo(null);
    overRef.current = null;
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data.current as
      | { type: string; categoryId?: Id<"channelCategories"> | null }
      | undefined;
    const overData = over.data.current as
      | { type: string; categoryId?: Id<"channelCategories"> | null }
      | undefined;
    if (!activeData || activeData.type !== "channel") return;

    const sourceCategoryId = activeData.categoryId ?? null;
    const destCategoryId =
      overData?.type === "channel" || overData?.type === "channel-dropzone"
        ? (overData.categoryId ?? null)
        : undefined;
    if (destCategoryId === undefined) return;

    const destBucket = buckets.find((b) => b.id === destCategoryId);
    if (!destBucket) return;
    const destIds = destBucket.channels.map((c) => channelKey(c.id));
    const activeKey = String(active.id);

    const toIds = (keys: string[]) =>
      keys.map((key) => key.slice(5) as Id<"channels">);

    // Insert exactly where the hairline said: before the hovered row when it
    // sat on top, after it when it sat underneath. The hovered row's index
    // is measured after removing the dragged row, so the slot matches the
    // list as rendered without it. (A cross-category bucket never held the
    // dragged row, so its indices need no adjustment.)
    const base =
      sourceCategoryId === destCategoryId
        ? destIds.filter((k) => k !== activeKey)
        : destIds;

    if (overData?.type !== "channel") {
      // Dropped on the bucket's empty tail: append. Already last means no-op.
      if (base[base.length - 1] === activeKey || destIds[destIds.length - 1] === activeKey)
        return;
      void reorderChannels({
        communityId,
        categoryId: destCategoryId,
        orderedChannelIds: toIds([...base, activeKey]),
      });
      return;
    }

    const overIndex = base.indexOf(String(over.id));
    if (overIndex === -1) return;
    const half = halfAtDrop;
    let next: string[];
    if (half && half.id === String(over.id)) {
      const at = overIndex + (half.isBefore ? 0 : 1);
      next = [...base.slice(0, at), activeKey, ...base.slice(at)];
    } else {
      // No cursor reading (e.g. dropped without a prior over frame): fall
      // back to the classic swap onto the hovered slot.
      const oldIndex = destIds.indexOf(activeKey);
      next =
        sourceCategoryId === destCategoryId && oldIndex !== -1
          ? arrayMove(destIds, oldIndex, destIds.indexOf(String(over.id)))
          : [...base.slice(0, overIndex), activeKey, ...base.slice(overIndex)];
    }
    if (next.join() === destIds.join()) return;
    void reorderChannels({
      communityId,
      categoryId: destCategoryId,
      orderedChannelIds: toIds(next),
    });
  };

  const renderChannel = (channel: ChannelRowData) => (
    <SortableChannelRow
      key={channel.id}
      channel={channel}
      communityId={communityId}
      active={activeChannelId === channel.id}
      unread={unreadChannelIds.has(channel.id as string)}
      priority={priorityChannelIds.has(channel.id as string)}
      voiceConnected={activeVoiceId === channel.id}
      dragEnabled={canManageChannels}
      overInfo={overInfo}
    />
  );

  const uncategorized = buckets[0]?.channels ?? [];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveItem(null);
        setOverInfo(null);
        overRef.current = null;
      }}
    >
      {uncategorized.length > 0 || canManageChannels ? (
        <ChannelDropBucket bucketId={null}>
          <div className="flex flex-col gap-0.5">
            <SortableContext
              items={uncategorized.map((c) => channelKey(c.id))}
              strategy={verticalListSortingStrategy}
            >
              {uncategorized.map(renderChannel)}
            </SortableContext>
          </div>
        </ChannelDropBucket>
      ) : null}
      {sortedCategories.map((category) => {
        const inCategory = buckets.find((b) => b.id === category.id)?.channels ?? [];
        if (inCategory.length === 0) return null;
        return (
          <CategoryGroup key={category.id} name={category.name}>
            <ChannelDropBucket bucketId={category.id}>
              <div className="flex flex-col gap-0.5">
                <SortableContext
                  items={inCategory.map((c) => channelKey(c.id))}
                  strategy={verticalListSortingStrategy}
                >
                  {inCategory.map(renderChannel)}
                </SortableContext>
              </div>
            </ChannelDropBucket>
          </CategoryGroup>
        );
      })}
      <DragOverlay dropAnimation={{ duration: 150, easing: "ease" }}>
        {activeItem && (
          <div className="flex items-center gap-2 rounded-lg bg-white/15 px-2 py-1.5 text-sm opacity-95 shadow-lg backdrop-blur-xl">
            <Hash className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{activeItem.name}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** Invisible end-of-list target so a channel can be dropped after the last row
 * of a bucket, not just onto another row. */
function ChannelDropBucket({
  bucketId,
  children,
}: {
  bucketId: Id<"channelCategories"> | null;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({
    id: dropzoneKey(bucketId),
    data: { type: "channel-dropzone", categoryId: bucketId },
  });
  return (
    <div ref={setNodeRef} className="min-h-1">
      {children}
    </div>
  );
}

/**
 * A community, unfolded: its banner with the name on it and a settings menu in
 * the corner, then the channels in a list that scrolls on its own. The glass
 * surface belongs to {@link CommunityItem}, which grows it out of the row.
 *
 * The settings icon opens the server's menu rather than the settings dialog
 * directly. What that menu offers depends on what the caller may do — invite,
 * create a channel, change settings, leave — and a plain member has no settings
 * to open, so an icon that went straight there would do nothing for most
 * people.
 */
function CommunityCard({
  community,
  unreadChannelIds,
  onCollapse,
}: {
  community: CommunitySummary;
  unreadChannelIds: Set<string>;
  onCollapse: () => void;
}) {
  const nav = useNavigation();
  const { activeTab } = useTabs();
  const { activeCall } = useCall();
  const info = useQuery(api.communities.get, { communityId: community.id });
  const permissions = useQuery(api.roles.myPermissions, { communityId: community.id }) ?? 0;
  const priorityItems = useQuery(api.priority.list);
  const rawChannels = useCachedQuery(
    api.channels.list,
    { communityId: community.id },
    `channels.list:${community.id}`,
  );
  const rawCategories = useCachedQuery(
    api.channelCategories.list,
    { communityId: community.id },
    `channelCategories.list:${community.id}`,
  );
  const { items: actions, dialogs } = useCommunityActions({
    communityId: community.id,
    isOwner: community.isOwner,
  });

  const priorityChannelIds = useMemo(
    () =>
      new Set(
        (priorityItems ?? []).flatMap((item) =>
          item.kind === "channel" ? [item.channelId as string] : [],
        ),
      ),
    [priorityItems],
  );

  const channels = ((rawChannels ?? []) as ChannelRowData[])
    .slice()
    .sort((a, b) => a.position - b.position);
  const categories = (rawCategories ?? []) as CategoryData[];
  const loading = rawChannels === undefined || rawCategories === undefined;

  const target = activeTab.target;
  const activeChannelId = target.type === "channel" ? target.channelId : null;
  const activeVoiceId = activeCall?.kind === "channel" ? activeCall.channelId : null;

  const canSeeMembers =
    hasPermission(permissions, PERMISSIONS.KICK_MEMBERS) ||
    hasPermission(permissions, PERMISSIONS.BAN_MEMBERS) ||
    hasPermission(permissions, PERMISSIONS.MODERATE_MEMBERS) ||
    hasPermission(permissions, PERMISSIONS.MANAGE_ROLES);
  const canManageChannels = hasPermission(permissions, PERMISSIONS.MANAGE_CHANNELS);

  const bannerUrl = info?.bannerUrl;

  return (
    <div className="flex flex-col">
      <div className="relative h-24 shrink-0">
        {bannerUrl ? (
          <CachedBackground
            url={bannerUrl}
            className="absolute inset-0 bg-cover bg-center"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent" />
        )}
        {/* Darkened at the top for the name and the buttons, and faded out
            into the card at the bottom so the banner doesn't end on a hard
            line. */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-black/10 to-black/40" />

        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
          <p className="min-w-0 truncate text-sm font-semibold text-white drop-shadow">
            {community.name}
          </p>
          <div className="flex shrink-0 items-center gap-0.5">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Community settings"
                  className="size-7 rounded-full bg-black/30 text-white hover:bg-black/50 hover:text-white"
                >
                  <Settings className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {actions.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Fragment key={item.key}>
                      {item.separatorBefore && <DropdownMenuSeparator />}
                      <DropdownMenuItem
                        variant={item.destructive ? "destructive" : "default"}
                        onClick={item.onSelect}
                      >
                        <Icon className="size-4" />
                        {item.label}
                      </DropdownMenuItem>
                    </Fragment>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Collapse"
              onClick={onCollapse}
              className="size-7 rounded-full bg-black/30 text-white hover:bg-black/50 hover:text-white"
            >
              <ChevronUp className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-0.5 px-1.5 pt-1.5">
        <NavRow
          icon={LayoutDashboard}
          label="Overview"
          onClick={() => nav.openCommunityOverview(community.id)}
        />
        {canSeeMembers && (
          <NavRow
            icon={Users}
            label="Members"
            onClick={() => nav.openCommunityMembers(community.id)}
          />
        )}
      </div>

      <ScrollArea className="max-h-[min(20rem,45vh)]">
        <div className="p-1.5">
          {loading ? (
            <div className="flex flex-col gap-1">
              <Skeleton className="h-7 rounded-lg" />
              <Skeleton className="h-7 rounded-lg" />
              <Skeleton className="h-7 rounded-lg" />
            </div>
          ) : channels.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              No channels yet.
            </p>
          ) : (
            <CommunityChannelList
              communityId={community.id}
              channels={channels}
              categories={categories}
              activeChannelId={activeChannelId}
              activeVoiceId={activeVoiceId}
              unreadChannelIds={unreadChannelIds}
              priorityChannelIds={priorityChannelIds}
              canManageChannels={canManageChannels}
            />
          )}
        </div>
      </ScrollArea>

      {dialogs}
    </div>
  );
}

// --- The section -------------------------------------------------------------

function CommunitiesSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-2.5 px-2 py-2">
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-3.5" style={{ width: `${40 + i * 15}%` }} />
            <Skeleton className="h-3" style={{ width: `${65 - i * 10}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// --- The morph ---------------------------------------------------------------

const MORPH_SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };

/** A node's height, kept current. `null` until it has been measured, and again
 * while it isn't mounted. */
function useMeasuredHeight() {
  const [height, setHeight] = useState<number | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) {
      setHeight(null);
      return;
    }
    setHeight(node.offsetHeight);
    const next = new ResizeObserver(() => setHeight(node.offsetHeight));
    next.observe(node);
    observer.current = next;
  }, []);
  return [ref, height] as const;
}

/**
 * A community's row and its unfolded card as one box that changes size.
 *
 * Opening a community used to swap the row for the card with a fade, so the
 * list jumped by however much taller the card is. Here the glass surface fades
 * in around the row and grows to the card's height on a spring, while the row
 * dissolves into the card from the top down — the row is the card, closed.
 *
 * Both are laid over each other and measured rather than stacked, so the box's
 * height is just whichever one is showing. The card — which runs half a dozen
 * queries — is only mounted while it is open or on its way shut.
 */
function CommunityItem({
  expanded,
  row,
  card,
}: {
  expanded: boolean;
  row: React.ReactNode;
  card: React.ReactNode;
}) {
  const [rowRef, rowHeight] = useMeasuredHeight();
  const [cardRef, cardHeight] = useMeasuredHeight();
  const [cardMounted, setCardMounted] = useState(expanded);
  if (expanded && !cardMounted) setCardMounted(true);

  const target = expanded ? (cardHeight ?? rowHeight) : rowHeight;
  const height = useMotionValue<number | "auto">("auto");
  const placed = useRef(false);

  useLayoutEffect(() => {
    if (target === null) return;
    // The first measurement is where the box starts, not something to grow to.
    if (!placed.current) {
      placed.current = true;
      height.set(target);
      return;
    }
    const controls = animate(height, target, {
      ...MORPH_SPRING,
      onComplete: () => {
        if (!expanded) setCardMounted(false);
      },
    });
    return () => controls.stop();
  }, [target, expanded, height]);

  return (
    <motion.div className="relative" style={{ height }}>
      {/* A layer of its own, so the shadow isn't clipped by the box that clips
          the contents, and so it can fade rather than snap. */}
      <motion.div
        aria-hidden
        className={cn(GLASS_BASE, GLASS_NEUTRAL, "absolute inset-0")}
        initial={false}
        animate={{ opacity: expanded ? 1 : 0 }}
        transition={{ duration: 0.2 }}
      />
      <div className="relative h-full overflow-hidden rounded-2xl">
        <motion.div
          ref={rowRef}
          className="absolute inset-x-0 top-0"
          initial={false}
          animate={{ opacity: expanded ? 0 : 1 }}
          transition={{ duration: 0.15 }}
          style={{ pointerEvents: expanded ? "none" : "auto" }}
          aria-hidden={expanded}
          inert={expanded}
        >
          {row}
        </motion.div>
        {cardMounted && (
          <motion.div
            ref={cardRef}
            className="absolute inset-x-0 top-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: expanded ? 1 : 0 }}
            transition={{ duration: 0.2, delay: expanded ? 0.05 : 0 }}
          >
            {card}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * One community in the sidebar list, made reorderable. The sortable transform
 * lives on the outer wrapper so it never fights the morph's height animation
 * inside; only the grip handle starts the drag, so expanding, opening channels
 * and dragging channels in the unfolded card never trip it.
 */
function SortableCommunity({
  community,
  expanded,
  row,
  card,
  overInfo,
}: {
  community: CommunitySummary;
  expanded: boolean;
  row: React.ReactNode;
  card: React.ReactNode;
  overInfo: { id: string; isBefore: boolean } | null;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: communityKey(community.id),
    data: { type: "community", communityId: community.id },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 20 : undefined,
    position: "relative" as const,
  };
  const isDropTarget = overInfo?.id === communityKey(community.id);

  const gripClass =
    "flex w-4 shrink-0 cursor-grab touch-none items-center justify-center self-stretch rounded-md text-muted-foreground/40 opacity-0 transition-opacity hover:bg-white/10 hover:text-muted-foreground focus-visible:opacity-100 active:cursor-grabbing group-hover/community:opacity-100 [@media(hover:none)]:opacity-70";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className="group/community relative"
      data-drop-id={communityKey(community.id)}
    >
      {isDropTarget && overInfo.isBefore && <DropLine position="top" />}
      <div className={cn("relative", !expanded && "flex items-stretch gap-0.5")}>
        <div className={cn(!expanded && "min-w-0 flex-1")}>
          {/* Keep this component at one stable tree position. Remounting it
              when the grip changes from inline to overlay makes its first
              measurement the expanded height, skipping the morph. */}
          <CommunityItem expanded={expanded} row={row} card={card} />
        </div>
        <div
          {...listeners}
          role="button"
          tabIndex={0}
          aria-label={`Drag to reorder ${community.name}`}
          title={expanded ? "Drag to reorder (or focus and press Space)" : "Drag to reorder"}
          className={cn(
            gripClass,
            expanded
              ? "absolute top-2.5 left-1 z-20 h-7 bg-black/30 text-white/70 opacity-0 hover:bg-black/50 hover:text-white group-hover/community:opacity-100"
              : "my-1",
          )}
        >
          <GripVertical className="size-3.5" />
        </div>
      </div>
      {isDropTarget && !overInfo.isBefore && <DropLine position="bottom" />}
    </div>
  );
}

export function CommunitiesSection() {
  const nav = useNavigation();
  const { activeTab } = useTabs();
  const [expandedId, setExpandedId] = useState<Id<"communities"> | null>(null);
  const openCreateCommunity = useOpenCreateCommunity();
  const reorderSidebar = useMutation(api.communities.reorderSidebar);

  const rawCommunities = useCachedQuery(
    api.communities.listMine,
    {},
    "communities.listMine",
  );
  const activity = useQuery(api.communities.listMineActivity);
  const previews = useQuery(api.sidebar.communityPreviews);
  const serverOrder = useQuery(api.communities.getSidebarOrder) ?? [];

  const communities = (rawCommunities ?? []) as CommunitySummary[];
  const activityById = useMemo(
    () => new Map((activity ?? []).map((entry) => [entry.communityId as string, entry])),
    [activity],
  );
  const previewById = useMemo(
    () => new Map((previews ?? []).map((entry) => [entry.communityId as string, entry])),
    [previews],
  );

  // Personal order, optimistically applied so the drop lands instantly and
  // stays put while the mutation round-trips. Newly joined communities that
  // aren't in any order yet fall to the end.
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const orderedCommunities = useMemo(() => {
    const byId = new Map(communities.map((c) => [c.id as string, c]));
    const orderIds =
      localOrder ?? (serverOrder as Id<"communities">[]).map((id) => id as string);
    const seen = new Set<string>();
    const out: CommunitySummary[] = [];
    for (const id of orderIds) {
      const c = byId.get(id);
      if (c && !seen.has(id)) {
        out.push(c);
        seen.add(id);
      }
    }
    for (const c of communities) {
      const key = c.id as string;
      if (!seen.has(key)) {
        out.push(c);
        seen.add(key);
      }
    }
    return out;
  }, [communities, serverOrder, localOrder]);

  // Once the server echoes the order back, the optimistic copy has done its
  // job and can go — keeping it would pin any community joined elsewhere.
  useEffect(() => {
    if (!localOrder) return;
    const serverIds = (serverOrder as Id<"communities">[]).map((id) => id as string);
    if (
      serverIds.length === localOrder.length &&
      serverIds.every((id, i) => id === localOrder[i])
    ) {
      setLocalOrder(null);
    }
  }, [serverOrder, localOrder]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeCommunity, setActiveCommunity] = useState<CommunitySummary | null>(null);
  const [communityOver, setCommunityOver] = useState<OverHalf | null>(null);
  const communityPointerY = usePointerY();
  // Synchronous copy of the indicator for the drop handler — state may not
  // have flushed on the very frame the pointer is released.
  const communityOverRef = useRef<OverHalf | null>(null);

  const communityCollision: CollisionDetection = useCallback((args) => {
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) =>
        String(c.id).startsWith("community:"),
      ),
    });
  }, []);

  const handleCommunityDragStart = (event: DragStartEvent) => {
    communityOverRef.current = null;
    setCommunityOver(null);
    const id = String(event.active.id).slice("community:".length);
    const found = communities.find((c) => (c.id as string) === id);
    if (found) setActiveCommunity(found);
  };

  // Like channels below: the line tracks the cursor on every move, not just
  // when the hovered community changes — otherwise it freezes at each row's
  // entry edge. Cursor halves stay truthful even when rows differ wildly in
  // height (an unfolded card towers over a collapsed row).
  const updateCommunityHalf = (active: Active, over: Over | null) => {
    if (!over || active.id === over.id) {
      if (communityOverRef.current) {
        communityOverRef.current = null;
        setCommunityOver(null);
      }
      return;
    }
    let isBefore = liveHalf(communityPointerY, String(over.id));
    if (isBefore == null && communityPointerY.current == null) {
      const ids = orderedCommunities.map((c) => c.id as string);
      const oldIndex = ids.indexOf(String(active.id).slice("community:".length));
      const newIndex = ids.indexOf(String(over.id).slice("community:".length));
      isBefore = newIndex < oldIndex;
    }
    if (isBefore == null) return;
    const cur = communityOverRef.current;
    if (!cur || cur.id !== String(over.id) || cur.isBefore !== isBefore) {
      const info = { id: String(over.id), isBefore };
      communityOverRef.current = info;
      setCommunityOver(info);
    }
  };

  const handleCommunityDragOver = (event: DragOverEvent) => {
    updateCommunityHalf(event.active, event.over);
  };

  const handleCommunityDragMove = (event: DragMoveEvent) => {
    updateCommunityHalf(event.active, event.over);
  };

  const handleCommunityDragEnd = (event: DragEndEvent) => {
    const halfAtDrop = communityOverRef.current;
    setActiveCommunity(null);
    setCommunityOver(null);
    communityOverRef.current = null;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id).slice("community:".length);
    const overId = String(over.id).slice("community:".length);
    const ids = orderedCommunities.map((c) => c.id as string);
    if (!ids.includes(activeId) || !ids.includes(overId)) return;
    // Land exactly where the hairline said: remove the dragged community,
    // then insert before/after the hovered one. The hovered index is measured
    // after the removal so the slot matches the rendered list.
    const half = halfAtDrop;
    let nextIds: string[];
    if (half && half.id === String(over.id)) {
      const base = ids.filter((id) => id !== activeId);
      const at = base.indexOf(overId) + (half.isBefore ? 0 : 1);
      nextIds = [...base.slice(0, at), activeId, ...base.slice(at)];
    } else {
      // No cursor reading (e.g. dropped without a prior over frame): fall
      // back to the classic swap onto the hovered slot.
      const oldIndex = ids.indexOf(activeId);
      nextIds = arrayMove(orderedCommunities, oldIndex, ids.indexOf(overId)).map(
        (c) => c.id as string,
      );
    }
    if (nextIds.join() === ids.join()) return;
    setLocalOrder(nextIds);
    void reorderSidebar({
      orderedCommunityIds: nextIds as Id<"communities">[],
    }).catch(() => setLocalOrder(null));
  };

  const handleCommunityDragCancel = () => {
    setActiveCommunity(null);
    setCommunityOver(null);
    communityOverRef.current = null;
  };

  const target = activeTab.target;
  const activeCommunityId = target.type === "channel" ? target.communityId : null;

  return (
    <section className="flex flex-col gap-1">
      <SidebarSectionHeader
        title="Communities"
        action={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Create a community"
            title="Create a community"
            className="size-6 text-muted-foreground"
            onClick={openCreateCommunity}
          >
            <Plus className="size-4" />
          </Button>
        }
      />

      {rawCommunities === undefined ? (
        <CommunitiesSkeleton />
      ) : communities.length === 0 ? (
        <p className="px-2 py-4 text-center text-xs text-muted-foreground">
          You haven’t joined any communities yet.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={communityCollision}
          onDragStart={handleCommunityDragStart}
          onDragOver={handleCommunityDragOver}
          onDragMove={handleCommunityDragMove}
          onDragEnd={handleCommunityDragEnd}
          onDragCancel={handleCommunityDragCancel}
        >
          <SortableContext
            items={orderedCommunities.map((c) => communityKey(c.id))}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-0.5">
              {orderedCommunities.map((community) => {
                const stats = activityById.get(community.id);
                const entry = previewById.get(community.id);
                const expanded = expandedId === community.id;

                return (
                  <SortableCommunity
                    key={community.id}
                    community={community}
                    expanded={expanded}
                    overInfo={communityOver}
                    row={
                      <CommunityRow
                        community={community}
                        preview={entry?.preview ?? null}
                        muted={entry?.muted ?? false}
                        mentionCount={stats?.mentionCount ?? 0}
                        hasUnread={(stats?.unreadChannelIds.length ?? 0) > 0}
                        voiceCount={stats?.voiceCount ?? 0}
                        selected={activeCommunityId === community.id}
                        onClick={() => {
                          setExpandedId(community.id);
                          nav.openCommunity(community.id);
                        }}
                      />
                    }
                    card={
                      <CommunityCard
                        community={community}
                        unreadChannelIds={
                          new Set((stats?.unreadChannelIds ?? []).map((id) => id as string))
                        }
                        onCollapse={() => setExpandedId(null)}
                      />
                    }
                  />
                );
              })}
            </div>
          </SortableContext>
          <DragOverlay dropAnimation={{ duration: 180, easing: "ease" }}>
            {activeCommunity && (
              <div className="flex items-center gap-2.5 rounded-xl bg-white/15 px-2 py-2 opacity-95 shadow-lg backdrop-blur-xl">
                <Avatar size="lg" className="size-8 rounded-xl">
                  <AvatarImage
                    src={activeCommunity.imageUrl}
                    alt={activeCommunity.name}
                    className="rounded-xl"
                  />
                  <AvatarFallback className="rounded-xl">
                    {activeCommunity.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <p className="truncate text-sm font-medium">{activeCommunity.name}</p>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </section>
  );
}

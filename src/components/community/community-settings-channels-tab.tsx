"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useConvex, useMutation, useQuery } from "convex/react";
import {
  Check,
  GripVertical,
  Hash,
  ImagePlus,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Search,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DEFAULT_BACKGROUND_OPACITY } from "@/components/chat-decoration";
import { ChannelGlyph } from "@/components/community/channel-glyph";
import { CreateCategoryDialog } from "@/components/community/create-category-dialog";
import { EditCategoryDialog } from "@/components/community/edit-category-dialog";
import { LOUNGE_SCENES, SceneThumbnail } from "@/lib/lounge-scenes";
import { SettingsCard } from "@/components/settings/settings-ui";
import { useConfirmLeave, useSettingsDraft } from "@/components/settings/settings-save";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { uploadImage } from "@/lib/cdn-upload";
import {
  PERMISSION_DESCRIPTIONS,
  PERMISSION_LABELS,
  PERMISSIONS,
  TEXT_PERMISSION_KEYS,
  UNENFORCED_PERMISSIONS,
  VOICE_PERMISSION_KEYS,
  bitsHas,
  bitsOr,
  bitsWithout,
  type PermissionKey,
} from "@/lib/permissions";
import { MAX_PROFILE_ASSET_BYTES, MAX_PROFILE_ASSET_LABEL } from "@/lib/upload-limits";
import { cn } from "@/lib/utils";

interface CommunitySettingsChannelsTabProps {
  communityId: Id<"communities">;
  canManage: boolean;
  /** Open on this channel rather than the first. */
  initialChannelId?: Id<"channels">;
}

type ChannelRow = {
  id: Id<"channels">;
  name: string;
  type: "text" | "voice";
  surface?: string;
  isLounge?: boolean;
  isAnnouncement?: boolean;
  topic?: string;
  categoryId: Id<"channelCategories"> | null;
};

/**
 * Channels, one at a time: the list down the side, and for whichever is chosen
 * its name and topic, who can do what in it, and how it looks.
 *
 * Everything is a draft, saved from the page's one bar. Moving to another
 * channel with edits outstanding asks first, since the edits are to this one.
 */
export function CommunitySettingsChannelsTab({
  communityId,
  canManage,
  initialChannelId,
}: CommunitySettingsChannelsTabProps) {
  const channels = (useQuery(api.channels.list, { communityId }) ?? []) as ChannelRow[];
  const categories = useQuery(api.channelCategories.list, { communityId }) ?? [];
  const reorderCategories = useMutation(api.channelCategories.reorder);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const confirmLeave = useConfirmLeave();
  const [selectedId, setSelectedId] = useState<Id<"channels"> | null>(initialChannelId ?? null);
  // Asked for a different channel while this was already open.
  useEffect(() => {
    if (initialChannelId) setSelectedId(initialChannelId);
  }, [initialChannelId]);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState<{
    id: Id<"channelCategories">;
    name: string;
  } | null>(null);

  // Something is always open: the first channel until one is chosen, and the
  // first that is left when the open one is deleted.
  const selected = channels.find((c) => c.id === selectedId) ?? channels[0] ?? null;

  const select = (id: Id<"channels">) => {
    if (id === selected?.id) return;
    if (!confirmLeave()) return;
    setSelectedId(id);
  };

  const groups = useMemo(() => {
    const byCategory = new Map<string | null, ChannelRow[]>();
    for (const channel of channels) {
      const key = channel.categoryId;
      byCategory.set(key, [...(byCategory.get(key) ?? []), channel]);
    }
    return [
      { id: null as string | null, name: null as string | null, channels: byCategory.get(null) ?? [] },
      ...categories.map((category: { id: string; name: string }) => ({
        id: category.id as string | null,
        name: category.name as string | null,
        channels: byCategory.get(category.id as never) ?? [],
      })),
      // A category with nothing in it yet is still a category: it has to show
      // here, or a new one looks like it was never made.
    ].filter((group) => group.id !== null || group.channels.length > 0);
  }, [channels, categories]);

  const categoryIds = categories.map((c: { id: string }) => c.id);

  const handleCategoryDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = categoryIds.indexOf(String(active.id));
    const to = categoryIds.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    void reorderCategories({
      communityId,
      orderedCategoryIds: arrayMove(categoryIds, from, to) as Id<"channelCategories">[],
    });
  };

  const renderChannel = (channel: ChannelRow) => (
    <button
      key={channel.id}
      type="button"
      onClick={() => select(channel.id)}
      aria-current={channel.id === selected?.id ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        channel.id === selected?.id
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <ChannelGlyph type={channel.type} surface={channel.surface} isLounge={channel.isLounge} isAnnouncement={channel.isAnnouncement} className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{channel.name}</span>
    </button>
  );

  if (channels.length === 0 && categories.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No channels yet.</p>;
  }

  return (
    <div className="flex items-start gap-6">
      <nav aria-label="Channels" className="sticky top-4 w-52 shrink-0 space-y-3 self-start">
        {groups.map((group) =>
          group.id === null ? (
            <div key="uncategorised" className="space-y-0.5">
              {group.channels.map(renderChannel)}
            </div>
          ) : null,
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleCategoryDragEnd}>
          <SortableContext items={categoryIds} strategy={verticalListSortingStrategy}>
            {groups.map((group) =>
              group.id === null ? null : (
                <SortableCategory key={group.id} id={group.id} canManage={canManage}>
                  {(handle) => (
                    <>
                      <div className="group/category flex items-center gap-1 px-2 pb-0.5">
                        {handle}
                        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                          {group.name}
                        </p>
                        {canManage && (
                          <button
                            type="button"
                            aria-label={`Edit category ${group.name}`}
                            onClick={() =>
                              setEditingCategory({
                                id: group.id as Id<"channelCategories">,
                                name: group.name as string,
                              })
                            }
                            className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/category:opacity-100 hover:text-foreground focus-visible:opacity-100"
                          >
                            <Pencil className="size-3" />
                          </button>
                        )}
                      </div>
                      {group.channels.length === 0 && (
                        <p className="px-2 py-1 text-xs text-muted-foreground">No channels yet.</p>
                      )}
                      {group.channels.map(renderChannel)}
                    </>
                  )}
                </SortableCategory>
              ),
            )}
          </SortableContext>
        </DndContext>
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground"
            onClick={() => setCreatingCategory(true)}
          >
            <Plus className="size-4" />
            New category
          </Button>
        )}
      </nav>

      <div className="min-w-0 flex-1">
        {selected && (
          // Keyed, so a different channel starts from its own stored values and
          // none of the last one's edits.
          <ChannelEditor
            key={selected.id}
            communityId={communityId}
            channel={selected}
            canManage={canManage}
            onDeleted={() => setSelectedId(null)}
          />
        )}
      </div>

      <CreateCategoryDialog communityId={communityId} open={creatingCategory} onOpenChange={setCreatingCategory} />
      <EditCategoryDialog category={editingCategory} onOpenChange={(open) => !open && setEditingCategory(null)} />
    </div>
  );
}

/** One category in the list, draggable by its grip. Only managers get the grip. */
function SortableCategory({
  id,
  canManage,
  children,
}: {
  id: string;
  canManage: boolean;
  children: (handle: React.ReactNode) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !canManage,
  });
  const handle = canManage ? (
    <button
      type="button"
      aria-label="Drag to reorder category"
      className="-ml-1 shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-3" />
    </button>
  ) : null;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      className="space-y-0.5"
    >
      {children(handle)}
    </div>
  );
}

/** Who is receiving an announcements channel: how many newsfeeds, and the channels it is copied into. */
function AnnouncementFollowers({ channelId }: { channelId: Id<"channels"> }) {
  const followers = useQuery(api.announcements.listForChannel, { channelId });
  const unfollow = useMutation(api.announcements.unfollow);
  if (!followers) return null;
  return (
    <SettingsCard className="space-y-2 px-4 py-3">
      <div>
        <p className="text-sm font-medium">Followers</p>
        <p className="text-xs text-muted-foreground">
          {followers.feedCount === 1 ? "1 person follows" : `${followers.feedCount} people follow`} this in their
          newsfeed. Followers can read it without joining.
        </p>
      </div>
      {followers.forwards.length > 0 ? (
        <ul className="space-y-1">
          {followers.forwards.map((forward) => (
            <li key={forward.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                Sent to # {forward.targetChannelName}{" "}
                <span className="text-muted-foreground">· {forward.targetCommunityName}</span>
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                aria-label="Stop sending there"
                onClick={() => void unfollow({ followId: forward.id })}
              >
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No community is passing it on yet.</p>
      )}
    </SettingsCard>
  );
}

// --- One channel --------------------------------------------------------------

type EditorTab = "overview" | "permissions" | "appearance";

/** One role's or member's overwrite, as held in the draft. */
interface OverwriteDraft {
  key: string;
  roleId?: Id<"roles">;
  userId?: Id<"users">;
  allow: number;
  deny: number;
}

const roleKey = (id: string) => `r:${id}`;
const userKey = (id: string) => `u:${id}`;

function useObjectUrl(file: File | null): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

function ChannelEditor({
  communityId,
  channel,
  canManage,
  onDeleted,
}: {
  communityId: Id<"communities">;
  channel: ChannelRow;
  canManage: boolean;
  onDeleted: () => void;
}) {
  const convex = useConvex();
  const details = useQuery(api.channels.get, { channelId: channel.id });
  const serverOverwrites = useQuery(api.channels.listOverwrites, { channelId: channel.id });
  const roles = useQuery(api.roles.list, { communityId }) ?? [];
  const members = useQuery(api.communities.listMembers, { communityId }) ?? [];

  const update = useMutation(api.channels.update);
  const setAnnouncement = useMutation(api.channels.setAnnouncement);
  const remove = useMutation(api.channels.remove);
  const setBackground = useMutation(api.channels.setBackground);
  const setBanner = useMutation(api.channels.setBanner);
  const generateAssetUrl = useMutation(api.channels.generateChannelAssetUploadUrl);
  const setOverwrite = useMutation(api.channels.setOverwrite);
  const removeOverwrite = useMutation(api.channels.removeOverwrite);

  const isText = channel.type === "text";
  const [tab, setTab] = useState<EditorTab>("overview");

  // The draft. `null` overwrites means "not loaded yet", which is not the same
  // as "there are none".
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [bgFile, setBgFile] = useState<File | null>(null);
  const [bgCleared, setBgCleared] = useState(false);
  const [bgOpacity, setBgOpacity] = useState(DEFAULT_BACKGROUND_OPACITY);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerCleared, setBannerCleared] = useState(false);
  const [bannerTitle, setBannerTitle] = useState("");
  const [bannerDescription, setBannerDescription] = useState("");
  const [overwrites, setOverwrites] = useState<Record<string, OverwriteDraft> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingAnnouncement, setTogglingAnnouncement] = useState(false);
  const [announcementNote, setAnnouncementNote] = useState<string | null>(null);

  const bgPreview = useObjectUrl(bgFile);
  const bannerPreview = useObjectUrl(bannerFile);

  const seededDetails = useRef(false);
  const seedFromDetails = () => {
    if (!details) return;
    setName(details.name);
    setTopic(details.topic ?? "");
    setBgOpacity(details.backgroundOpacity ?? DEFAULT_BACKGROUND_OPACITY);
    setBannerTitle(details.bannerTitle ?? "");
    setBannerDescription(details.bannerDescription ?? "");
    setBgFile(null);
    setBgCleared(false);
    setBannerFile(null);
    setBannerCleared(false);
  };
  useEffect(() => {
    if (!details || seededDetails.current) return;
    seededDetails.current = true;
    seedFromDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details]);

  /** Applies at once, like the decoration: it is a kind of channel, not a field to save. */
  const toggleAnnouncement = async (enabled: boolean) => {
    setTogglingAnnouncement(true);
    setError(null);
    setAnnouncementNote(null);
    try {
      const { removed } = await setAnnouncement({ channelId: channel.id, enabled });
      // The server made @everyone read-only here. Mirror it in the draft, or the permissions
      // tab would see a stored overwrite it doesn't know about and offer to delete it.
      if (enabled) {
        setOverwrites((current) => {
          const everyone = roles.find((r) => r.isEveryone);
          if (!current || !everyone) return current;
          const key = roleKey(everyone.id);
          const draft = current[key] ?? { key, roleId: everyone.id, allow: 0, deny: 0 };
          return { ...current, [key]: withState(draft, PERMISSIONS.SEND_MESSAGES, "deny") };
        });
      }
      setAnnouncementNote(
        enabled
          ? `Only people you allow under Permissions can post here now.${removed ? ` ${removed} forward${removed === 1 ? "" : "s"} into this channel ${removed === 1 ? "was" : "were"} removed.` : ""}`
          : `It's a regular text channel again. Who can post is unchanged — adjust it under Permissions.${removed ? ` ${removed} follower${removed === 1 ? "" : "s"} removed.` : ""}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setTogglingAnnouncement(false);
    }
  };

  const toDraft = (list: NonNullable<typeof serverOverwrites>) =>
    Object.fromEntries(
      list.map((o) => {
        const key = o.roleId ? roleKey(o.roleId) : userKey(o.userId!);
        return [key, { key, roleId: o.roleId, userId: o.userId, allow: o.allow, deny: o.deny }];
      }),
    ) as Record<string, OverwriteDraft>;

  const seededOverwrites = useRef(false);
  useEffect(() => {
    if (!serverOverwrites || seededOverwrites.current) return;
    seededOverwrites.current = true;
    setOverwrites(toDraft(serverOverwrites));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverOverwrites]);

  // --- What differs from what is stored -------------------------------------

  const serverByKey = useMemo(() => {
    const map = new Map<string, NonNullable<typeof serverOverwrites>[number]>();
    for (const o of serverOverwrites ?? []) map.set(o.roleId ? roleKey(o.roleId) : userKey(o.userId!), o);
    return map;
  }, [serverOverwrites]);

  const overwriteChanges = useMemo(() => {
    if (!overwrites || !serverOverwrites) return { added: [], changed: [], removed: [] as typeof serverOverwrites };
    const added: OverwriteDraft[] = [];
    const changed: OverwriteDraft[] = [];
    for (const draft of Object.values(overwrites)) {
      const stored = serverByKey.get(draft.key);
      if (!stored) added.push(draft);
      else if (stored.allow !== draft.allow || stored.deny !== draft.deny) changed.push(draft);
    }
    const removed = serverOverwrites.filter(
      (o) => !overwrites[o.roleId ? roleKey(o.roleId) : userKey(o.userId!)],
    );
    return { added, changed, removed };
  }, [overwrites, serverOverwrites, serverByKey]);

  const storedOpacity = details?.backgroundOpacity ?? DEFAULT_BACKGROUND_OPACITY;
  const hasBackground = !!details?.backgroundUrl && !bgCleared;
  const flags = {
    name: !!details && name.trim() !== details.name,
    topic: isText && !!details && topic !== (details.topic ?? ""),
    background: !!bgFile || bgCleared,
    opacity: !bgFile && !bgCleared && hasBackground && Math.abs(bgOpacity - storedOpacity) > 0.004,
    banner: !!bannerFile || bannerCleared,
    bannerTitle: !bannerCleared && !!details && bannerTitle !== (details.bannerTitle ?? ""),
    bannerDescription:
      !bannerCleared && !!details && bannerDescription !== (details.bannerDescription ?? ""),
  };
  const changes =
    Object.values(flags).filter(Boolean).length +
    overwriteChanges.added.length +
    overwriteChanges.changed.length +
    (overwriteChanges.removed?.length ?? 0);

  const reset = () => {
    seedFromDetails();
    if (serverOverwrites) setOverwrites(toDraft(serverOverwrites));
    setError(null);
  };

  useSettingsDraft({
    changes: canManage ? changes : 0,
    discard: reset,
    save: async () => {
      if (!name.trim()) throw new Error("Channel name can't be empty.");

      if (flags.name || flags.topic) {
        await update({
          channelId: channel.id,
          ...(flags.name ? { name } : {}),
          ...(flags.topic ? { topic } : {}),
        });
      }

      if (bgFile) {
        const uploaded = await uploadImage(convex, bgFile, "backgrounds", () =>
          generateAssetUrl({ channelId: channel.id }),
        );
        await setBackground({ channelId: channel.id, ...uploaded, opacity: bgOpacity });
      } else if (bgCleared) {
        await setBackground({ channelId: channel.id, clear: true });
      } else if (flags.opacity) {
        await setBackground({ channelId: channel.id, opacity: bgOpacity });
      }

      if (bannerCleared) {
        // Removing the banner removes its words as well.
        await setBanner({ channelId: channel.id, clear: true });
      } else {
        if (bannerFile) {
          const uploaded = await uploadImage(convex, bannerFile, "backgrounds", () =>
            generateAssetUrl({ channelId: channel.id }),
          );
          await setBanner({ channelId: channel.id, ...uploaded });
        }
        if (flags.bannerTitle || flags.bannerDescription) {
          await setBanner({
            channelId: channel.id,
            ...(flags.bannerTitle ? { title: bannerTitle } : {}),
            ...(flags.bannerDescription ? { description: bannerDescription } : {}),
          });
        }
      }

      for (const o of overwriteChanges.removed ?? []) {
        await removeOverwrite({ overwriteId: o.id });
      }
      for (const o of [...overwriteChanges.added, ...overwriteChanges.changed]) {
        await setOverwrite({
          channelId: channel.id,
          roleId: o.roleId,
          userId: o.userId,
          allow: o.allow,
          deny: o.deny,
        });
      }

      setBgFile(null);
      setBgCleared(false);
      setBannerFile(null);
      setBannerCleared(false);
    },
  });

  const handleDelete = async () => {
    setError(null);
    try {
      await remove({ channelId: channel.id });
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete the channel.");
    }
  };

  const tabs: [EditorTab, string, number][] = [
    ["overview", "Overview", Number(flags.name) + Number(flags.topic)],
    [
      "permissions",
      "Permissions",
      overwriteChanges.added.length +
        overwriteChanges.changed.length +
        (overwriteChanges.removed?.length ?? 0),
    ],
    ...(isText
      ? ([
          [
            "appearance",
            "Appearance",
            Number(flags.background) +
              Number(flags.opacity) +
              Number(flags.banner) +
              Number(flags.bannerTitle) +
              Number(flags.bannerDescription),
          ],
        ] as [EditorTab, string, number][])
      : []),
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
<ChannelGlyph type={channel.type} surface={channel.surface} isLounge={channel.isLounge} isAnnouncement={channel.isAnnouncement} className="size-5 text-muted-foreground" />
        <h2 className="truncate text-lg font-semibold">{details?.name ?? channel.name}</h2>
        <span className="text-xs text-muted-foreground capitalize">{channel.isAnnouncement ? "announcements" : channel.type} channel</span>
      </div>

      <div className="flex items-center gap-6 border-b">
        {tabs.map(([value, label, dirty]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-1 py-2.5 text-sm transition-colors",
              tab === value
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            {dirty > 0 && <span aria-label="Unsaved changes" className="size-1.5 rounded-full bg-primary" />}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <SettingsCard className="space-y-4 px-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="channel-name">Name</Label>
              <Input
                id="channel-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                disabled={!canManage}
              />
            </div>
            {isText && (
              <div className="space-y-1.5">
                <Label htmlFor="channel-topic">Topic</Label>
                <Input
                  id="channel-topic"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="What this channel is for"
                  maxLength={256}
                  disabled={!canManage}
                />
              </div>
            )}
          </SettingsCard>

          {isText && !channel.surface && (canManage || channel.isAnnouncement) && (
            <SettingsCard className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Announcements channel</p>
                <p className="text-xs text-muted-foreground">
                  Only people you allow can post. Anyone who can see it can follow it into their Newsfeed, or have
                  it forwarded into a channel in their own community. Announcements aren&apos;t end-to-end encrypted.
                </p>
                {announcementNote && <p className="mt-1.5 text-xs text-muted-foreground">{announcementNote}</p>}
              </div>
              <Switch
                checked={!!channel.isAnnouncement}
                disabled={!canManage || togglingAnnouncement}
                onCheckedChange={(on) => void toggleAnnouncement(on)}
                aria-label="Announcements channel"
              />
            </SettingsCard>
          )}

          {channel.isAnnouncement && canManage && <AnnouncementFollowers channelId={channel.id} />}

          {details?.isLounge && (
            <LoungeScenePicker
              channelId={channel.id}
              communityId={communityId}
              current={details.loungeScene ?? "living-room"}
              customName={details.loungeSceneCustom?.name}
              canManage={canManage}
            />
          )}

          {canManage && (
            <SettingsCard className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Delete channel</p>
                <p className="text-xs text-muted-foreground">
                  Deletes every message in it, and can&apos;t be undone.
                </p>
              </div>
              {confirmDelete ? (
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => void handleDelete()}>
                    Delete #{channel.name}
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              )}
            </SettingsCard>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}

      {tab === "permissions" &&
        (overwrites === null ? (
          <div className="flex h-24 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <PermissionsEditor
            type={channel.type}
            roles={roles}
            members={members}
            overwrites={overwrites}
            onChange={setOverwrites}
            canManage={canManage}
          />
        ))}

      {tab === "appearance" && isText && (
        <AppearanceEditor
          canManage={canManage}
          backgroundUrl={bgCleared ? undefined : (bgPreview ?? details?.backgroundUrl)}
          opacity={bgOpacity}
          onOpacity={setBgOpacity}
          onBackgroundFile={(file) => {
            setBgFile(file);
            setBgCleared(false);
          }}
          onBackgroundRemove={() => {
            setBgFile(null);
            setBgCleared(true);
          }}
          bannerUrl={bannerCleared ? undefined : (bannerPreview ?? details?.bannerUrl)}
          bannerTitle={bannerCleared ? "" : bannerTitle}
          bannerDescription={bannerCleared ? "" : bannerDescription}
          onBannerTitle={(value) => {
            setBannerCleared(false);
            setBannerTitle(value);
          }}
          onBannerDescription={(value) => {
            setBannerCleared(false);
            setBannerDescription(value);
          }}
          onBannerFile={(file) => {
            setBannerFile(file);
            setBannerCleared(false);
          }}
          onBannerRemove={() => {
            setBannerFile(null);
            setBannerCleared(true);
            setBannerTitle("");
            setBannerDescription("");
          }}
        />
      )}
    </div>
  );
}

// --- Appearance ----------------------------------------------------------------

/**
 * Which room a lounge is. Unlike the rest of the page this applies as soon as it
 * is picked rather than waiting for the save bar: a scene is a choice among
 * pictures, not text being typed, and everyone in the lounge sees it change.
 */
function LoungeScenePicker({
  channelId,
  communityId,
  current,
  customName,
  canManage,
}: {
  channelId: Id<"channels">;
  communityId: Id<"communities">;
  current: string;
  customName?: string;
  canManage: boolean;
}) {
  const setScene = useMutation(api.lounge.setScene);
  const owned = useQuery(api.lounge.ownedScenes, { communityId }) ?? [];
  const [error, setError] = useState<string | null>(null);

  const choose = async (scene: string, entitlementId?: Id<"entitlements">) => {
    setError(null);
    try {
      await setScene({ channelId, scene, entitlementId });
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0].replace(/^.*Error:\s*/, "") : String(e));
    }
  };

  return (
    <SettingsCard className="space-y-3 px-4 py-4">
      <div>
        <p className="text-sm font-medium">Scene</p>
        <p className="text-xs text-muted-foreground">The room people walk around in. Changes for everyone inside.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {LOUNGE_SCENES.map((scene) => (
          <button
            key={scene.id}
            type="button"
            disabled={!canManage}
            onClick={() => void choose(scene.id)}
            className={cn(
              "overflow-hidden rounded-lg border text-left transition-colors disabled:opacity-60",
              current === scene.id ? "border-primary ring-1 ring-primary" : "hover:border-foreground/30",
            )}
          >
            <div className="aspect-video">
              <SceneThumbnail scene={scene} />
            </div>
            <p className="truncate px-2 py-1.5 text-xs font-medium">{scene.name}</p>
          </button>
        ))}
      </div>
      {owned.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">From the marketplace</p>
          <div className="flex flex-wrap gap-2">
            {owned.map((scene) => (
              <Button
                key={scene.id}
                size="sm"
                variant={current === "custom" && customName === scene.name ? "default" : "secondary"}
                disabled={!canManage}
                onClick={() => void choose("custom", scene.id)}
              >
                {scene.name}
              </Button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </SettingsCard>
  );
}

function AppearanceEditor({
  canManage,
  backgroundUrl,
  opacity,
  onOpacity,
  onBackgroundFile,
  onBackgroundRemove,
  bannerUrl,
  bannerTitle,
  bannerDescription,
  onBannerTitle,
  onBannerDescription,
  onBannerFile,
  onBannerRemove,
}: {
  canManage: boolean;
  backgroundUrl?: string;
  opacity: number;
  onOpacity: (value: number) => void;
  onBackgroundFile: (file: File) => void;
  onBackgroundRemove: () => void;
  bannerUrl?: string;
  bannerTitle: string;
  bannerDescription: string;
  onBannerTitle: (value: string) => void;
  onBannerDescription: (value: string) => void;
  onBannerFile: (file: File) => void;
  onBannerRemove: () => void;
}) {
  const bgInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (file: File | undefined, apply: (file: File) => void) => {
    if (!file) return;
    if (file.size > MAX_PROFILE_ASSET_BYTES) {
      setError(`Images must be smaller than ${MAX_PROFILE_ASSET_LABEL}.`);
      return;
    }
    setError(null);
    apply(file);
  };

  const hasBanner = !!(bannerUrl || bannerTitle || bannerDescription);

  return (
    <div className="space-y-5">
      <input
        ref={bgInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0], onBackgroundFile);
          e.target.value = "";
        }}
      />
      <input
        ref={bannerInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0], onBannerFile);
          e.target.value = "";
        }}
      />

      {/* A live picture of the channel with both applied, so what you are choosing
          is what you will see. */}
      <div className="relative isolate overflow-hidden rounded-xl border bg-accent/40">
        {backgroundUrl && (
          <div aria-hidden className="absolute inset-0 -z-10">
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${backgroundUrl})`, opacity }}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/50 to-background/70" />
          </div>
        )}
        <div className="flex h-9 items-center gap-2 px-3 text-sm font-semibold">
          <Hash className="size-4 text-muted-foreground" />
          your-channel
        </div>
        {hasBanner && (
          <div className="relative overflow-hidden border-y px-4 py-3">
            {bannerUrl && (
              <div
                aria-hidden
                className="absolute inset-0 bg-cover bg-center opacity-30"
                style={{ backgroundImage: `url(${bannerUrl})` }}
              />
            )}
            <div className="relative">
              <p className="text-sm font-semibold">{bannerTitle || "Heading"}</p>
              <p className="text-xs text-muted-foreground">{bannerDescription || "A line of description"}</p>
            </div>
          </div>
        )}
        <div className="space-y-2 px-3 py-4">
          {[70, 45, 60].map((width) => (
            <div key={width} className="flex items-center gap-2">
              <div className="size-6 shrink-0 rounded-full bg-foreground/15" />
              <div className="h-2.5 rounded-full bg-foreground/15" style={{ width: `${width}%` }} />
            </div>
          ))}
        </div>
      </div>

      <SettingsCard className="space-y-3 px-4 py-4">
        <div>
          <p className="text-sm font-medium">Background</p>
          <p className="text-xs text-muted-foreground">
            A picture behind the messages. Everyone here sees it.
          </p>
        </div>
        {backgroundUrl && (
          <div className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">Strength</span>
            <Slider
              value={[Math.round(opacity * 100)]}
              min={0}
              max={100}
              step={5}
              disabled={!canManage}
              onValueChange={([value]) => onOpacity((value ?? 0) / 100)}
            />
            <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {Math.round(opacity * 100)}%
            </span>
          </div>
        )}
        {canManage && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => bgInput.current?.click()}>
              <ImagePlus className="size-4" />
              {backgroundUrl ? "Replace" : "Upload background"}
            </Button>
            {backgroundUrl && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={onBackgroundRemove}
              >
                Remove
              </Button>
            )}
          </div>
        )}
      </SettingsCard>

      <SettingsCard className="space-y-3 px-4 py-4">
        <div>
          <p className="text-sm font-medium">Banner</p>
          <p className="text-xs text-muted-foreground">
            A strip under the channel header — a faded picture with a heading and a line of
            description. For the thing people need to read first.
          </p>
        </div>
        <div className="space-y-1.5">
          <Input
            value={bannerTitle}
            onChange={(e) => onBannerTitle(e.target.value)}
            placeholder="Heading"
            maxLength={80}
            disabled={!canManage}
          />
          <Textarea
            value={bannerDescription}
            onChange={(e) => onBannerDescription(e.target.value)}
            placeholder="Description"
            rows={2}
            maxLength={240}
            className="resize-none"
            disabled={!canManage}
          />
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => bannerInput.current?.click()}>
              <ImagePlus className="size-4" />
              {bannerUrl ? "Replace image" : "Upload image"}
            </Button>
            {hasBanner && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={onBannerRemove}
              >
                Remove banner
              </Button>
            )}
          </div>
        )}
      </SettingsCard>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

// --- Permissions ------------------------------------------------------------------

type OverwriteState = "deny" | "inherit" | "allow";

/** The permissions that mean something in a channel, in the order shown, by the
 * kind of channel. Administrator is left out: it bypasses overwrites, so one
 * would do nothing. */
function permissionGroups(type: "text" | "voice"): { title: string; keys: PermissionKey[] }[] {
  return [
    { title: "General", keys: ["VIEW_CHANNELS", "MANAGE_CHANNELS", "CREATE_INVITE"] },
    type === "text"
      ? { title: "Text", keys: TEXT_PERMISSION_KEYS }
      : { title: "Voice", keys: VOICE_PERMISSION_KEYS },
  ];
}

const stateOf = (o: OverwriteDraft, flag: number): OverwriteState =>
  bitsHas(o.allow, flag) ? "allow" : bitsHas(o.deny, flag) ? "deny" : "inherit";

function withState(o: OverwriteDraft, flag: number, state: OverwriteState): OverwriteDraft {
  return {
    ...o,
    allow: state === "allow" ? bitsOr(o.allow, flag) : bitsWithout(o.allow, flag),
    deny: state === "deny" ? bitsOr(o.deny, flag) : bitsWithout(o.deny, flag),
  };
}

type RoleRow = { id: Id<"roles">; name: string; color?: string; isEveryone: boolean };
type MemberRow = { userId: Id<"users">; name: string; username: string; imageUrl?: string };

function PermissionsEditor({
  type,
  roles,
  members,
  overwrites,
  onChange,
  canManage,
}: {
  type: "text" | "voice";
  roles: RoleRow[];
  members: MemberRow[];
  overwrites: Record<string, OverwriteDraft>;
  onChange: (next: Record<string, OverwriteDraft>) => void;
  canManage: boolean;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id as string, r])), [roles]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.userId as string, m])), [members]);
  const everyone = roles.find((r) => r.isEveryone);

  // Everyone first, then the other roles, then members: the order of how far
  // each reaches.
  const targets = useMemo(() => {
    const rank = (o: OverwriteDraft) =>
      o.roleId ? (roleById.get(o.roleId)?.isEveryone ? 0 : 1) : 2;
    return Object.values(overwrites).sort((a, b) => rank(a) - rank(b));
  }, [overwrites, roleById]);

  const selected =
    (selectedKey ? overwrites[selectedKey] : undefined) ?? targets[0] ?? null;

  const labelOf = (o: OverwriteDraft) =>
    o.roleId
      ? (roleById.get(o.roleId)?.name ?? "Unknown role")
      : (memberById.get(o.userId!)?.name ?? "Unknown member");

  const set = (next: OverwriteDraft) => onChange({ ...overwrites, [next.key]: next });

  const add = (target: { roleId?: Id<"roles">; userId?: Id<"users"> }) => {
    const key = target.roleId ? roleKey(target.roleId) : userKey(target.userId!);
    if (!overwrites[key]) set({ key, ...target, allow: 0, deny: 0 });
    setSelectedKey(key);
    setAddOpen(false);
    setAddQuery("");
  };

  const remove = (key: string) => {
    const { [key]: _removed, ...rest } = overwrites;
    onChange(rest);
    setSelectedKey(null);
  };

  // "Private channel": the one overwrite most people want, said in one switch —
  // nobody sees it unless a role or member is allowed to below.
  const everyoneKey = everyone ? roleKey(everyone.id) : null;
  const isPrivate =
    !!everyoneKey && !!overwrites[everyoneKey] && bitsHas(overwrites[everyoneKey].deny, PERMISSIONS.VIEW_CHANNELS);
  const setPrivate = (on: boolean) => {
    if (!everyone || !everyoneKey) return;
    const current = overwrites[everyoneKey] ?? { key: everyoneKey, roleId: everyone.id, allow: 0, deny: 0 };
    set(withState(current, PERMISSIONS.VIEW_CHANNELS, on ? "deny" : "inherit"));
    if (on) setSelectedKey(everyoneKey);
  };

  const availableRoles = roles.filter(
    (r) => !overwrites[roleKey(r.id)] && r.name.toLowerCase().includes(addQuery.toLowerCase()),
  );
  const availableMembers = members
    .filter(
      (m) =>
        !overwrites[userKey(m.userId)] &&
        (m.name.toLowerCase().includes(addQuery.toLowerCase()) ||
          m.username.toLowerCase().includes(addQuery.toLowerCase())),
    )
    .slice(0, 8);

  const groups = permissionGroups(type)
    .map((group) => ({
      ...group,
      keys: group.keys.filter(
        (key) =>
          !query.trim() ||
          PERMISSION_LABELS[key].toLowerCase().includes(query.toLowerCase()) ||
          PERMISSION_DESCRIPTIONS[key].toLowerCase().includes(query.toLowerCase()),
      ),
    }))
    .filter((group) => group.keys.length > 0);

  return (
    <div className="space-y-4">
      {canManage && everyone && (
        <SettingsCard className="flex items-center gap-4 px-4 py-3">
          <Lock className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Private channel</p>
            <p className="text-xs text-muted-foreground">
              Only the roles and members you allow below can see it. Everyone else won&apos;t know
              it exists.
            </p>
          </div>
          <Switch checked={isPrivate} onCheckedChange={setPrivate} aria-label="Private channel" />
        </SettingsCard>
      )}

      <div className="flex min-h-[22rem] gap-4">
        {/* Who this is about. */}
        <div className="flex w-52 shrink-0 flex-col gap-2">
          <p className="px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Roles and members
          </p>
          <div className="flex flex-col gap-0.5">
            {targets.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                Nothing here yet — everyone uses what their roles allow.
              </p>
            )}
            {targets.map((target) => {
              const role = target.roleId ? roleById.get(target.roleId) : null;
              const member = target.userId ? memberById.get(target.userId) : null;
              const active = target.key === selected?.key;
              const count = Number(popcount(bitsOr(target.allow, target.deny)));
              return (
                <button
                  key={target.key}
                  type="button"
                  onClick={() => setSelectedKey(target.key)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                    active ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  {role ? (
                    <span
                      className="size-3 shrink-0 rounded-full border border-foreground/20"
                      style={{ background: role.color || "var(--muted-foreground)" }}
                    />
                  ) : (
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground/15 text-[9px] font-semibold">
                      {(member?.name ?? "?").slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{role?.isEveryone ? "@everyone" : labelOf(target)}</span>
                  {count > 0 && (
                    <span className="rounded-full bg-foreground/10 px-1.5 text-[10px] tabular-nums">{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {canManage && (
            <Popover open={addOpen} onOpenChange={setAddOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="justify-start">
                  <Plus className="size-4" />
                  Add role or member
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-2">
                <Input
                  autoFocus
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                  placeholder="Search…"
                  className="mb-2 h-8"
                />
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {availableRoles.length > 0 && (
                    <div>
                      <p className="px-2 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                        Roles
                      </p>
                      {availableRoles.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => add({ roleId: r.id })}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                        >
                          <span
                            className="size-3 shrink-0 rounded-full border border-foreground/20"
                            style={{ background: r.color || "var(--muted-foreground)" }}
                          />
                          <span className="truncate">{r.isEveryone ? "@everyone" : r.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {availableMembers.length > 0 && (
                    <div>
                      <p className="px-2 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                        Members
                      </p>
                      {availableMembers.map((m) => (
                        <button
                          key={m.userId}
                          type="button"
                          onClick={() => add({ userId: m.userId })}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                        >
                          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground/15 text-[9px] font-semibold">
                            {m.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{m.name}</span>
                          <span className="truncate text-xs text-muted-foreground">@{m.username}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {availableRoles.length === 0 && availableMembers.length === 0 && (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">Nobody left to add.</p>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>

        {/* What they can do here. */}
        <div className="min-w-0 flex-1 space-y-3">
          {selected ? (
            <>
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search permissions"
                    className="h-9 pl-8"
                  />
                </div>
                {canManage && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={selected.allow === 0 && selected.deny === 0}
                      onClick={() => set({ ...selected, allow: 0, deny: 0 })}
                    >
                      Clear all
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remove(selected.key)}
                    >
                      <Trash2 className="size-4" />
                      Remove
                    </Button>
                  </>
                )}
              </div>

              <p className="px-1 text-xs text-muted-foreground">
                Setting <span className="font-medium text-foreground">{roleById.get(selected.roleId ?? "")?.isEveryone ? "@everyone" : labelOf(selected)}</span>
                : <X className="inline size-3 text-destructive" /> denies,{" "}
                <span className="font-semibold">/</span> follows their roles,{" "}
                <Check className="inline size-3 text-emerald-500" /> allows.
              </p>

              {groups.map((group) => (
                <div key={group.title} className="space-y-1">
                  <p className="px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {group.title}
                  </p>
                  <div className="overflow-hidden rounded-lg border">
                    {group.keys.map((key, index) => (
                      <div
                        key={key}
                        className={cn(
                          "flex items-center gap-4 px-3 py-2.5",
                          index > 0 && "border-t",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 text-sm font-medium">
                            {PERMISSION_LABELS[key]}
                            {UNENFORCED_PERMISSIONS.has(key) && (
                              <span
                                className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                                title="This is saved, but Crystal doesn't check it yet."
                              >
                                Not enforced yet
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">{PERMISSION_DESCRIPTIONS[key]}</p>
                        </div>
                        <TriState
                          value={stateOf(selected, PERMISSIONS[key])}
                          disabled={!canManage}
                          label={PERMISSION_LABELS[key]}
                          onChange={(state) => set(withState(selected, PERMISSIONS[key], state))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {groups.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">No permissions match.</p>
              )}
            </>
          ) : (
            <div className="flex h-full min-h-48 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-center text-sm text-muted-foreground">
              <p>Add a role or member to change what they can do here.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** How many bits are set. */
function popcount(value: number): number {
  // Two halves, because `>>>` and `&` only see the low 32 bits of a permission set.
  let count = 0;
  for (let v = value >>> 0; v; v &= v - 1) count++;
  for (let v = Math.floor(value / 4294967296) >>> 0; v; v &= v - 1) count++;
  return count;
}

/** Deny, follow the role, allow — as three buttons rather than one that cycles,
 * so the state is visible and any of the three is one click. */
function TriState({
  value,
  onChange,
  disabled,
  label,
}: {
  value: OverwriteState;
  onChange: (value: OverwriteState) => void;
  disabled?: boolean;
  label: string;
}) {
  const options: { state: OverwriteState; icon: React.ReactNode; title: string; active: string }[] = [
    { state: "deny", icon: <X className="size-4" />, title: "Deny", active: "bg-destructive text-white" },
    {
      state: "inherit",
      icon: <span className="text-sm leading-none font-semibold">/</span>,
      title: "Follow their roles",
      active: "bg-foreground/20 text-foreground",
    },
    { state: "allow", icon: <Check className="size-4" />, title: "Allow", active: "bg-emerald-500 text-white" },
  ];
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 overflow-hidden rounded-md border">
      {options.map((option, index) => (
        <button
          key={option.state}
          type="button"
          role="radio"
          aria-checked={value === option.state}
          aria-label={option.title}
          title={option.title}
          disabled={disabled}
          onClick={() => onChange(option.state)}
          className={cn(
            "flex h-7 w-9 items-center justify-center text-muted-foreground transition-colors disabled:cursor-not-allowed",
            index > 0 && "border-l",
            value === option.state ? option.active : "hover:bg-accent",
          )}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}

"use client";

import { useMutation, useQuery } from "convex/react";
import { Play, Plus, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useAudioPreferences } from "@/components/audio-provider";
import {
  UploadSoundDialog,
  type StagedSoundClip,
} from "@/components/community/upload-sound-dialog";
import { EmojiGlyph } from "@/components/home/emoji-select";
import { useSettingsDraft } from "@/components/settings/settings-save";
import { Button } from "@/components/ui/button";
import { MAX_CLIP_MS } from "@/lib/audio-clip";
import { BUILTIN_SOUNDS, playSound } from "@/lib/soundboard";
import { uploadToStorage } from "@/lib/storage-upload";
import { MAX_SOUND_LABEL } from "@/lib/upload-limits";
import { cn } from "@/lib/utils";

/** Kept in step with `MAX_SOUND_SLOTS` in convex/soundboard.ts. */
const MAX_SLOTS = 48;

interface CommunitySettingsSoundboardTabProps {
  communityId: Id<"communities">;
  canManage: boolean;
}

/** A clip that has been trimmed and named, and not yet uploaded. */
interface Staged extends StagedSoundClip {
  id: string;
  /** For previewing before it exists anywhere but here. */
  previewUrl: string;
}

/**
 * The server's soundboard clips. Adding one and removing one are drafts: a new
 * clip is held, trimmed and named, and a removed one is struck through, until the
 * page's save bar uploads and deletes them together.
 */
export function CommunitySettingsSoundboardTab({
  communityId,
  canManage,
}: CommunitySettingsSoundboardTabProps) {
  const sounds = useQuery(api.soundboard.list, { communityId }) ?? [];
  const generateUploadUrl = useMutation(api.soundboard.generateUploadUrl);
  const addSound = useMutation(api.soundboard.add);
  const removeSound = useMutation(api.soundboard.remove);
  const { soundboardVolume, outputDeviceId } = useAudioPreferences();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [removed, setRemoved] = useState<Set<Id<"communitySounds">>>(new Set());

  const preview = (url: string) =>
    void playSound(url, { volume: soundboardVolume, outputDeviceId: outputDeviceId || undefined });

  // A clip that is only in this window has a `blob:` address, which `playSound`
  // refuses on purpose — it is the check that keeps a call's data packets from
  // pointing a listener anywhere — so these are played directly.
  const previewStaged = (url: string) => {
    const audio = new Audio(url);
    audio.volume = Math.min(1, Math.max(0, soundboardVolume));
    void audio.play().catch(() => {});
  };

  const stage = (sound: StagedSoundClip) =>
    setStaged((current) => [
      ...current,
      {
        ...sound,
        id: Math.random().toString(36).slice(2),
        previewUrl: URL.createObjectURL(sound.clip),
      },
    ]);

  const unstage = (id: string) =>
    setStaged((current) => {
      const item = current.find((s) => s.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return current.filter((s) => s.id !== id);
    });

  const toggleRemoved = (id: Id<"communitySounds">) =>
    setRemoved((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Slots in use once everything here is saved.
  const slots = sounds.length - removed.size + staged.length;

  useSettingsDraft({
    changes: canManage ? staged.length + removed.size : 0,
    discard: () => {
      for (const item of staged) URL.revokeObjectURL(item.previewUrl);
      setStaged([]);
      setRemoved(new Set());
    },
    save: async () => {
      // Removed first: it is what frees the slots the new ones may need.
      for (const id of [...removed]) {
        await removeSound({ soundId: id });
        setRemoved((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
      for (const item of [...staged]) {
        const storageId = await uploadToStorage(await generateUploadUrl(), item.clip);
        await addSound({
          communityId,
          name: item.name,
          emoji: item.emoji,
          storageId: storageId as Id<"_storage">,
          durationMs: item.durationMs,
        });
        unstage(item.id);
      }
    },
  });

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Clips any member can play into this server&apos;s voice channels. {slots}/{MAX_SLOTS}{" "}
        slots used. Everyone also gets the built-in sounds listed below.
      </p>

      {canManage && slots < MAX_SLOTS && (
        <div className="flex items-center gap-3">
          <Button onClick={() => setUploadOpen(true)}>
            <Plus className="size-4" />
            Add a sound
          </Button>
          <p className="text-xs text-muted-foreground">
            Any audio file up to {MAX_SOUND_LABEL} — trim it to {MAX_CLIP_MS / 1000} seconds or
            less on the way in.
          </p>
        </div>
      )}

      <UploadSoundDialog open={uploadOpen} onOpenChange={setUploadOpen} onAdd={stage} />

      {canManage && slots >= MAX_SLOTS && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          This server has reached the {MAX_SLOTS}-sound limit. Remove one to add another.
        </p>
      )}

      {sounds.length === 0 && staged.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No custom sounds yet.
          {canManage ? " Add one above to get started." : ""}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
          {staged.map((sound) => (
            <div
              key={sound.id}
              className="flex items-center gap-3 rounded-lg border border-primary/50 bg-primary/5 px-3 py-2"
            >
              <EmojiGlyph value={sound.emoji} className="text-lg leading-none" />
              <span className="min-w-0 flex-1 truncate text-sm">{sound.name}</span>
              <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                New
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                title={`Preview ${sound.name}`}
                onClick={() => previewStaged(sound.previewUrl)}
              >
                <Play className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                title={`Don't add ${sound.name}`}
                onClick={() => unstage(sound.id)}
              >
                <Undo2 className="size-3.5" />
              </Button>
            </div>
          ))}
          {sounds.map((sound) => {
            const gone = removed.has(sound.id);
            return (
              <div
                key={sound.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg border bg-card px-3 py-2 transition-opacity",
                  gone && "border-destructive/40 opacity-60",
                )}
              >
                <EmojiGlyph value={sound.emoji} className="text-lg leading-none" />
                <span className={cn("min-w-0 flex-1 truncate text-sm", gone && "line-through")}>
                  {sound.name}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  title={`Preview ${sound.name}`}
                  onClick={() => preview(sound.soundUrl)}
                >
                  <Play className="size-3.5" />
                </Button>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("size-7", !gone && "text-destructive hover:bg-destructive/20")}
                    title={gone ? `Keep ${sound.name}` : `Delete ${sound.name}`}
                    onClick={() => toggleRemoved(sound.id)}
                  >
                    {gone ? <Undo2 className="size-3.5" /> : <Trash2 className="size-3.5" />}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Built-in sounds</h3>
        <p className="text-xs text-muted-foreground">
          Ship with the app and are available in every call — they don&apos;t use a slot.
        </p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2">
          {BUILTIN_SOUNDS.map((sound) => (
            <button
              key={sound.id}
              type="button"
              onClick={() => preview(sound.url)}
              className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
            >
              <EmojiGlyph value={sound.emoji} className="text-base leading-none" />
              <span className="min-w-0 flex-1 truncate">{sound.name}</span>
              <Play className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

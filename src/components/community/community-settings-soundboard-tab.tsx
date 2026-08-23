"use client";

import { useMutation, useQuery } from "convex/react";
import { Loader2, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useAudioPreferences } from "@/components/audio-provider";
import { UploadSoundDialog } from "@/components/community/upload-sound-dialog";
import { EmojiGlyph } from "@/components/home/emoji-select";
import { Button } from "@/components/ui/button";
import { MAX_CLIP_MS } from "@/lib/audio-clip";
import { BUILTIN_SOUNDS, playSound } from "@/lib/soundboard";
import { MAX_SOUND_LABEL } from "@/lib/upload-limits";

/** Kept in step with `MAX_SOUND_SLOTS` in convex/soundboard.ts. */
const MAX_SLOTS = 48;

interface CommunitySettingsSoundboardTabProps {
  communityId: Id<"communities">;
  canManage: boolean;
}

export function CommunitySettingsSoundboardTab({
  communityId,
  canManage,
}: CommunitySettingsSoundboardTabProps) {
  const sounds = useQuery(api.soundboard.list, { communityId }) ?? [];
  const removeSound = useMutation(api.soundboard.remove);
  const { soundboardVolume, outputDeviceId } = useAudioPreferences();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<Id<"communitySounds"> | null>(null);

  const preview = (url: string) =>
    void playSound(url, { volume: soundboardVolume, outputDeviceId: outputDeviceId || undefined });

  const handleRemove = async (soundId: Id<"communitySounds">) => {
    setDeletingId(soundId);
    try {
      await removeSound({ soundId });
    } finally {
      setDeletingId(null);
    }
  };

  const slots = sounds.length;

  return (
    <div className="space-y-6 p-8 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold">Soundboard</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Clips any member can play into this server&apos;s voice channels. {slots}/{MAX_SLOTS}{" "}
          slots used. Everyone also gets the built-in sounds listed below.
        </p>
      </div>

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

      <UploadSoundDialog
        communityId={communityId}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
      />

      {canManage && slots >= MAX_SLOTS && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          This server has reached the {MAX_SLOTS}-sound limit. Remove one to upload another.
        </p>
      )}

      {sounds.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No custom sounds yet.
          {canManage ? " Add one above to get started." : ""}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
          {sounds.map((sound) => (
            <div
              key={sound.id}
              className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2"
            >
              <EmojiGlyph value={sound.emoji} className="text-lg leading-none" />
              <span className="min-w-0 flex-1 truncate text-sm">{sound.name}</span>
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
                  className="size-7 text-destructive hover:bg-destructive/20"
                  disabled={deletingId === sound.id}
                  onClick={() => void handleRemove(sound.id)}
                >
                  {deletingId === sound.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </Button>
              )}
            </div>
          ))}
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

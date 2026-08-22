"use client";

import { useMutation, useQuery } from "convex/react";
import { Loader2, Play, Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useAudioPreferences } from "@/components/audio-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BUILTIN_SOUNDS, playSound } from "@/lib/soundboard";

/** Kept in step with `MAX_SOUND_SLOTS` in convex/soundboard.ts. */
const MAX_SLOTS = 48;
/** Kept in step with `MAX_SOUND_BYTES` / `MAX_SOUND_MS` in convex/soundboard.ts. */
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_MS = 8_000;

interface CommunitySettingsSoundboardTabProps {
  communityId: Id<"communities">;
  canManage: boolean;
}

/** Read a clip's duration client-side so an over-long upload is rejected
 * before it's sent, and the length can be stored alongside it. */
function readDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    const done = (value: number | undefined) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.addEventListener("loadedmetadata", () =>
      done(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined)
    );
    audio.addEventListener("error", () => done(undefined));
  });
}

export function CommunitySettingsSoundboardTab({
  communityId,
  canManage,
}: CommunitySettingsSoundboardTabProps) {
  const sounds = useQuery(api.soundboard.list, { communityId }) ?? [];
  const generateUploadUrl = useMutation(api.soundboard.generateUploadUrl);
  const addSound = useMutation(api.soundboard.add);
  const removeSound = useMutation(api.soundboard.remove);
  const { soundboardVolume, outputDeviceId } = useAudioPreferences();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [durationMs, setDurationMs] = useState<number | undefined>();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<Id<"communitySounds"> | null>(null);

  const preview = (url: string) =>
    void playSound(url, { volume: soundboardVolume, outputDeviceId: outputDeviceId || undefined });

  const handleFilePick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);

    if (file.size > MAX_BYTES) {
      setError(`Sounds must be smaller than ${MAX_BYTES / 1024 / 1024} MB.`);
      return;
    }
    const length = await readDuration(file);
    if (length !== undefined && length > MAX_MS) {
      setError(`Sounds must be shorter than ${MAX_MS / 1000} seconds.`);
      return;
    }

    setPendingFile(file);
    setDurationMs(length);
    setName(file.name.replace(/\.[^.]+$/, "").slice(0, 32));
  };

  const resetForm = () => {
    setPendingFile(null);
    setDurationMs(undefined);
    setName("");
    setEmoji("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleAdd = async () => {
    if (!pendingFile || name.trim().length < 2) return;
    setUploading(true);
    setError(null);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": pendingFile.type || "audio/mpeg" },
        body: pendingFile,
      });
      if (!res.ok) throw new Error("Upload failed.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await addSound({
        communityId,
        name: name.trim(),
        emoji: emoji.trim() || undefined,
        storageId,
        durationMs,
      });
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload sound.");
    } finally {
      setUploading(false);
    }
  };

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
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Upload a sound</CardTitle>
            <CardDescription>
              MP3, OGG, WAV or WebM · max {MAX_BYTES / 1024 / 1024} MB · up to {MAX_MS / 1000}{" "}
              seconds
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/*"
              className="hidden"
              onChange={(e) => void handleFilePick(e.target.files?.[0])}
            />

            <div className="flex items-end gap-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group flex size-16 shrink-0 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border bg-muted/30 transition-colors hover:bg-muted/60"
              >
                <Upload className="size-5 text-muted-foreground transition-colors group-hover:text-foreground" />
                {durationMs !== undefined && (
                  <span className="text-[10px] text-muted-foreground">
                    {(durationMs / 1000).toFixed(1)}s
                  </span>
                )}
              </button>

              <div className="w-16 space-y-1.5">
                <Label htmlFor="sound-emoji">Emoji</Label>
                <Input
                  id="sound-emoji"
                  value={emoji}
                  onChange={(e) => setEmoji(e.target.value)}
                  placeholder="🔊"
                  maxLength={4}
                  className="h-8 text-center text-sm"
                />
              </div>

              <div className="flex-1 space-y-1.5">
                <Label htmlFor="sound-name">Name</Label>
                <Input
                  id="sound-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Airhorn"
                  maxLength={32}
                  className="h-8 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">2–32 characters</p>
              </div>

              <Button
                onClick={() => void handleAdd()}
                disabled={!pendingFile || name.trim().length < 2 || uploading}
                size="sm"
                className="mb-0.5"
              >
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="size-4" />
                    Add
                  </>
                )}
              </Button>
            </div>

            {pendingFile && (
              <p className="text-xs text-muted-foreground">Selected: {pendingFile.name}</p>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </CardContent>
        </Card>
      )}

      {canManage && slots >= MAX_SLOTS && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          This server has reached the {MAX_SLOTS}-sound limit. Remove one to upload another.
        </p>
      )}

      {sounds.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No custom sounds yet.
          {canManage ? " Upload one above to get started." : ""}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
          {sounds.map((sound) => (
            <div
              key={sound.id}
              className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2"
            >
              <span className="text-lg leading-none">{sound.emoji ?? "🔊"}</span>
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
              <span className="text-base leading-none">{sound.emoji}</span>
              <span className="min-w-0 flex-1 truncate">{sound.name}</span>
              <Play className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

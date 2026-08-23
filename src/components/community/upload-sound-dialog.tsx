"use client";

import { useMutation } from "convex/react";
import { Loader2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { WaveformTrimmer, type TrimRange } from "@/components/community/waveform-trimmer";
import { EmojiSelect } from "@/components/home/emoji-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { decodeAudioFile, encodeClipToWav, MAX_CLIP_MS } from "@/lib/audio-clip";
import { uploadToStorage } from "@/lib/storage-upload";
import { MAX_SOUND_BYTES, MAX_SOUND_LABEL } from "@/lib/upload-limits";

/** What a fresh selection starts as: the first `MAX_CLIP_MS` of the file, or
 * all of it when it's already short enough. */
function initialRange(duration: number): TrimRange {
  return { startSec: 0, endSec: Math.min(duration, MAX_CLIP_MS / 1000) };
}

/**
 * Upload a soundboard clip: pick a file, choose the part of it you want, name
 * it, give it an emoji.
 *
 * Replaces a row of inline fields in the settings tab. The trimming is the
 * reason it's a dialog — people upload whole songs and want four seconds out
 * of the middle, which was previously impossible without editing the file
 * first, and a waveform needs more room than a settings row has.
 *
 * The clip is cut client-side and the *trimmed* audio is what's uploaded (see
 * src/lib/audio-clip.ts), so nothing downstream — playback, the join-sound
 * resolver, other clients — needs to know a trim ever happened.
 */
export function UploadSoundDialog({
  communityId,
  open,
  onOpenChange,
}: {
  communityId: Id<"communities">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const generateUploadUrl = useMutation(api.soundboard.generateUploadUrl);
  const addSound = useMutation(api.soundboard.add);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [range, setRange] = useState<TrimRange>({ startSec: 0, endSec: 0 });
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [volume, setVolume] = useState(1);
  const [decoding, setDecoding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Closing and reopening should be a clean slate, not the last attempt's
  // half-filled form.
  useEffect(() => {
    if (open) return;
    setFile(null);
    setBuffer(null);
    setRange({ startSec: 0, endSec: 0 });
    setName("");
    setEmoji("");
    setVolume(1);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [open]);

  const pickFile = async (picked: File | undefined) => {
    if (!picked) return;
    setError(null);

    if (picked.size > MAX_SOUND_BYTES) {
      setError(`Files must be smaller than ${MAX_SOUND_LABEL}.`);
      return;
    }

    setFile(picked);
    setDecoding(true);
    setBuffer(null);
    try {
      const decoded = await decodeAudioFile(picked);
      setBuffer(decoded);
      setRange(initialRange(decoded.duration));
      // Only prefill a name the user hasn't already written one over.
      setName((current) => current || picked.name.replace(/\.[^.]+$/, "").slice(0, 32));
    } catch {
      setError("That file couldn't be read as audio.");
      setFile(null);
    } finally {
      setDecoding(false);
    }
  };

  const submit = async () => {
    if (!buffer || !file) return;
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError("Sound name must be at least 2 characters.");
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const clip = encodeClipToWav(buffer, range.startSec, range.endSec, volume);
      if (clip.size > MAX_SOUND_BYTES) {
        throw new Error(`The trimmed clip is over ${MAX_SOUND_LABEL}. Select a shorter part.`);
      }
      const uploadUrl = await generateUploadUrl();
      const storageId = await uploadToStorage(uploadUrl, clip);
      await addSound({
        communityId,
        name: trimmed,
        emoji: emoji.trim() || undefined,
        storageId: storageId as Id<"_storage">,
        durationMs: Math.round((range.endSec - range.startSec) * 1000),
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload sound.");
    } finally {
      setUploading(false);
    }
  };

  const ready = !!buffer && name.trim().length >= 2 && range.endSec > range.startSec;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload a Sound</DialogTitle>
          <DialogDescription className="sr-only">
            Choose an audio file, trim it to the part you want, and give it a name and emoji.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Preview</Label>
            <WaveformTrimmer buffer={buffer} value={range} onChange={setRange} gain={volume} />
            <p className="text-[11px] text-muted-foreground">
              {buffer
                ? "Drag the handles to trim, or click the waveform to move the selection."
                : decoding
                  ? "Reading audio…"
                  : `Pick a file to get started. Up to ${MAX_CLIP_MS / 1000} seconds can be used.`}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sound-file">
              File <span className="text-destructive">*</span>
            </Label>
            <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
              <Upload className="size-4 shrink-0 text-muted-foreground" />
              <span
                className={`min-w-0 flex-1 truncate text-sm ${file ? "" : "text-muted-foreground"}`}
              >
                {file?.name ?? "No file selected"}
              </span>
              {decoding && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
              <Button
                id="sound-file"
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 shrink-0"
                onClick={() => fileInputRef.current?.click()}
              >
                Browse
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(event) => void pickFile(event.target.files?.[0])}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sound-name">
                Sound Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="sound-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Sound Name"
                maxLength={32}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Related Emoji</Label>
              <EmojiSelect value={emoji} onChange={setEmoji} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Sound Volume</Label>
            <div className="flex items-center gap-3">
              <Slider
                value={[Math.round(volume * 100)]}
                min={0}
                max={100}
                step={5}
                onValueChange={([next]) => setVolume((next ?? 100) / 100)}
                className="min-w-0 flex-1"
              />
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {Math.round(volume * 100)}%
              </span>
            </div>
            {/* Baked into the uploaded file rather than stored as a setting,
                so it's worth saying that this is not undoable later. */}
            <p className="text-[11px] text-muted-foreground">
              Applied to the clip before it&apos;s uploaded. The preview above plays at this
              volume.
            </p>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={uploading}>
            Never mind
          </Button>
          <Button onClick={() => void submit()} disabled={!ready || uploading}>
            {uploading ? <Loader2 className="size-4 animate-spin" /> : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

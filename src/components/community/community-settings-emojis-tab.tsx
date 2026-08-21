"use client";

import { useMutation, useQuery } from "convex/react";
import { Loader2, Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

const MAX_SLOTS = 50;

interface CommunitySettingsEmojisTabProps {
  communityId: Id<"communities">;
  canManage: boolean;
}

export function CommunitySettingsEmojisTab({
  communityId,
  canManage,
}: CommunitySettingsEmojisTabProps) {
  const emojis = useQuery(api.communityEmojis.list, { communityId }) ?? [];
  const generateUploadUrl = useMutation(api.communityEmojis.generateUploadUrl);
  const addEmoji = useMutation(api.communityEmojis.add);
  const removeEmoji = useMutation(api.communityEmojis.remove);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<Id<"communityEmojis"> | null>(null);

  const handleFilePick = (file: File | undefined) => {
    if (!file) return;
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    // Pre-fill name from filename (strip extension, sanitise).
    const base = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
    setName(base.slice(0, 32));
    setError(null);
  };

  const handleAdd = async () => {
    if (!pendingFile || !name.trim()) return;
    setUploading(true);
    setError(null);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": pendingFile.type || "image/png" },
        body: pendingFile,
      });
      if (!res.ok) throw new Error("Upload failed.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await addEmoji({ communityId, name: name.trim(), storageId });
      // Reset form.
      setPendingFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload emoji.");
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async (emojiId: Id<"communityEmojis">) => {
    setDeletingId(emojiId);
    try {
      await removeEmoji({ emojiId });
    } finally {
      setDeletingId(null);
    }
  };

  const slots = emojis.length;

  return (
    <div className="space-y-6 p-8 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold">Custom Emojis</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload custom emojis for this server. Members can use them in messages
          and reactions. {slots}/{MAX_SLOTS} slots used.
        </p>
      </div>

      {canManage && slots < MAX_SLOTS && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Upload Emoji</CardTitle>
            <CardDescription>
              PNG, GIF, or WebP · max 256 KB · recommended 128×128 px
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/gif,image/webp"
              className="hidden"
              onChange={(e) => handleFilePick(e.target.files?.[0])}
            />

            <div className="flex items-end gap-4">
              {/* Preview / pick button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group relative flex size-16 shrink-0 items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 hover:bg-muted/60 transition-colors"
              >
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="preview"
                    className="size-full rounded-md object-contain"
                  />
                ) : (
                  <Upload className="size-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                )}
              </button>

              <div className="flex-1 space-y-1.5">
                <Label htmlFor="emoji-name">Name</Label>
                <Input
                  id="emoji-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. pepe"
                  maxLength={32}
                  className="h-8 font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Letters, numbers, underscores only (2–32 chars)
                </p>
              </div>

              <Button
                onClick={() => void handleAdd()}
                disabled={!pendingFile || !name.trim() || uploading}
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

            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </CardContent>
        </Card>
      )}

      {canManage && slots >= MAX_SLOTS && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          This server has reached the {MAX_SLOTS}-emoji limit. Remove an emoji to
          upload a new one.
        </p>
      )}

      {emojis.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No custom emojis yet.
          {canManage ? " Upload one above to get started." : ""}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
          {emojis.map((emoji) => (
            <div
              key={emoji.id}
              className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2"
            >
              <img
                src={emoji.imageUrl}
                alt={emoji.name}
                className="size-8 shrink-0 rounded-sm object-contain"
              />
              <span className="min-w-0 flex-1 truncate font-mono text-sm">
                :{emoji.name}:
              </span>
              {canManage && (
                <button
                  type="button"
                  onClick={() => void handleRemove(emoji.id)}
                  disabled={deletingId === emoji.id}
                  aria-label={`Delete :${emoji.name}:`}
                  className="shrink-0 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                >
                  {deletingId === emoji.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { Plus, Trash2, Undo2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSettingsDraft } from "@/components/settings/settings-save";
import { uploadImage } from "@/lib/cdn-upload";
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
import { cn } from "@/lib/utils";

const MAX_SLOTS = 50;

interface CommunitySettingsEmojisTabProps {
  communityId: Id<"communities">;
  canManage: boolean;
}

/** An emoji that has been chosen but not yet uploaded. */
interface StagedEmoji {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
}

/**
 * Custom emoji. Adding and removing are drafts like everything else on the page:
 * a new one is held with its picture, a removed one is struck through, and the
 * page's save bar uploads and deletes them together.
 */
export function CommunitySettingsEmojisTab({
  communityId,
  canManage,
}: CommunitySettingsEmojisTabProps) {
  const emojis = useQuery(api.communityEmojis.list, { communityId }) ?? [];
  const convex = useConvex();
  const generateUploadUrl = useMutation(api.communityEmojis.generateUploadUrl);
  const addEmoji = useMutation(api.communityEmojis.add);
  const removeEmoji = useMutation(api.communityEmojis.remove);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [staged, setStaged] = useState<StagedEmoji[]>([]);
  const [removed, setRemoved] = useState<Set<Id<"communityEmojis">>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Everything made with `createObjectURL` is released when this goes away.
  const live = useRef({ previewUrl, staged });
  live.current = { previewUrl, staged };
  useEffect(
    () => () => {
      if (live.current.previewUrl) URL.revokeObjectURL(live.current.previewUrl);
      for (const item of live.current.staged) URL.revokeObjectURL(item.previewUrl);
    },
    [],
  );

  const clearForm = () => {
    setPendingFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFilePick = (file: File | undefined) => {
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    // Pre-fill name from filename (strip extension, sanitise).
    const base = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
    setName(base.slice(0, 32));
    setError(null);
  };

  const sanitise = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");

  const stage = () => {
    if (!pendingFile || !previewUrl) return;
    const clean = sanitise(name);
    if (clean.length < 2 || clean.length > 32) {
      setError("Emoji name must be 2–32 characters (letters, numbers, underscores).");
      return;
    }
    const taken =
      emojis.some((e) => e.name === clean && !removed.has(e.id)) ||
      staged.some((e) => e.name === clean);
    if (taken) {
      setError(`An emoji named "${clean}" already exists.`);
      return;
    }
    setStaged((current) => [
      ...current,
      { id: Math.random().toString(36).slice(2), file: pendingFile, previewUrl, name: clean },
    ]);
    // The preview now belongs to the staged one; the form lets go of it without
    // releasing it.
    setPendingFile(null);
    setPreviewUrl(null);
    setName("");
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const unstage = (id: string) =>
    setStaged((current) => {
      const item = current.find((e) => e.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return current.filter((e) => e.id !== id);
    });

  const toggleRemoved = (id: Id<"communityEmojis">) =>
    setRemoved((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Slots the server will have used once everything here is saved.
  const slots = emojis.length - removed.size + staged.length;

  useSettingsDraft({
    changes: canManage ? staged.length + removed.size : 0,
    discard: () => {
      for (const item of staged) URL.revokeObjectURL(item.previewUrl);
      setStaged([]);
      setRemoved(new Set());
      clearForm();
      setError(null);
    },
    save: async () => {
      // Removed first: it is what frees the slots the new ones may need.
      for (const id of [...removed]) {
        await removeEmoji({ emojiId: id });
        setRemoved((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
      for (const item of [...staged]) {
        const uploaded = await uploadImage(convex, item.file, "emoji", generateUploadUrl);
        await addEmoji({ communityId, name: item.name, ...uploaded });
        // Each is let go as it lands, so a failure part-way keeps only what has
        // not been saved.
        unstage(item.id);
      }
    },
  });

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Upload custom emojis for this server. Members can use them in messages
        and reactions. {slots}/{MAX_SLOTS} slots used.
      </p>

      {canManage && slots < MAX_SLOTS && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Add an emoji</CardTitle>
            <CardDescription>
              PNG, GIF, or WebP · max 256 KB · recommended 128×128 px
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/gif,image/webp"
              className="hidden"
              onChange={(e) => handleFilePick(e.target.files?.[0])}
            />

            <div className="flex items-end gap-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group relative flex size-16 shrink-0 items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 transition-colors hover:bg-muted/60"
              >
                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt="preview" className="size-full rounded-md object-contain" />
                ) : (
                  <Upload className="size-5 text-muted-foreground transition-colors group-hover:text-foreground" />
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
                onClick={stage}
                disabled={!pendingFile || !name.trim()}
                size="sm"
                variant="secondary"
                className="mb-0.5"
              >
                <Plus className="size-4" />
                Add
              </Button>
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
          </CardContent>
        </Card>
      )}

      {canManage && slots >= MAX_SLOTS && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          This server has reached the {MAX_SLOTS}-emoji limit. Remove an emoji to
          upload a new one.
        </p>
      )}

      {emojis.length === 0 && staged.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No custom emojis yet.
          {canManage ? " Add one above to get started." : ""}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
          {staged.map((emoji) => (
            <div
              key={emoji.id}
              className="flex items-center gap-3 rounded-lg border border-primary/50 bg-primary/5 px-3 py-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={emoji.previewUrl} alt={emoji.name} className="size-8 shrink-0 rounded-sm object-contain" />
              <span className="min-w-0 flex-1 truncate font-mono text-sm">:{emoji.name}:</span>
              <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                New
              </span>
              <button
                type="button"
                onClick={() => unstage(emoji.id)}
                aria-label={`Don't add :${emoji.name}:`}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Undo2 className="size-4" />
              </button>
            </div>
          ))}
          {emojis.map((emoji) => {
            const gone = removed.has(emoji.id);
            return (
              <div
                key={emoji.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg border bg-card px-3 py-2 transition-opacity",
                  gone && "border-destructive/40 opacity-60",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={emoji.imageUrl}
                  alt={emoji.name}
                  className={cn("size-8 shrink-0 rounded-sm object-contain", gone && "grayscale")}
                />
                <span className={cn("min-w-0 flex-1 truncate font-mono text-sm", gone && "line-through")}>
                  :{emoji.name}:
                </span>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => toggleRemoved(emoji.id)}
                    aria-label={gone ? `Keep :${emoji.name}:` : `Delete :${emoji.name}:`}
                    className={cn(
                      "shrink-0 transition-colors",
                      gone
                        ? "text-muted-foreground hover:text-foreground"
                        : "text-muted-foreground hover:text-destructive",
                    )}
                  >
                    {gone ? <Undo2 className="size-4" /> : <Trash2 className="size-4" />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

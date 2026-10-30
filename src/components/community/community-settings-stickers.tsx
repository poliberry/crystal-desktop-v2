"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { Plus, Trash2, Undo2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MAX_STICKER_SLOTS, STICKER_CONTENT_TYPES, sanitiseStickerName, stickerNameError } from "../../../convex/lib/stickersPure";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { uploadImage } from "@/lib/cdn-upload";
import { hasPermission, PERMISSIONS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { MAX_STICKER_BYTES, MAX_STICKER_LABEL } from "@/lib/upload-limits";

/** A sticker that has been chosen but not yet uploaded. */
interface StagedSticker {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
}

/**
 * The stickers half of the Emojis tab, as a draft like the emoji beside it: a new one is held with
 * its picture, a removed one is struck through, and the page's save bar uploads and deletes them
 * together. A page has a single draft, so this hands back its pieces for the tab to fold into its own
 * `useSettingsDraft` rather than registering one itself.
 */
export function useStickerDraft(communityId: Id<"communities">) {
  const stickers = useQuery(api.communityStickers.list, { communityId }) ?? [];
  const permissions = useQuery(api.roles.myPermissions, { communityId }) ?? 0;
  // Either is enough to add one; the server checks again.
  const canUpload = hasPermission(permissions, PERMISSIONS.MANAGE_EMOJIS) || hasPermission(permissions, PERMISSIONS.CREATE_EXPRESSIONS);

  const convex = useConvex();
  const generateUploadUrl = useMutation(api.communityStickers.generateUploadUrl);
  const addSticker = useMutation(api.communityStickers.add);
  const removeSticker = useMutation(api.communityStickers.remove);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [staged, setStaged] = useState<StagedSticker[]>([]);
  const [removed, setRemoved] = useState<Set<Id<"communityStickers">>>(new Set());
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
    if (!(STICKER_CONTENT_TYPES as readonly string[]).includes(file.type)) {
      setError("A sticker must be a PNG, WebP, GIF or APNG picture.");
      return;
    }
    if (file.size > MAX_STICKER_BYTES) {
      setError(`That picture is too big. Stickers can be up to ${MAX_STICKER_LABEL}.`);
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    // Pre-fill name from filename (strip extension, sanitise).
    setName(sanitiseStickerName(file.name.replace(/\.[^.]+$/, "")).slice(0, 32));
    setError(null);
  };

  const stage = () => {
    if (!pendingFile || !previewUrl) return;
    const clean = sanitiseStickerName(name);
    const invalid = stickerNameError(clean);
    if (invalid) {
      setError(invalid);
      return;
    }
    const taken = stickers.some((s) => s.name === clean && !removed.has(s.id)) || staged.some((s) => s.name === clean);
    if (taken) {
      setError(`A sticker named "${clean}" already exists.`);
      return;
    }
    setStaged((current) => [...current, { id: Math.random().toString(36).slice(2), file: pendingFile, previewUrl, name: clean }]);
    // The preview now belongs to the staged one; the form lets go of it without releasing it.
    setPendingFile(null);
    setPreviewUrl(null);
    setName("");
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const unstage = (id: string) =>
    setStaged((current) => {
      const item = current.find((s) => s.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return current.filter((s) => s.id !== id);
    });

  const toggleRemoved = (id: Id<"communityStickers">) =>
    setRemoved((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return {
    stickers,
    canUpload,
    /** Slots the server will have used once everything here is saved. */
    slots: stickers.length - removed.size + staged.length,
    changes: staged.length + removed.size,
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
        await removeSticker({ stickerId: id });
        setRemoved((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
      for (const item of [...staged]) {
        const uploaded = await uploadImage(convex, item.file, "emoji", generateUploadUrl);
        await addSticker({ communityId, name: item.name, ...uploaded });
        // Each is let go as it lands, so a failure part-way keeps only what has not been saved.
        unstage(item.id);
      }
    },
    // For the section to draw.
    form: { fileInputRef, pendingFile, previewUrl, name, setName, handleFilePick, stage, error },
    staged,
    removed,
    unstage,
    toggleRemoved,
  };
}

export type StickerDraft = ReturnType<typeof useStickerDraft>;

/** The Stickers section of the Emojis tab: the slot count, the upload form, and the grid. */
export function CommunitySettingsStickersSection({ draft }: { draft: StickerDraft }) {
  const { stickers, canUpload, slots, staged, removed, form } = draft;

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Stickers</h3>
        <p className="text-sm text-muted-foreground">
          Upload stickers members can send as a message of their own. {slots}/{MAX_STICKER_SLOTS} slots used.
        </p>
      </div>

      {!canUpload && (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          You need the Manage Emojis or Create Expressions permission to add stickers here.
        </p>
      )}

      {canUpload && slots < MAX_STICKER_SLOTS && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Add a sticker</CardTitle>
            <CardDescription>PNG, WebP, GIF or APNG · max {MAX_STICKER_LABEL} · recommended 320×320 px</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              ref={form.fileInputRef}
              type="file"
              accept="image/png,image/gif,image/webp,image/apng"
              className="hidden"
              onChange={(e) => form.handleFilePick(e.target.files?.[0])}
            />

            <div className="flex items-end gap-4">
              <button
                type="button"
                onClick={() => form.fileInputRef.current?.click()}
                className="group relative flex size-16 shrink-0 items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30 transition-colors hover:bg-muted/60"
              >
                {form.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.previewUrl} alt="preview" className="size-full rounded-md object-contain" />
                ) : (
                  <Upload className="size-5 text-muted-foreground transition-colors group-hover:text-foreground" />
                )}
              </button>

              <div className="flex-1 space-y-1.5">
                <Label htmlFor="sticker-name">Name</Label>
                <Input
                  id="sticker-name"
                  value={form.name}
                  onChange={(e) => form.setName(e.target.value)}
                  placeholder="e.g. wave"
                  maxLength={32}
                  className="h-8 font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground">Letters, numbers, underscores only (2–32 chars)</p>
              </div>

              <Button onClick={form.stage} disabled={!form.pendingFile || !form.name.trim()} size="sm" variant="secondary" className="mb-0.5">
                <Plus className="size-4" />
                Add
              </Button>
            </div>

            {form.error && <p className="text-xs text-destructive">{form.error}</p>}
          </CardContent>
        </Card>
      )}

      {canUpload && slots >= MAX_STICKER_SLOTS && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          This server has reached the {MAX_STICKER_SLOTS}-sticker limit. Remove a sticker to upload a new one.
        </p>
      )}

      {stickers.length === 0 && staged.length === 0 ? (
        <p className="text-sm text-muted-foreground">No stickers yet.{canUpload ? " Add one above to get started." : ""}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
          {staged.map((sticker) => (
            <div key={sticker.id} className="flex items-center gap-3 rounded-lg border border-primary/50 bg-primary/5 px-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sticker.previewUrl} alt={sticker.name} className="size-12 shrink-0 object-contain" />
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{sticker.name}</span>
              <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">New</span>
              <button
                type="button"
                onClick={() => draft.unstage(sticker.id)}
                aria-label={`Don't add ${sticker.name}`}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Undo2 className="size-4" />
              </button>
            </div>
          ))}
          {stickers.map((sticker) => {
            const gone = removed.has(sticker.id);
            return (
              <div
                key={sticker.id}
                className={cn("flex items-center gap-3 rounded-lg border bg-card px-3 py-2 transition-opacity", gone && "border-destructive/40 opacity-60")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sticker.imageUrl} alt={sticker.name} className={cn("size-12 shrink-0 object-contain", gone && "grayscale")} />
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate font-mono text-sm", gone && "line-through")}>{sticker.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">Added by {sticker.uploaderName}</p>
                </div>
                {sticker.canRemove && (
                  <button
                    type="button"
                    onClick={() => draft.toggleRemoved(sticker.id)}
                    aria-label={gone ? `Keep ${sticker.name}` : `Delete ${sticker.name}`}
                    className={cn("shrink-0 transition-colors", gone ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground hover:text-destructive")}
                  >
                    {gone ? <Undo2 className="size-4" /> : <Trash2 className="size-4" />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { ImagePlus, Loader2, Plus, Trash2, Type } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  ProfileWidgetCard,
  type BoardWidget,
} from "@/components/profile/profile-board";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { uploadToStorage } from "@/lib/storage-upload";
import {
  MAX_PROFILE_ASSET_BYTES,
  MAX_PROFILE_ASSET_LABEL,
} from "@/lib/upload-limits";
import { cn } from "@/lib/utils";

/**
 * The form behind one board widget.
 *
 * Everything is optional on purpose — a widget with nothing but a title and a
 * picture is a perfectly good "favourite game", and one with only fields is a
 * stat block. The server applies the real limits (see convex/profileWidgets.ts);
 * the counts here keep the form honest before a save that would be trimmed.
 */

const MAX_FIELDS = 8;
const MAX_BUTTONS = 3;
const DESCRIPTION_MAX = 500;

/** Presets, so a first widget is one click rather than an empty form. They
 * only seed the fields — nothing about them is stored, and the user can
 * rewrite every part afterwards. */
export const WIDGET_TEMPLATES: {
  key: string;
  label: string;
  hint: string;
  seed: Partial<DraftWidget>;
}[] = [
  {
    key: "about",
    label: "About me",
    hint: "A few lines about who you are.",
    seed: { title: "About me", description: "" },
  },
  {
    key: "favourite-game",
    label: "Favourite game",
    hint: "Cover art, a name, and how long you've played it.",
    seed: {
      title: "Favourite game",
      fields: [
        { id: "f1", kind: "text", label: "Game", value: "" },
        { id: "f2", kind: "text", label: "Hours", value: "" },
      ],
    },
  },
  {
    key: "rotation",
    label: "In rotation",
    hint: "What you're playing at the moment.",
    seed: {
      title: "Games in rotation",
      fields: [
        { id: "f1", kind: "text", label: "Right now", value: "" },
        { id: "f2", kind: "text", label: "Next up", value: "" },
      ],
    },
  },
  {
    key: "links",
    label: "Links",
    hint: "Buttons pointing wherever you like.",
    seed: {
      title: "Find me",
      buttons: [{ id: "b1", label: "Website", url: "" }],
    },
  },
];

export interface DraftField {
  id: string;
  kind: "text" | "image";
  label: string;
  value: string;
  /** Set only for an image field whose picture was uploaded in this session —
   * the server needs the id to adopt the file, and `value` is only a preview
   * URL until it does. */
  storageId?: Id<"_storage">;
}

export interface DraftWidget {
  widgetId?: Id<"profileWidgets">;
  title: string;
  subtitle: string;
  description: string;
  imageUrl?: string;
  /** A newly-picked cover, not yet saved. */
  imageStorageId?: Id<"_storage">;
  /** True once the existing cover has been removed and not replaced. */
  clearImage?: boolean;
  accent: string;
  fields: DraftField[];
  buttons: { id: string; label: string; url: string }[];
}

export function emptyDraft(seed?: Partial<DraftWidget>): DraftWidget {
  return {
    title: "",
    subtitle: "",
    description: "",
    accent: "",
    fields: [],
    buttons: [],
    ...seed,
  };
}

/** Ids only have to be unique within one widget, and never leave it. */
const newId = () => Math.random().toString(36).slice(2, 10);

export function WidgetEditorDialog({
  open,
  onOpenChange,
  draft: initialDraft,
  communityId,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The widget being edited, or a blank/seeded one for a new card. */
  draft: DraftWidget | null;
  /** Which board this belongs to — absent is the account's own. */
  communityId?: Id<"communities">;
  onDeleted?: () => void;
}) {
  const upsertWidget = useMutation(api.profileWidgets.upsertWidget);
  const removeWidget = useMutation(api.profileWidgets.removeWidget);
  const generateUploadUrl = useMutation(api.profileWidgets.generateWidgetUploadUrl);

  const [draft, setDraft] = useState<DraftWidget>(() => initialDraft ?? emptyDraft());
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  /** Which image field a pick is destined for — the same hidden input serves
   * every field, so the target has to be remembered across the click. */
  const fieldInputRef = useRef<HTMLInputElement>(null);
  const pendingFieldId = useRef<string | null>(null);

  // Re-seed whenever the dialog is opened on a different widget. Keyed on the
  // draft identity rather than on `open` alone, so reopening the same card
  // doesn't discard edits made and saved a moment ago.
  useEffect(() => {
    if (open && initialDraft) {
      setDraft(initialDraft);
      setError(null);
    }
  }, [open, initialDraft]);

  const patch = (next: Partial<DraftWidget>) =>
    setDraft((prev) => ({ ...prev, ...next }));

  const upload = async (file: File): Promise<Id<"_storage">> => {
    if (file.size > MAX_PROFILE_ASSET_BYTES) {
      throw new Error(`Images must be smaller than ${MAX_PROFILE_ASSET_LABEL}.`);
    }
    return (await uploadToStorage(await generateUploadUrl(), file)) as Id<"_storage">;
  };

  const pickCover = async (file: File | undefined) => {
    if (!file) return;
    setUploading("cover");
    setError(null);
    try {
      const storageId = await upload(file);
      // Shown from the local file until the save round-trips: the storage URL
      // doesn't exist yet, and a blank box while uploading reads as failure.
      patch({
        imageStorageId: storageId,
        imageUrl: URL.createObjectURL(file),
        clearImage: false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(null);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  };

  const pickFieldImage = async (file: File | undefined) => {
    const fieldId = pendingFieldId.current;
    if (!file || !fieldId) return;
    setUploading(fieldId);
    setError(null);
    try {
      const storageId = await upload(file);
      const preview = URL.createObjectURL(file);
      setDraft((prev) => ({
        ...prev,
        fields: prev.fields.map((f) =>
          f.id === fieldId ? { ...f, storageId, value: preview } : f,
        ),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(null);
      pendingFieldId.current = null;
      if (fieldInputRef.current) fieldInputRef.current.value = "";
    }
  };

  const addField = (kind: "text" | "image") => {
    if (draft.fields.length >= MAX_FIELDS) return;
    patch({
      fields: [...draft.fields, { id: newId(), kind, label: "", value: "" }],
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await upsertWidget({
        widgetId: draft.widgetId,
        communityId,
        title: draft.title,
        subtitle: draft.subtitle,
        description: draft.description,
        imageStorageId: draft.imageStorageId,
        clearImage: draft.clearImage,
        accent: draft.accent,
        // An image field with nothing in it would render as a broken picture,
        // so it's dropped rather than saved half-made.
        fields: draft.fields
          .filter((f) => (f.kind === "image" ? !!f.storageId || !!f.value : !!f.value.trim()))
          .map((f) => ({
            id: f.id,
            kind: f.kind,
            label: f.label,
            value: f.value,
            storageId: f.storageId,
          })),
        buttons: draft.buttons.filter((b) => b.url.trim()),
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that widget.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!draft.widgetId) return;
    setSaving(true);
    try {
      await removeWidget({ widgetId: draft.widgetId });
      onDeleted?.();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  /** What the card will look like, from the same component that draws it for
   * real — a preview built separately would drift the moment either changed. */
  const preview: BoardWidget = {
    id: "preview",
    title: draft.title || undefined,
    subtitle: draft.subtitle || undefined,
    description: draft.description || undefined,
    imageUrl: draft.clearImage ? undefined : draft.imageUrl,
    accent: draft.accent || undefined,
    fields: draft.fields.filter((f) => f.value || f.label),
    buttons: draft.buttons.filter((b) => b.label || b.url),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border/40 px-5 py-4">
          <DialogTitle>{draft.widgetId ? "Edit widget" : "New widget"}</DialogTitle>
          <DialogDescription>
            Anything you put here shows on your profile Board.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[calc(88vh-9rem)] grid-cols-1 sm:grid-cols-[1fr_260px]">
          <ScrollArea className="max-h-[calc(88vh-9rem)]">
            <div className="space-y-4 p-5">
              <div className="space-y-2">
                <Label>Cover image</Label>
                <div
                  className={cn(
                    "h-24 overflow-hidden rounded-md",
                    !preview.imageUrl &&
                      "flex items-center justify-center border-2 border-dashed bg-muted/40",
                  )}
                >
                  {preview.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={preview.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImagePlus className="size-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={uploading === "cover"}
                    onClick={() => coverInputRef.current?.click()}
                  >
                    {uploading === "cover" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      "Upload"
                    )}
                  </Button>
                  {preview.imageUrl && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() =>
                        patch({
                          clearImage: true,
                          imageStorageId: undefined,
                          imageUrl: undefined,
                        })
                      }
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void pickCover(e.target.files?.[0])}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="widget-title">Title</Label>
                  <Input
                    id="widget-title"
                    value={draft.title}
                    maxLength={64}
                    onChange={(e) => patch({ title: e.target.value })}
                    placeholder="Favourite game"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="widget-subtitle">Subtitle</Label>
                  <Input
                    id="widget-subtitle"
                    value={draft.subtitle}
                    maxLength={96}
                    onChange={(e) => patch({ subtitle: e.target.value })}
                    placeholder="Since 2019"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="widget-description">Description</Label>
                <Textarea
                  id="widget-description"
                  rows={3}
                  className="resize-none"
                  value={draft.description}
                  onChange={(e) =>
                    patch({ description: e.target.value.slice(0, DESCRIPTION_MAX) })
                  }
                />
                <p className="text-right text-xs text-muted-foreground">
                  {draft.description.length}/{DESCRIPTION_MAX}
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Fields</Label>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={draft.fields.length >= MAX_FIELDS}
                      onClick={() => addField("text")}
                    >
                      <Type className="size-3.5" />
                      Text
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={draft.fields.length >= MAX_FIELDS}
                      onClick={() => addField("image")}
                    >
                      <ImagePlus className="size-3.5" />
                      Image
                    </Button>
                  </div>
                </div>

                {draft.fields.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Label-and-value rows — a game, a rank, a picture. Up to{" "}
                    {MAX_FIELDS}.
                  </p>
                )}

                {draft.fields.map((field) => (
                  <div
                    key={field.id}
                    className="flex items-start gap-2 rounded-md border border-border/50 p-2"
                  >
                    <div className="min-w-0 flex-1 space-y-2">
                      <Input
                        value={field.label}
                        maxLength={40}
                        placeholder="Label"
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            fields: prev.fields.map((f) =>
                              f.id === field.id ? { ...f, label: e.target.value } : f,
                            ),
                          }))
                        }
                      />
                      {field.kind === "text" ? (
                        <Input
                          value={field.value}
                          maxLength={200}
                          placeholder="Value"
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              fields: prev.fields.map((f) =>
                                f.id === field.id ? { ...f, value: e.target.value } : f,
                              ),
                            }))
                          }
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          {field.value && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={field.value}
                              alt=""
                              className="size-10 rounded object-cover"
                            />
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={uploading === field.id}
                            onClick={() => {
                              pendingFieldId.current = field.id;
                              fieldInputRef.current?.click();
                            }}
                          >
                            {uploading === field.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : field.value ? (
                              "Replace"
                            ) : (
                              "Choose image"
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive"
                      aria-label="Remove field"
                      onClick={() =>
                        patch({
                          fields: draft.fields.filter((f) => f.id !== field.id),
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <input
                  ref={fieldInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void pickFieldImage(e.target.files?.[0])}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Buttons</Label>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={draft.buttons.length >= MAX_BUTTONS}
                    onClick={() =>
                      patch({
                        buttons: [
                          ...draft.buttons,
                          { id: newId(), label: "", url: "" },
                        ],
                      })
                    }
                  >
                    <Plus className="size-3.5" />
                    Add
                  </Button>
                </div>
                {draft.buttons.map((button) => (
                  <div key={button.id} className="flex items-center gap-2">
                    <Input
                      className="w-32 shrink-0"
                      value={button.label}
                      maxLength={40}
                      placeholder="Label"
                      onChange={(e) =>
                        patch({
                          buttons: draft.buttons.map((b) =>
                            b.id === button.id ? { ...b, label: e.target.value } : b,
                          ),
                        })
                      }
                    />
                    <Input
                      value={button.url}
                      placeholder="https://…"
                      onChange={(e) =>
                        patch({
                          buttons: draft.buttons.map((b) =>
                            b.id === button.id ? { ...b, url: e.target.value } : b,
                          ),
                        })
                      }
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive"
                      aria-label="Remove button"
                      onClick={() =>
                        patch({
                          buttons: draft.buttons.filter((b) => b.id !== button.id),
                        })
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="widget-accent">Accent colour</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="widget-accent"
                    type="color"
                    value={draft.accent || "#8b5cf6"}
                    onChange={(e) => patch({ accent: e.target.value })}
                    className="h-9 w-14 cursor-pointer rounded-md border border-border/50 bg-transparent"
                  />
                  {draft.accent && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => patch({ accent: "" })}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </ScrollArea>

          <div className="border-l border-border/40 bg-background/40 p-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Preview</p>
            <ProfileWidgetCard widget={preview} inert />
          </div>
        </div>

        <DialogFooter className="border-t border-border/40 px-5 py-3">
          {draft.widgetId && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive"
              disabled={saving}
              onClick={() => void remove()}
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save widget"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

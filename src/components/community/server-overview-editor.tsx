"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  FileText,
  Hash,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { uploadToStorage } from "@/lib/storage-upload";
import {
  MAX_PROFILE_ASSET_BYTES,
  MAX_PROFILE_ASSET_LABEL,
} from "@/lib/upload-limits";
import { cn } from "@/lib/utils";

/**
 * Arranging a server's overview.
 *
 * A list of the cards down one side and the selected card's form down the
 * other — rather than a dialog per card — because arranging a dashboard is
 * mostly about the order and the mix, and a modal that has to be dismissed
 * between every edit makes that guesswork.
 *
 * The four kinds are fixed (see convex/schema.ts for why), so this is four
 * small forms behind one selector rather than anything general.
 */

type WidgetKind = "channels" | "recentMessages" | "markdown" | "banner";

type Draft = {
  id?: Id<"communityWidgets">;
  title: string;
  width: "half" | "full";
  kind: WidgetKind;
  /** channels */
  channelIds: Id<"channels">[];
  description: string;
  /** recentMessages */
  channelId?: Id<"channels">;
  limit: number;
  /** markdown */
  body: string;
  /** banner */
  imageUrl?: string;
  imageStorageId?: Id<"_storage">;
  heading: string;
  subheading: string;
  linkUrl: string;
  linkLabel: string;
};

const KINDS: { kind: WidgetKind; label: string; hint: string; icon: typeof Hash }[] = [
  {
    kind: "channels",
    label: "Recommended channels",
    hint: "A short list of what to read first.",
    icon: Hash,
  },
  {
    kind: "recentMessages",
    label: "Recent messages",
    hint: "The last few things said in one channel.",
    icon: MessageSquare,
  },
  {
    kind: "markdown",
    label: "Text",
    hint: "Rules, a welcome, anything you want to write.",
    icon: FileText,
  },
  {
    kind: "banner",
    label: "Banner",
    hint: "A picture with a heading over it.",
    icon: ImageIcon,
  },
];

function emptyDraft(kind: WidgetKind = "channels"): Draft {
  return {
    title: "",
    width: "half",
    kind,
    channelIds: [],
    description: "",
    limit: 3,
    body: "",
    heading: "",
    subheading: "",
    linkUrl: "",
    linkLabel: "",
  };
}

/** A stored row back into the form's shape. */
function draftFrom(row: {
  id: Id<"communityWidgets">;
  title?: string;
  width: string;
  config: Record<string, unknown> & { kind: string };
}): Draft {
  const base = emptyDraft(row.config.kind as WidgetKind);
  const config = row.config;
  return {
    ...base,
    id: row.id,
    title: row.title ?? "",
    width: row.width === "full" ? "full" : "half",
    kind: config.kind as WidgetKind,
    channelIds: (config.channelIds as Id<"channels">[]) ?? [],
    description: (config.description as string) ?? "",
    channelId: config.channelId as Id<"channels"> | undefined,
    limit: (config.limit as number) ?? 3,
    body: (config.body as string) ?? "",
    imageUrl: config.imageUrl as string | undefined,
    heading: (config.heading as string) ?? "",
    subheading: (config.subheading as string) ?? "",
    linkUrl: (config.linkUrl as string) ?? "",
    linkLabel: (config.linkLabel as string) ?? "",
  };
}

export function ServerOverviewEditor({
  communityId,
  open,
  onOpenChange,
}: {
  communityId: Id<"communities">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const rows = useQuery(
    api.communityWidgets.listForEditing,
    open ? { communityId } : "skip",
  );
  const channels = useQuery(api.channels.list, open ? { communityId } : "skip") ?? [];
  const upsertWidget = useMutation(api.communityWidgets.upsertWidget);
  const removeWidget = useMutation(api.communityWidgets.removeWidget);
  const reorderWidgets = useMutation(api.communityWidgets.reorderWidgets);
  const generateUploadUrl = useMutation(api.communityWidgets.generateWidgetUploadUrl);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  // Nothing selected on open: the list is the first thing to look at, and
  // auto-selecting a card would put an edit form in front of somebody who came
  // to reorder.
  useEffect(() => {
    if (!open) {
      setDraft(null);
      setError(null);
    }
  }, [open]);

  const patch = (next: Partial<Draft>) =>
    setDraft((prev) => (prev ? { ...prev, ...next } : prev));

  const move = (index: number, delta: number) => {
    if (!rows) return;
    const next = [...rows];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    void reorderWidgets({
      communityId,
      widgetIds: next.map((w) => w.id),
    });
  };

  /** The form's fields folded back into the tagged config the mutation wants. */
  const configFor = (d: Draft) => {
    switch (d.kind) {
      case "channels":
        return {
          kind: "channels" as const,
          channelIds: d.channelIds,
          description: d.description || undefined,
        };
      case "recentMessages":
        if (!d.channelId) throw new Error("Pick a channel for that card.");
        return {
          kind: "recentMessages" as const,
          channelId: d.channelId,
          limit: d.limit,
        };
      case "markdown":
        return { kind: "markdown" as const, body: d.body };
      case "banner":
        return {
          kind: "banner" as const,
          imageUrl: d.imageUrl,
          heading: d.heading || undefined,
          subheading: d.subheading || undefined,
          linkUrl: d.linkUrl || undefined,
          linkLabel: d.linkLabel || undefined,
        };
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await upsertWidget({
        communityId,
        widgetId: draft.id,
        title: draft.title,
        width: draft.width,
        config: configFor(draft),
        imageStorageId: draft.imageStorageId,
      });
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that card.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(88vh,720px)] w-[min(94vw,980px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="border-b border-border/40 px-5 py-4">
          <DialogTitle>Server overview</DialogTitle>
          <DialogDescription>
            The front page people see when they open this server without picking
            a channel.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr]">
          {/* The cards, in order */}
          <div className="flex min-h-0 flex-col border-r border-border/40">
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-1 p-3">
                {rows?.length === 0 && (
                  <p className="px-1 py-4 text-xs text-muted-foreground">
                    No cards yet.
                  </p>
                )}
                {rows?.map((row, index) => {
                  const kind = KINDS.find((k) => k.kind === row.config.kind);
                  const Icon = kind?.icon ?? FileText;
                  return (
                    <div
                      key={row.id}
                      className={cn(
                        "group flex items-center gap-1 rounded-md border px-2 py-1.5",
                        draft?.id === row.id
                          ? "border-primary bg-accent/50"
                          : "border-transparent hover:bg-accent/40",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setDraft(draftFrom(row))}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-xs">
                          {row.title || kind?.label || "Card"}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label="Move up"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        className="px-1 text-xs text-muted-foreground disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        disabled={index === rows.length - 1}
                        onClick={() => move(index, 1)}
                        className="px-1 text-xs text-muted-foreground disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-label="Delete card"
                        onClick={() => {
                          void removeWidget({ widgetId: row.id });
                          if (draft?.id === row.id) setDraft(null);
                        }}
                        className="px-1 text-destructive opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            <div className="space-y-1 border-t border-border/40 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Add a card
              </p>
              {KINDS.map((kind) => (
                <button
                  key={kind.kind}
                  type="button"
                  onClick={() => setDraft(emptyDraft(kind.kind))}
                  className="flex w-full items-start gap-2 rounded-md border border-border/50 px-2 py-1.5 text-left transition-colors hover:border-primary/60 hover:bg-accent/40"
                >
                  <Plus className="mt-0.5 size-3 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium">{kind.label}</span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">
                      {kind.hint}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* The selected card's form */}
          <ScrollArea className="min-h-0">
            {!draft ? (
              <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
                Pick a card to edit, or add one.
              </div>
            ) : (
              <div className="space-y-4 p-5">
                <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                  <div className="space-y-1.5">
                    <Label htmlFor="ow-title">Title</Label>
                    <Input
                      id="ow-title"
                      value={draft.title}
                      maxLength={80}
                      placeholder={
                        KINDS.find((k) => k.kind === draft.kind)?.label ?? ""
                      }
                      onChange={(e) => patch({ title: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Width</Label>
                    <Select
                      value={draft.width}
                      onValueChange={(value) =>
                        patch({ width: value as "half" | "full" })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="half">Half</SelectItem>
                        <SelectItem value="full">Full</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {draft.kind === "channels" && (
                  <div className="space-y-2">
                    <Label>Channels</Label>
                    <p className="text-xs text-muted-foreground">
                      Anyone who can&apos;t see one of these simply won&apos;t
                      see it on the card.
                    </p>
                    <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border/50 p-2">
                      {channels.map((channel) => (
                        <label
                          key={channel.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-accent/50"
                        >
                          <Checkbox
                            checked={draft.channelIds.includes(channel.id)}
                            onCheckedChange={() =>
                              patch({
                                channelIds: draft.channelIds.includes(channel.id)
                                  ? draft.channelIds.filter((id) => id !== channel.id)
                                  : [...draft.channelIds, channel.id],
                              })
                            }
                          />
                          <Hash className="size-3.5 text-muted-foreground" />
                          <span className="text-sm">{channel.name}</span>
                        </label>
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ow-description">Description</Label>
                      <Input
                        id="ow-description"
                        value={draft.description}
                        maxLength={160}
                        placeholder="Optional"
                        onChange={(e) => patch({ description: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                {draft.kind === "recentMessages" && (
                  <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                    <div className="space-y-1.5">
                      <Label>Channel</Label>
                      <Select
                        value={draft.channelId ?? ""}
                        onValueChange={(value) =>
                          patch({ channelId: value as Id<"channels"> })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Pick a channel" />
                        </SelectTrigger>
                        <SelectContent>
                          {channels
                            .filter((c) => c.type === "text")
                            .map((channel) => (
                              <SelectItem key={channel.id} value={channel.id}>
                                #{channel.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ow-limit">How many</Label>
                      <Input
                        id="ow-limit"
                        type="number"
                        min={1}
                        max={8}
                        value={draft.limit}
                        onChange={(e) =>
                          patch({
                            limit: Math.min(8, Math.max(1, Number(e.target.value) || 1)),
                          })
                        }
                      />
                    </div>
                  </div>
                )}

                {draft.kind === "markdown" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="ow-body">Text</Label>
                    <Textarea
                      id="ow-body"
                      rows={10}
                      className="font-mono text-xs"
                      value={draft.body}
                      onChange={(e) => patch({ body: e.target.value })}
                      placeholder={"## Welcome\n\nBe kind. Read #rules."}
                    />
                    <p className="text-xs text-muted-foreground">
                      Markdown — headings, lists, links, bold.
                    </p>
                  </div>
                )}

                {draft.kind === "banner" && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>Image</Label>
                      <div
                        className={cn(
                          "h-28 overflow-hidden rounded-md bg-cover bg-center",
                          !draft.imageUrl &&
                            "flex items-center justify-center border-2 border-dashed bg-muted/40",
                        )}
                        style={
                          draft.imageUrl
                            ? { backgroundImage: `url(${draft.imageUrl})` }
                            : undefined
                        }
                      >
                        {!draft.imageUrl && (
                          <ImageIcon className="size-5 text-muted-foreground" />
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={uploading}
                        onClick={() => imageInput.current?.click()}
                      >
                        {uploading ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : draft.imageUrl ? (
                          "Replace"
                        ) : (
                          "Upload"
                        )}
                      </Button>
                      <input
                        ref={imageInput}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file) return;
                          if (file.size > MAX_PROFILE_ASSET_BYTES) {
                            setError(
                              `Images must be smaller than ${MAX_PROFILE_ASSET_LABEL}.`,
                            );
                            return;
                          }
                          setUploading(true);
                          setError(null);
                          try {
                            const storageId = (await uploadToStorage(
                              await generateUploadUrl({ communityId }),
                              file,
                            )) as Id<"_storage">;
                            // Previewed from the local file — the storage URL
                            // isn't resolved until the save.
                            patch({
                              imageStorageId: storageId,
                              imageUrl: URL.createObjectURL(file),
                            });
                          } catch (err) {
                            setError(
                              err instanceof Error ? err.message : "Upload failed.",
                            );
                          } finally {
                            setUploading(false);
                          }
                        }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ow-heading">Heading</Label>
                      <Input
                        id="ow-heading"
                        value={draft.heading}
                        maxLength={80}
                        onChange={(e) => patch({ heading: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ow-subheading">Subheading</Label>
                      <Input
                        id="ow-subheading"
                        value={draft.subheading}
                        maxLength={160}
                        onChange={(e) => patch({ subheading: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                      <div className="space-y-1.5">
                        <Label htmlFor="ow-link-label">Button</Label>
                        <Input
                          id="ow-link-label"
                          value={draft.linkLabel}
                          maxLength={40}
                          placeholder="Optional"
                          onChange={(e) => patch({ linkLabel: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ow-link-url">Link</Label>
                        <Input
                          id="ow-link-url"
                          value={draft.linkUrl}
                          placeholder="https://…"
                          onChange={(e) => patch({ linkUrl: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {error && <p className="text-sm text-destructive">{error}</p>}

                <div className="flex items-center gap-2 border-t border-border/40 pt-4">
                  <Button disabled={saving} onClick={() => void save()}>
                    {saving ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : draft.id ? (
                      "Save card"
                    ) : (
                      "Add card"
                    )}
                  </Button>
                  <Button variant="outline" onClick={() => setDraft(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

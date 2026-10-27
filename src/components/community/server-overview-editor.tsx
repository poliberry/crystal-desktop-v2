"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import {
  BarChart3,
  CalendarDays,
  FileText,
  Hash,
  Image as ImageIcon,
  ListOrdered,
  Loader2,
  MessageSquare,
  Plus,
  StickyNote,
  Timer,
  Trash2,
} from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OverviewBoard, type BoardRow } from "@/components/community/overview-board";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { uploadImage } from "@/lib/cdn-upload";
import {
  MAX_PROFILE_ASSET_BYTES,
  MAX_PROFILE_ASSET_LABEL,
} from "@/lib/upload-limits";
import { type PlacedCell, bottomOf, defaultSize, fillLayouts } from "@/lib/overview-layout";
import { cn } from "@/lib/utils";

/**
 * Arranging a server's overview.
 *
 * A pinboard on the overview page itself, in place of the cards it is
 * arranging: the library of new cards down the left, the board in the middle
 * where cards are dragged about and resized, and the selected card's controls
 * down the right. Editing the page where it will be read is the point — the
 * board is the overview, with handles on.
 *
 * The kinds are fixed (see convex/schema.ts for why), so this is a small form
 * per kind behind one selector rather than anything general.
 */

type WidgetKind =
  | "channels"
  | "recentMessages"
  | "markdown"
  | "banner"
  | "rules"
  | "note"
  | "countdown"
  | "calendar"
  | "poll";

const NOTE_COLORS = ["yellow", "pink", "blue", "green", "orange"] as const;

/** An epoch ms as the `YYYY-MM-DDTHH:mm` a datetime-local input wants, in the
 * viewer's own time. */
function toLocalInput(ms: number | undefined): string {
  if (ms === undefined) return "";
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

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
  /** rules */
  rules: { title: string; body: string }[];
  /** note (its text is `body`) */
  noteColor: string;
  /** countdown (its text is `description`) */
  target?: number;
  /** calendar */
  events: { date: string; title: string }[];
  /** poll */
  question: string;
  options: string[];
  closesAt?: number;
  /** banner */
  imageUrl?: string;
  imageStorageId?: Id<"_storage">;
  /** The same, when it went to the CDN instead. */
  imageCdnKey?: string;
  imageCdnUrl?: string;
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
    kind: "rules",
    label: "Rules",
    hint: "A numbered list of the house rules.",
    icon: ListOrdered,
  },
  {
    kind: "note",
    label: "Note from the owner",
    hint: "A post-it with your name and picture on it.",
    icon: StickyNote,
  },
  {
    kind: "countdown",
    label: "Countdown",
    hint: "Days, hours and minutes to something.",
    icon: Timer,
  },
  {
    kind: "calendar",
    label: "Calendar",
    hint: "A month, with the days something is on marked.",
    icon: CalendarDays,
  },
  {
    kind: "poll",
    label: "Poll",
    hint: "A question for members to vote on.",
    icon: BarChart3,
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
    rules: [],
    noteColor: "yellow",
    events: [],
    question: "",
    options: ["", ""],
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
    rules: ((config.rules as { title: string; body?: string }[]) ?? []).map((r) => ({
      title: r.title,
      body: r.body ?? "",
    })),
    noteColor: (config.color as string) ?? "yellow",
    target: config.target as number | undefined,
    events: ((config.events as { date: string; title: string }[]) ?? []).map((e) => ({ ...e })),
    question: (config.question as string) ?? "",
    options: (config.options as string[]) ?? ["", ""],
    closesAt: config.closesAt as number | undefined,
    imageUrl: config.imageUrl as string | undefined,
    heading: (config.heading as string) ?? "",
    subheading: (config.subheading as string) ?? "",
    linkUrl: (config.linkUrl as string) ?? "",
    linkLabel: (config.linkLabel as string) ?? "",
  };
}

const PANEL_SPRING = { type: "spring" as const, stiffness: 420, damping: 36 };

/** The editor arrives as the page's own edges: the new-card list from the left,
 * the controls from the right, and the board fading up between them. They
 * share the root's `initial`/`animate`/`exit`, so the page sets all three off
 * at once — and on the way out they run in reverse. */
const FROM_LEFT = { hidden: { x: -48, opacity: 0 }, shown: { x: 0, opacity: 1 } };
const FROM_RIGHT = { hidden: { x: 48, opacity: 0 }, shown: { x: 0, opacity: 1 } };
const BOARD = { hidden: { opacity: 0, scale: 0.985 }, shown: { opacity: 1, scale: 1 } };

export function ServerOverviewEditor({
  communityId,
  onDone,
}: {
  communityId: Id<"communities">;
  /** Back to reading the page. */
  onDone: () => void;
}) {
  const convex = useConvex();
  const rows = useQuery(api.communityWidgets.listForEditing, { communityId });
  const channels = useQuery(api.channels.list, { communityId }) ?? [];
  const upsertWidget = useMutation(api.communityWidgets.upsertWidget);
  const removeWidget = useMutation(api.communityWidgets.removeWidget);
  const saveLayout = useMutation(api.communityWidgets.saveLayout);
  const generateUploadUrl = useMutation(api.communityWidgets.generateWidgetUploadUrl);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Edits not yet saved, by card. Held for every card at once, so selecting
   * another doesn't lose them and one bar saves or drops the lot. */
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A card just made, to be selected once it shows up in `rows`. */
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  const channelNames = useMemo(
    () => new Map<string, string>(channels.map((c: any) => [c.id as string, c.name as string])),
    [channels],
  );

  // The selected card as the form shows it: the edits to it if there are any,
  // else what is stored — so a card nobody has touched follows the server.
  const selectedRow = rows?.find((r) => r.id === selectedId);
  const draft: Draft | null = selectedRow
    ? (drafts[selectedRow.id] ?? draftFrom(selectedRow))
    : null;

  const patch = (next: Partial<Draft>) => {
    if (!selectedRow) return;
    setDrafts((prev) => ({
      ...prev,
      [selectedRow.id]: { ...(prev[selectedRow.id] ?? draftFrom(selectedRow)), ...next },
    }));
  };

  const select = (id: string | null) => {
    setError(null);
    setSelectedId(id);
  };

  // A new card is selected as soon as the server has it.
  useEffect(() => {
    if (!pendingSelect || !rows) return;
    if (rows.some((r) => r.id === pendingSelect)) {
      setSelectedId(pendingSelect);
      setPendingSelect(null);
    }
  }, [pendingSelect, rows]);

  /** A new card at the bottom of the board, with something in it so it is a
   * card and not a hole. */
  const addCard = async (kind: WidgetKind) => {
    setError(null);
    const textChannels = channels.filter((c: any) => c.type === "text");
    let config: ReturnType<typeof configFor>;
    switch (kind) {
      case "channels":
        config = {
          kind: "channels",
          channelIds: textChannels.slice(0, 3).map((c: any) => c.id),
          description: undefined,
        };
        break;
      case "recentMessages":
        if (textChannels.length === 0) {
          setError("Make a text channel first — this card shows one.");
          return;
        }
        config = { kind: "recentMessages", channelId: textChannels[0].id, limit: 3 };
        break;
      case "markdown":
        config = { kind: "markdown", body: "Write something for the people who just arrived." };
        break;
      case "rules":
        config = { kind: "rules", rules: [{ title: "Be respectful", body: undefined }] };
        break;
      case "note":
        config = { kind: "note", body: "Welcome! Glad you're here.", color: "yellow" };
        break;
      case "countdown":
        // A week out, so it has something to count down to straight away.
        config = {
          kind: "countdown",
          target: Date.now() + 7 * 24 * 3600 * 1000,
          description: undefined,
        };
        break;
      case "calendar":
        config = { kind: "calendar", events: [] };
        break;
      case "poll":
        config = {
          kind: "poll",
          question: "What should we do next?",
          options: ["Option one", "Option two"],
          closesAt: undefined,
        };
        break;
      case "banner":
        config = {
          kind: "banner",
          imageUrl: undefined,
          heading: "Welcome",
          subheading: undefined,
          linkUrl: undefined,
          linkLabel: undefined,
        };
        break;
    }
    const placed = fillLayouts(
      (rows ?? []).map((r) => ({ id: r.id, layout: r.layout, width: r.width, kind: r.config.kind })),
    );
    const size = defaultSize(kind);
    try {
      const id = await upsertWidget({
        communityId,
        config,
        layout: { x: 0, y: bottomOf(placed), ...size },
      });
      setPendingSelect(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that card.");
    }
  };

  const commitLayout = (cells: PlacedCell[]) => {
    void saveLayout({
      communityId,
      items: cells.map((c) => ({
        id: c.id as Id<"communityWidgets">,
        x: c.x,
        y: c.y,
        w: c.w,
        h: c.h,
      })),
    });
  };

  const deleteCard = (id: string) => {
    void removeWidget({ widgetId: id as Id<"communityWidgets"> });
    setDrafts(({ [id]: _dropped, ...rest }) => rest);
    if (selectedId === id) setSelectedId(null);
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
      case "note":
        return { kind: "note" as const, body: d.body, color: d.noteColor };
      case "countdown":
        if (d.target === undefined) throw new Error("Pick a date and time to count down to.");
        return {
          kind: "countdown" as const,
          target: d.target,
          description: d.description || undefined,
        };
      case "calendar":
        return {
          kind: "calendar" as const,
          events: d.events.filter((e) => e.date && e.title.trim()),
        };
      case "poll":
        return {
          kind: "poll" as const,
          question: d.question,
          options: d.options.filter((o) => o.trim()),
          closesAt: d.closesAt,
        };
      case "rules":
        return {
          kind: "rules" as const,
          rules: d.rules
            .filter((r) => r.title.trim())
            .map((r) => ({ title: r.title.trim(), body: r.body.trim() || undefined })),
        };
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

  /** Cards that have edits and still exist. */
  const dirtyIds = useMemo(
    () => new Set(Object.keys(drafts).filter((id) => rows?.some((r) => r.id === id))),
    [drafts, rows],
  );

  /** The board shows what a card will say once saved, not only what it says
   * now, so an edit is visible where it will be read. */
  const boardRows = useMemo(
    () =>
      (rows ?? []).map((row) => {
        const edited = drafts[row.id];
        if (!edited) return row;
        try {
          return { ...row, title: edited.title || undefined, config: configFor(edited) };
        } catch {
          // A half-filled card (no channel picked yet) stays as it was.
          return row;
        }
      }),
    [rows, drafts],
  );

  const saveAll = async () => {
    setSaving(true);
    setError(null);
    try {
      for (const id of dirtyIds) {
        const edited = drafts[id]!;
        await upsertWidget({
          communityId,
          widgetId: id as Id<"communityWidgets">,
          title: edited.title,
          width: edited.width,
          config: configFor(edited),
          imageStorageId: edited.imageStorageId,
          imageCdnKey: edited.imageCdnKey,
          imageCdnUrl: edited.imageCdnUrl,
        });
        // Each is dropped as it lands, so a failure part-way keeps only what
        // didn't.
        setDrafts(({ [id]: _saved, ...rest }) => rest);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save those changes.");
    } finally {
      setSaving(false);
    }
  };

  const leave = () => {
    if (dirtyIds.size > 0 && !window.confirm("Discard your unsaved changes?")) return;
    onDone();
  };

  return (
    <motion.div
      className="flex min-h-0 flex-1"
      initial="hidden"
      animate="shown"
      exit="hidden"
      transition={PANEL_SPRING}
    >
      {/* New cards */}
      <motion.aside
        variants={FROM_LEFT}
        className="flex w-60 shrink-0 flex-col border-r border-border/40 bg-card/30"
      >
        <div className="space-y-0.5 border-b border-border/40 px-4 py-3">
          <h2 className="text-sm font-semibold">New card</h2>
          <p className="text-xs text-muted-foreground">Click one to pin it to the board.</p>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1.5 p-3">
            {KINDS.map((kind) => (
              <button
                key={kind.kind}
                type="button"
                onClick={() => void addCard(kind.kind)}
                className="flex w-full items-start gap-2.5 rounded-lg border border-border/50 bg-card/50 px-3 py-2 text-left transition-colors hover:border-primary/60 hover:bg-accent/40"
              >
                <kind.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{kind.label}</span>
                  <span className="block text-xs leading-snug text-muted-foreground">
                    {kind.hint}
                  </span>
                </span>
                <Plus className="mt-0.5 ml-auto size-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </ScrollArea>
      </motion.aside>

      {/* The board */}
      <motion.section variants={BOARD} className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-border/40 px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Arranging the overview</h2>
            <p className="text-xs text-muted-foreground">
              Drag a card to move it, pull its corner to resize it. Changes save as you go.
            </p>
          </div>
          <Button size="sm" onClick={leave}>
            Done
          </Button>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-5">
            {rows === undefined ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <OverviewBoard
                rows={boardRows as BoardRow[]}
                channelNames={channelNames}
                dirtyIds={dirtyIds}
                selectedId={selectedId}
                onSelect={select}
                onDelete={deleteCard}
                onLayout={commitLayout}
              />
            )}
          </div>
        </ScrollArea>

        {/* Unsaved edits to any card, in one place. */}
        <AnimatePresence>
          {dirtyIds.size > 0 && (
            <motion.div
              key="save-bar"
              role="status"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 24 }}
              transition={PANEL_SPRING}
              className="absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-popover/95 py-2 pr-2 pl-4 shadow-xl backdrop-blur-xl"
            >
              <span className="text-sm">
                {dirtyIds.size === 1 ? "1 card changed" : `${dirtyIds.size} cards changed`}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                disabled={saving}
                onClick={() => setDrafts({})}
              >
                Discard
              </Button>
              <Button
                size="sm"
                className="rounded-full"
                disabled={saving}
                onClick={() => void saveAll()}
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : "Save changes"}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>

      {/* The selected card's controls */}
      <motion.aside
        variants={FROM_RIGHT}
        className="flex w-[22rem] shrink-0 flex-col border-l border-border/40 bg-card/30"
      >
        <ScrollArea className="min-h-0 flex-1">
          {!draft ? (
            <div className="space-y-2 p-6 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nothing selected</p>
              <p>Pick a card on the board to change what it says.</p>
              {error && <p className="text-destructive">{error}</p>}
            </div>
          ) : (
      <div className="space-y-4 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="ow-title">Title</Label>
          <Input
            id="ow-title"
            value={draft.title}
            maxLength={80}
            placeholder={KINDS.find((k) => k.kind === draft.kind)?.label ?? ""}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </div>

        {draft.kind === "channels" && (
          <div className="space-y-2">
            <Label>Channels</Label>
            <p className="text-xs text-muted-foreground">
              Anyone who can&apos;t see one of these simply won&apos;t
              see it on the card.
            </p>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border/50 p-2">
              {channels.map((channel: any) => (
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
                    .filter((c: any) => c.type === "text")
                    .map((channel: any) => (
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

        {draft.kind === "rules" && (
          <div className="space-y-2">
            <Label>Rules</Label>
            {draft.rules.map((rule, index) => (
              <div key={index} className="flex gap-2 rounded-md border p-2">
                <span className="mt-2 w-5 shrink-0 text-center text-xs font-semibold text-muted-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Input
                    value={rule.title}
                    maxLength={120}
                    placeholder="Be respectful"
                    onChange={(e) =>
                      patch({
                        rules: draft.rules.map((r, i) =>
                          i === index ? { ...r, title: e.target.value } : r,
                        ),
                      })
                    }
                  />
                  <Textarea
                    rows={2}
                    value={rule.body}
                    maxLength={600}
                    placeholder="Optional — a sentence of explanation"
                    className="resize-none text-xs"
                    onChange={(e) =>
                      patch({
                        rules: draft.rules.map((r, i) =>
                          i === index ? { ...r, body: e.target.value } : r,
                        ),
                      })
                    }
                  />
                </div>
                <button
                  type="button"
                  aria-label="Remove rule"
                  onClick={() => patch({ rules: draft.rules.filter((_, i) => i !== index) })}
                  className="mt-1.5 h-fit text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={draft.rules.length >= 15}
              onClick={() => patch({ rules: [...draft.rules, { title: "", body: "" }] })}
            >
              <Plus className="size-3.5" />
              Add a rule
            </Button>
          </div>
        )}

        {draft.kind === "note" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ow-note">Note</Label>
              <Textarea
                id="ow-note"
                rows={6}
                maxLength={500}
                value={draft.body}
                onChange={(e) => patch({ body: e.target.value })}
                placeholder="A few words for the people who just arrived."
              />
              <p className="text-xs text-muted-foreground">
                Signed with the owner&apos;s name and picture, as they are now.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Paper</Label>
              <div className="flex gap-2">
                {NOTE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={color}
                    aria-pressed={draft.noteColor === color}
                    onClick={() => patch({ noteColor: color })}
                    className={cn(
                      "size-7 rounded-sm border-2",
                      {
                        yellow: "bg-amber-200",
                        pink: "bg-pink-200",
                        blue: "bg-sky-200",
                        green: "bg-lime-200",
                        orange: "bg-orange-200",
                      }[color],
                      draft.noteColor === color ? "border-primary" : "border-transparent",
                    )}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {draft.kind === "countdown" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ow-target">Counting down to</Label>
              <Input
                id="ow-target"
                type="datetime-local"
                value={toLocalInput(draft.target)}
                onChange={(e) =>
                  patch({ target: e.target.value ? new Date(e.target.value).getTime() : undefined })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ow-countdown-note">Underneath</Label>
              <Input
                id="ow-countdown-note"
                value={draft.description}
                maxLength={160}
                placeholder="Optional"
                onChange={(e) => patch({ description: e.target.value })}
              />
            </div>
          </div>
        )}

        {draft.kind === "calendar" && (
          <div className="space-y-2">
            <Label>Events</Label>
            {draft.events.map((event, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <Input
                  type="date"
                  value={event.date}
                  className="w-36 shrink-0"
                  onChange={(e) =>
                    patch({
                      events: draft.events.map((ev, i) =>
                        i === index ? { ...ev, date: e.target.value } : ev,
                      ),
                    })
                  }
                />
                <Input
                  value={event.title}
                  maxLength={80}
                  placeholder="Movie night"
                  onChange={(e) =>
                    patch({
                      events: draft.events.map((ev, i) =>
                        i === index ? { ...ev, title: e.target.value } : ev,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label="Remove event"
                  onClick={() => patch({ events: draft.events.filter((_, i) => i !== index) })}
                  className="shrink-0 text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={draft.events.length >= 50}
              onClick={() =>
                patch({
                  events: [...draft.events, { date: new Date().toISOString().slice(0, 10), title: "" }],
                })
              }
            >
              <Plus className="size-3.5" />
              Add an event
            </Button>
          </div>
        )}

        {draft.kind === "poll" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ow-question">Question</Label>
              <Input
                id="ow-question"
                value={draft.question}
                maxLength={160}
                onChange={(e) => patch({ question: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Answers</Label>
              {draft.options.map((option, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <Input
                    value={option}
                    maxLength={80}
                    placeholder={`Answer ${index + 1}`}
                    onChange={(e) =>
                      patch({
                        options: draft.options.map((o, i) => (i === index ? e.target.value : o)),
                      })
                    }
                  />
                  <button
                    type="button"
                    aria-label="Remove answer"
                    disabled={draft.options.length <= 2}
                    onClick={() => patch({ options: draft.options.filter((_, i) => i !== index) })}
                    className="shrink-0 text-destructive disabled:opacity-30"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={draft.options.length >= 8}
                onClick={() => patch({ options: [...draft.options, ""] })}
              >
                <Plus className="size-3.5" />
                Add an answer
              </Button>
              <p className="text-xs text-muted-foreground">
                Changing the answers after people have voted can move their votes.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ow-closes">Closes</Label>
              <Input
                id="ow-closes"
                type="datetime-local"
                value={toLocalInput(draft.closesAt)}
                onChange={(e) =>
                  patch({ closesAt: e.target.value ? new Date(e.target.value).getTime() : undefined })
                }
              />
              <p className="text-xs text-muted-foreground">Leave empty to keep it open.</p>
            </div>
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
                    // CDN first, like every other picture.
                    const uploaded = await uploadImage(convex, file, "banners", () =>
                      generateUploadUrl({ communityId }),
                    );
                    // Previewed from the local file when it went to Convex
                    // storage — that URL isn't resolved until the save.
                    patch({
                      imageStorageId: uploaded.storageId,
                      imageCdnKey: uploaded.cdnKey,
                      imageCdnUrl: uploaded.cdnUrl,
                      imageUrl: uploaded.cdnUrl ?? URL.createObjectURL(file),
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
      </div>
          )}
        </ScrollArea>
      </motion.aside>
    </motion.div>
  );
}

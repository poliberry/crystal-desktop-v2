"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Pencil, Plus } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  ProfileWidgetCard,
  type BoardWidget,
} from "@/components/profile/profile-board";
import {
  emptyDraft,
  WidgetEditorDialog,
  WIDGET_TEMPLATES,
  type DraftWidget,
} from "@/components/profile/widget-editor-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The Board tab of the profile editor: the widgets on this board, plus the
 * library of starting points for a new one.
 *
 * Reads through `listMyBoard` rather than `listBoard` because the two answer
 * different questions — the viewer's query falls back to the account board
 * when a server board is empty, and an editor that did that would show you
 * somebody else's cards and then save your edits into the wrong scope.
 */
export function BoardEditor({
  communityId,
  scopeLabel,
}: {
  /** Which board is being edited. Absent is the account's own. */
  communityId?: Id<"communities">;
  /** How to name that scope in the copy — "your main profile", a server name. */
  scopeLabel: string;
}) {
  const widgets = useQuery(api.profileWidgets.listMyBoard, { communityId });
  const reorderWidgets = useMutation(api.profileWidgets.reorderWidgets);
  const [draft, setDraft] = useState<DraftWidget | null>(null);
  const [open, setOpen] = useState(false);

  const edit = (widget: BoardWidget) => {
    setDraft({
      widgetId: widget.id as Id<"profileWidgets">,
      title: widget.title ?? "",
      subtitle: widget.subtitle ?? "",
      description: widget.description ?? "",
      imageUrl: widget.imageUrl,
      accent: widget.accent ?? "",
      fields: widget.fields.map((f) => ({ ...f })),
      buttons: widget.buttons.map((b) => ({ ...b })),
    });
    setOpen(true);
  };

  const create = (seed?: Partial<DraftWidget>) => {
    setDraft(emptyDraft(seed));
    setOpen(true);
  };

  /** Nudge a card one place along. A full drag-and-drop reorder is what this
   * wants eventually; two buttons move the same data through the same mutation
   * and don't leave the board unorderable in the meantime. */
  const move = (index: number, delta: number) => {
    if (!widgets) return;
    const next = [...widgets];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    void reorderWidgets({
      widgetIds: next.map((w) => w.id as Id<"profileWidgets">),
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">Customise your profile with widgets</h3>
        <p className="text-sm text-muted-foreground">
          Cards on {scopeLabel} for whatever you want to share — a favourite
          game, an about-me, what you&apos;re playing at the moment.
        </p>
      </div>

      {widgets && widgets.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {widgets.map((widget, index) => (
            <div key={widget.id} className="group relative">
              <ProfileWidgetCard widget={widget as BoardWidget} inert />
              {/* The controls live over the card rather than under it: the
                  board is a grid of tiles, and a row of buttons beneath each
                  one would double its height for something only reached on
                  hover. */}
              <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <Button
                  size="icon"
                  variant="secondary"
                  className="size-7"
                  aria-label="Move left"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ←
                </Button>
                <Button
                  size="icon"
                  variant="secondary"
                  className="size-7"
                  aria-label="Move right"
                  disabled={index === widgets.length - 1}
                  onClick={() => move(index, 1)}
                >
                  →
                </Button>
                <Button
                  size="icon"
                  variant="secondary"
                  className="size-7"
                  aria-label="Edit widget"
                  onClick={() => edit(widget as BoardWidget)}
                >
                  <Pencil className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          {widgets && widgets.length > 0 ? "Add another" : "Start from"}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {WIDGET_TEMPLATES.map((template) => (
            <button
              key={template.key}
              type="button"
              onClick={() => create(template.seed)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border border-border/50 bg-card/40 p-3 text-left transition-colors",
                "hover:border-primary/60 hover:bg-accent/40",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Plus className="size-4" />
                {template.label}
              </span>
              <span className="text-xs text-muted-foreground">{template.hint}</span>
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => create()}>
          <Plus className="size-4" />
          Blank widget
        </Button>
      </div>

      <WidgetEditorDialog
        open={open}
        onOpenChange={setOpen}
        draft={draft}
        communityId={communityId}
        onDeleted={() => setDraft(null)}
      />
    </div>
  );
}

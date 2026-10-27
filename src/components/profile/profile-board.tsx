"use client";

import { useQuery } from "convex/react";
import { ExternalLink, LayoutGrid } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useCachedImageSrc } from "@/lib/image-cache";
import { cn } from "@/lib/utils";

/**
 * The Board — the widgets somebody has pinned to their profile.
 *
 * A widget has no fixed meaning (see convex/profileWidgets.ts): it is a
 * picture, some words, a list of label/value rows and up to three links. What
 * makes it a "favourite game" or an "about me" is what the owner typed into it,
 * so this file draws one shape and lets the content say what it is.
 */

export interface BoardWidget {
  id: string;
  title?: string;
  subtitle?: string;
  description?: string;
  imageUrl?: string;
  accent?: string;
  fields: { id: string; kind: "text" | "image"; label: string; value: string }[];
  buttons: { id: string; label: string; url: string }[];
}

/** One field row. An image field is its picture with the label beneath, a text
 * field is the label above the words — the same two-line rhythm either way, so
 * a mixed list still reads as one column. */
function WidgetField({
  field,
}: {
  field: BoardWidget["fields"][number];
}) {
  const cachedFieldImage = useCachedImageSrc(
    field.kind === "image" ? field.value : undefined,
  );
  if (field.kind === "image") {
    return (
      <div className="min-w-0">
        <div className="overflow-hidden rounded-md border border-border/40 bg-background/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cachedFieldImage ?? field.value}
            alt={field.label}
            className="h-20 w-full object-cover"
            loading="lazy"
          />
        </div>
        {field.label && (
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {field.label}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {field.label && (
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {field.label}
        </p>
      )}
      <p className="text-sm break-words whitespace-pre-wrap">{field.value}</p>
    </div>
  );
}

export function ProfileWidgetCard({
  widget,
  className,
  /** Rendered in the editor, where the card is a target for editing rather
   * than a thing to click through. Suppresses the link buttons' navigation. */
  inert = false,
}: {
  widget: BoardWidget;
  className?: string;
  inert?: boolean;
}) {
  const accent = widget.accent;
  const cachedCover = useCachedImageSrc(widget.imageUrl);

  return (
    <div
      data-slot="profile-widget"
      className={cn(
        "overflow-hidden rounded-lg border border-border/50 bg-card/60 backdrop-blur-sm",
        className,
      )}
      // The tint is applied as an inline border colour rather than a class
      // because it's a free-form hex the user picked; there is no palette to
      // map it onto.
      style={accent ? { borderColor: `${accent}66` } : undefined}
    >
      {widget.imageUrl && (
        <div data-slot="profile-widget-image" className="relative h-24 w-full overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cachedCover ?? widget.imageUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
          {/* The wash is what lets a title sit over any picture and stay
              legible, rather than hoping the artwork is dark at the bottom. */}
          <div className="absolute inset-0 bg-gradient-to-t from-card/95 via-card/30 to-transparent" />
        </div>
      )}

      <div className={cn("space-y-3 p-3", widget.imageUrl && "-mt-8 relative")}>
        {(widget.title || widget.subtitle) && (
          <div className="min-w-0">
            {widget.title && (
              <p
                data-slot="profile-widget-title"
                className="truncate text-sm font-semibold"
                style={accent ? { color: accent } : undefined}
              >
                {widget.title}
              </p>
            )}
            {widget.subtitle && (
              <p className="truncate text-xs text-muted-foreground">
                {widget.subtitle}
              </p>
            )}
          </div>
        )}

        {widget.description && (
          <p
            data-slot="profile-widget-description"
            className="text-sm whitespace-pre-wrap text-foreground/90"
          >
            {widget.description}
          </p>
        )}

        {widget.fields.length > 0 && (
          // Two columns, because most fields are short pairs and a single
          // column of them leaves the card mostly empty; a long text field
          // spans both rather than being squeezed into half the width.
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {widget.fields.map((field) => (
              <div
                key={field.id}
                className={cn(
                  field.kind === "text" && field.value.length > 60 && "col-span-2",
                )}
              >
                <WidgetField field={field} />
              </div>
            ))}
          </div>
        )}

        {widget.buttons.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {widget.buttons.map((button) =>
              inert ? (
                <span
                  key={button.id}
                  className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-xs text-muted-foreground"
                >
                  {button.label}
                  <ExternalLink className="size-3" />
                </span>
              ) : (
                <a
                  key={button.id}
                  href={button.url}
                  target="_blank"
                  // `noreferrer` as well as `noopener`: these are links a
                  // stranger put on their profile, and the destination has no
                  // business being told where the click came from.
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-border/50 px-2 py-1 text-xs transition-colors hover:bg-accent"
                >
                  {button.label}
                  <ExternalLink className="size-3" />
                </a>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The empty state. Written as "nothing here yet" rather than as an error,
 * because a profile with no board is the normal case. */
export function EmptyBoard({ what }: { what: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border/50 py-10 text-center text-sm text-muted-foreground">
      <LayoutGrid className="size-5" />
      <p>{what}</p>
    </div>
  );
}

/**
 * Somebody else's board, read from the server.
 *
 * Inside a community this shows that community's board when they've made one —
 * the fallback to their account board lives in the query, where it can tell an
 * empty server board from a missing one.
 */
export function ProfileBoard({
  userId,
  communityId,
  name,
}: {
  userId: Id<"users">;
  communityId?: Id<"communities">;
  name: string;
}) {
  const widgets = useQuery(api.profileWidgets.listBoard, { userId, communityId });

  if (widgets === undefined) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-lg border border-border/40 bg-muted/30"
          />
        ))}
      </div>
    );
  }

  if (widgets.length === 0) {
    return <EmptyBoard what={`${name} hasn't added any widgets yet.`} />;
  }

  return (
    <div data-slot="profile-board" className="grid gap-2 sm:grid-cols-2">
      {widgets.map((widget) => (
        <ProfileWidgetCard key={widget.id} widget={widget as BoardWidget} />
      ))}
    </div>
  );
}

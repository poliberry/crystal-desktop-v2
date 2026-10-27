"use client";

import { CommunityThemeWash } from "@/components/community/community-theme-wash";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Hash,
  LayoutDashboard,
  Pencil,
  Volume2,
} from "lucide-react";
import moment from "moment";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CachedBackground } from "@/components/cached-background";
import { ServerOverviewEditor } from "@/components/community/server-overview-editor";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fillLayouts, resolve } from "@/lib/overview-layout";
import { cn } from "@/lib/utils";

/**
 * A server's front page.
 *
 * This is what fills the space where "Select a channel" used to be — the
 * moment somebody opens a server and hasn't chosen anything yet, which is
 * exactly when they most need telling where to go. A server with no overview
 * configured still says that, so nothing is lost by not having one.
 *
 * Every card arrives fully resolved from `communityWidgets.listOverview`,
 * including which channels the reader is actually allowed to see. Nothing in
 * this file decides what anyone may look at.
 */

type OverviewWidget = NonNullable<
  ReturnType<typeof useQuery<typeof api.communityWidgets.listOverview>>
>[number];

function CardShell({
  title,
  wide,
  children,
}: {
  title?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm",
        wide && "sm:col-span-2",
      )}
    >
      {title && (
        <header className="shrink-0 border-b border-border/40 px-4 py-2.5">
          <h3 className="text-sm font-semibold">{title}</h3>
        </header>
      )}
      {/* A card is the size the board gave it, so what is in it scrolls rather
          than stretching it. */}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

function ChannelsCard({
  widget,
  onOpenChannel,
}: {
  widget: Extract<OverviewWidget, { kind: "channels" }>;
  onOpenChannel: (channelId: Id<"channels">) => void;
}) {
  return (
    <CardShell title={widget.title ?? "Start here"} wide={widget.width === "full"}>
      <div className="space-y-1 p-2">
        {widget.description && (
          <p className="px-2 pb-1 text-xs text-muted-foreground">
            {widget.description}
          </p>
        )}
        {widget.channels.map((channel) => (
          <button
            key={channel.id}
            type="button"
            onClick={() => onOpenChannel(channel.id)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/60"
          >
            {channel.type === "voice" ? (
              <Volume2 className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <Hash className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="shrink-0 text-sm font-medium">{channel.name}</span>
            {channel.topic && (
              <span className="truncate text-xs text-muted-foreground">
                {channel.topic}
              </span>
            )}
          </button>
        ))}
      </div>
    </CardShell>
  );
}

function RecentMessagesCard({
  widget,
  onOpenChannel,
}: {
  widget: Extract<OverviewWidget, { kind: "recentMessages" }>;
  onOpenChannel: (channelId: Id<"channels">) => void;
}) {
  return (
    <CardShell
      title={widget.title ?? `Latest in #${widget.channel.name}`}
      wide={widget.width === "full"}
    >
      <div className="space-y-2 p-3">
        {widget.messages.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing said yet.</p>
        ) : (
          widget.messages.map((message) => (
            <div key={message.id} className="flex gap-2">
              <Avatar size="sm" className="mt-0.5 shrink-0">
                <AvatarImage src={message.authorImageUrl} alt={message.authorName} />
                <AvatarFallback>
                  {message.authorName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="text-xs">
                  <span className="font-semibold">{message.authorName}</span>{" "}
                  <span className="text-muted-foreground">
                    {moment(message.createdAt).fromNow()}
                  </span>
                </p>
                {/* Clamped: this is a preview, and a card that grows with
                    somebody's essay stops being one. */}
                <p className="line-clamp-2 text-sm text-foreground/90">
                  {message.text || "(no text)"}
                </p>
              </div>
            </div>
          ))
        )}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => onOpenChannel(widget.channel.id)}
        >
          <Hash className="size-3.5" />
          Open #{widget.channel.name}
        </Button>
      </div>
    </CardShell>
  );
}

function MarkdownCard({
  widget,
}: {
  widget: Extract<OverviewWidget, { kind: "markdown" }>;
}) {
  return (
    <CardShell title={widget.title} wide={widget.width === "full"}>
      {/* `prose` isn't available here, so the few elements that actually turn
          up in a paragraph of house rules are styled directly. */}
      <div className="space-y-2 p-4 text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_strong]:font-semibold">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{widget.body}</ReactMarkdown>
      </div>
    </CardShell>
  );
}

function RulesCard({
  widget,
}: {
  widget: Extract<OverviewWidget, { kind: "rules" }>;
}) {
  return (
    <CardShell title={widget.title ?? "Rules"} wide={widget.width === "full"}>
      <ol className="space-y-3 p-4">
        {widget.rules.map((rule, index) => (
          <li key={index} className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm font-medium">{rule.title}</p>
              {rule.body && <p className="mt-0.5 text-xs text-muted-foreground">{rule.body}</p>}
            </div>
          </li>
        ))}
      </ol>
    </CardShell>
  );
}

const NOTE_PAPER: Record<string, string> = {
  yellow: "bg-amber-200",
  pink: "bg-pink-200",
  blue: "bg-sky-200",
  green: "bg-lime-200",
  orange: "bg-orange-200",
};

/** A post-it from the owner. Fixed dark ink on pale paper whatever the theme,
 * because it is paper. */
function NoteCard({ widget }: { widget: Extract<OverviewWidget, { kind: "note" }> }) {
  return (
    <div className="h-full p-1">
      <div
        className={cn(
          "relative flex h-full -rotate-1 flex-col rounded-sm px-4 pt-6 pb-3 text-zinc-800 shadow-lg shadow-black/25",
          NOTE_PAPER[widget.color] ?? NOTE_PAPER.yellow,
          // The curled corner.
          "after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:size-6 after:bg-gradient-to-tl after:from-black/20 after:to-transparent after:content-['']",
        )}
      >
        {/* A strip of tape holding it up. */}
        <span
          aria-hidden
          className="absolute -top-2 left-1/2 h-4 w-16 -translate-x-1/2 rotate-2 bg-white/60 shadow-sm"
        />
        {widget.title && <p className="mb-1 text-xs font-bold tracking-wide uppercase">{widget.title}</p>}
        <p className="min-h-0 flex-1 overflow-y-auto text-sm leading-relaxed font-medium whitespace-pre-wrap">
          {widget.body}
        </p>
        <div className="mt-2 flex shrink-0 items-center gap-2">
          <Avatar size="sm" className="size-6 ring-2 ring-black/10">
            <AvatarImage src={widget.author.imageUrl} alt={widget.author.name} />
            <AvatarFallback className="text-[9px]">
              {widget.author.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <p className="min-w-0 truncate text-xs font-semibold">— {widget.author.name}</p>
        </div>
      </div>
    </div>
  );
}

/** Time left, as the four numbers people read a countdown by. */
function CountdownCard({ widget }: { widget: Extract<OverviewWidget, { kind: "countdown" }> }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = widget.target - now;
  const parts = (() => {
    const total = Math.max(0, Math.floor(remaining / 1000));
    return [
      { label: "days", value: Math.floor(total / 86400) },
      { label: "hours", value: Math.floor((total % 86400) / 3600) },
      { label: "min", value: Math.floor((total % 3600) / 60) },
      { label: "sec", value: total % 60 },
    ];
  })();

  return (
    <CardShell title={widget.title ?? "Countdown"} wide={widget.width === "full"}>
      <div className="flex h-full flex-col justify-center gap-3 p-4">
        {remaining > 0 ? (
          <div className="grid grid-cols-4 gap-2 text-center">
            {parts.map((part) => (
              <div key={part.label} className="rounded-lg bg-muted/40 py-2">
                <p className="text-2xl font-semibold tabular-nums">
                  {String(part.value).padStart(2, "0")}
                </p>
                <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
                  {part.label}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-lg font-semibold">
            It started {moment(widget.target).fromNow()}.
          </p>
        )}
        {widget.description && (
          <p className="text-center text-sm text-muted-foreground">{widget.description}</p>
        )}
        <p className="text-center text-xs text-muted-foreground">
          {moment(widget.target).format("dddd D MMMM YYYY, h:mm a")}
        </p>
      </div>
    </CardShell>
  );
}

/** A month at a time, with the days that have something on marked. */
function CalendarCard({ widget }: { widget: Extract<OverviewWidget, { kind: "calendar" }> }) {
  const [offset, setOffset] = useState(0);
  const month = useMemo(() => moment().startOf("month").add(offset, "months"), [offset]);
  const today = moment().format("YYYY-MM-DD");

  const byDate = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const event of widget.events) {
      map.set(event.date, [...(map.get(event.date) ?? []), event.title]);
    }
    return map;
  }, [widget.events]);

  // Weeks start on Monday, with blanks before the 1st to line the days up.
  const lead = (month.isoWeekday() + 6) % 7;
  const days = Array.from({ length: month.daysInMonth() }, (_, i) =>
    month.clone().add(i, "days").format("YYYY-MM-DD"),
  );
  const inMonth = widget.events
    .filter((e) => e.date.startsWith(month.format("YYYY-MM")))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <CardShell title={widget.title ?? "Calendar"} wide={widget.width === "full"}>
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setOffset((n) => n - 1)}
            className="rounded p-1 text-muted-foreground hover:bg-accent"
          >
            <ChevronLeft className="size-4" />
          </button>
          <p className="text-sm font-semibold">{month.format("MMMM YYYY")}</p>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setOffset((n) => n + 1)}
            className="rounded p-1 text-muted-foreground hover:bg-accent"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-muted-foreground">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <span key={i}>{d}</span>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`lead${i}`} />
          ))}
          {days.map((date) => {
            const events = byDate.get(date);
            return (
              <span
                key={date}
                title={events?.join("\n")}
                className={cn(
                  "relative flex aspect-square items-center justify-center rounded-md text-xs",
                  date === today && "bg-primary text-primary-foreground",
                  events && date !== today && "bg-primary/15 font-semibold text-foreground",
                )}
              >
                {Number(date.slice(8))}
                {events && (
                  <span
                    aria-hidden
                    className="absolute bottom-0.5 size-1 rounded-full bg-primary"
                  />
                )}
              </span>
            );
          })}
        </div>
        <ul className="space-y-1">
          {inMonth.slice(0, 5).map((event, index) => (
            <li key={index} className="flex gap-2 text-xs">
              <span className="w-12 shrink-0 text-muted-foreground tabular-nums">
                {moment(event.date).format("D MMM")}
              </span>
              <span className="truncate">{event.title}</span>
            </li>
          ))}
          {inMonth.length === 0 && (
            <li className="text-xs text-muted-foreground">Nothing on this month.</li>
          )}
        </ul>
      </div>
    </CardShell>
  );
}

/** A question members vote on. Each answer is a bar that fills as it gains
 * votes; pressing yours again takes the vote back. */
function PollCard({ widget }: { widget: Extract<OverviewWidget, { kind: "poll" }> }) {
  const vote = useMutation(api.communityWidgets.votePoll);
  const [error, setError] = useState<string | null>(null);
  const closed = widget.closesAt !== undefined && Date.now() >= widget.closesAt;

  const cast = async (index: number) => {
    setError(null);
    try {
      await vote({
        widgetId: widget.id,
        optionIndex: widget.myVote === index ? null : index,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't record that vote.");
    }
  };

  return (
    <CardShell title={widget.title ?? "Poll"} wide={widget.width === "full"}>
      <div className="space-y-2 p-3">
        <p className="text-sm font-semibold">{widget.question}</p>
        {widget.options.map((option, index) => {
          const share = widget.total > 0 ? (option.count / widget.total) * 100 : 0;
          const mine = widget.myVote === index;
          return (
            <button
              key={index}
              type="button"
              disabled={closed}
              onClick={() => void cast(index)}
              className={cn(
                "relative flex w-full items-center gap-2 overflow-hidden rounded-md border px-3 py-1.5 text-left text-sm transition-colors enabled:hover:border-primary/60",
                mine ? "border-primary" : "border-border/60",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-0 left-0 transition-[width] duration-500",
                  mine ? "bg-primary/25" : "bg-muted/60",
                )}
                style={{ width: `${share}%` }}
              />
              <span className="relative min-w-0 flex-1 truncate">{option.label}</span>
              {mine && <Check className="relative size-3.5 shrink-0 text-primary" />}
              <span className="relative shrink-0 text-xs text-muted-foreground tabular-nums">
                {Math.round(share)}%
              </span>
            </button>
          );
        })}
        <p className="text-xs text-muted-foreground">
          {widget.total} vote{widget.total === 1 ? "" : "s"}
          {closed
            ? " · closed"
            : widget.closesAt !== undefined
              ? ` · closes ${moment(widget.closesAt).fromNow()}`
              : ""}
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </CardShell>
  );
}

function BannerCard({
  widget,
}: {
  widget: Extract<OverviewWidget, { kind: "banner" }>;
}) {
  return (
    <section
      className={cn(
        "relative h-full overflow-hidden rounded-xl border border-border/50",
        widget.width === "full" && "sm:col-span-2",
      )}
    >
      {widget.imageUrl && (
        <>
          <CachedBackground
            url={widget.imageUrl}
            aria-hidden
            className="absolute inset-0 bg-cover bg-center"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/60 to-background/30"
          />
        </>
      )}
      <div className={cn("relative p-5", !widget.imageUrl && "bg-card/50")}>
        {widget.heading && (
          <h3 className="text-lg font-semibold">{widget.heading}</h3>
        )}
        {widget.subheading && (
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            {widget.subheading}
          </p>
        )}
        {widget.linkUrl && (
          <a
            href={widget.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
          >
            {widget.linkLabel || "Open"}
            <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </section>
  );
}

export function ServerOverview({
  communityId,
  onOpenChannel,
}: {
  communityId: Id<"communities">;
  /** Clicking a channel on a card should go there. */
  onOpenChannel: (channelId: Id<"channels">) => void;
}) {
  const widgets = useQuery(api.communityWidgets.listOverview, { communityId });
  const canEdit = useQuery(api.communityWidgets.canEditOverview, { communityId });
  const community = useQuery(api.communities.get, { communityId });
  const [editing, setEditing] = useState(false);

  const empty = widgets !== undefined && widgets.length === 0;

  // Where each card sits. Cards a reader can't see have already been dropped,
  // so the rest close up over the gaps they leave.
  const cells = useMemo(
    () =>
      new Map(
        (widgets ? resolve(fillLayouts(widgets, (w) => w.kind)) : []).map((cell) => [cell.id, cell]),
      ),
    [widgets],
  );

  // Arranging the page happens on the page: the pinboard takes the place of the
  // cards in the same space, and Done puts them back. One leaves before the
  // other arrives, so the page is never both at once.
  return (
    <AnimatePresence mode="wait" initial={false}>
      {editing && canEdit ? (
        <motion.div
          key="edit"
          className="relative flex min-h-0 flex-1 flex-col"
          exit={{ opacity: 1 }}
        >
          <ServerOverviewEditor communityId={communityId} onDone={() => setEditing(false)} />
        </motion.div>
      ) : (
    <motion.div
      key="view"
      className="relative isolate flex min-h-0 flex-1 flex-col"
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.985 }}
      transition={{ type: "spring", stiffness: 420, damping: 36 }}
    >
      <CommunityThemeWash communityId={communityId} />
      {/* The server's own banner behind the page, if it has one — the overview
          is the closest thing a server has to a cover. */}
      {community?.bannerUrl && (
        <CachedBackground
          url={community.bannerUrl}
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center opacity-15 blur-2xl"
        />
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-4xl px-6 py-8">
          <header className="mb-5 flex items-start gap-3">
            <Avatar className="size-12 rounded-xl">
              <AvatarImage
                src={community?.imageUrl}
                alt={community?.name ?? ""}
                className="rounded-xl"
              />
              <AvatarFallback>
                {(community?.name ?? "??").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xl font-semibold">
                {community?.name ?? "Overview"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {empty
                  ? "Pick a channel from the sidebar to get started."
                  : "What's worth reading first."}
              </p>
            </div>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" />
                {empty ? "Set up overview" : "Edit"}
              </Button>
            )}
          </header>

          {widgets === undefined ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-32 animate-pulse rounded-xl border border-border/40 bg-muted/20"
                />
              ))}
            </div>
          ) : empty ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/50 py-16 text-center text-sm text-muted-foreground">
              <LayoutDashboard className="size-6" />
              <p>No overview here yet.</p>
              {canEdit && (
                <p className="text-xs">
                  Add a card or two to point people at the right channels.
                </p>
              )}
            </div>
          ) : (
            <div className="overview-grid">
              {widgets.map((widget) => {
                const cell = cells.get(widget.id);
                const card = (() => {
                switch (widget.kind) {
                  case "channels":
                    return (
                      <ChannelsCard
                        key={widget.id}
                        widget={widget}
                        onOpenChannel={onOpenChannel}
                      />
                    );
                  case "recentMessages":
                    return (
                      <RecentMessagesCard
                        key={widget.id}
                        widget={widget}
                        onOpenChannel={onOpenChannel}
                      />
                    );
                  case "markdown":
                    return <MarkdownCard key={widget.id} widget={widget} />;
                  case "rules":
                    return <RulesCard key={widget.id} widget={widget} />;
                  case "note":
                    return <NoteCard key={widget.id} widget={widget} />;
                  case "countdown":
                    return <CountdownCard key={widget.id} widget={widget} />;
                  case "calendar":
                    return <CalendarCard key={widget.id} widget={widget} />;
                  case "poll":
                    return <PollCard key={widget.id} widget={widget} />;
                  case "banner":
                    return <BannerCard key={widget.id} widget={widget} />;
                }
                })();
                return (
                  <div
                    key={widget.id}
                    className="overview-cell"
                    style={
                      cell
                        ? ({ "--x": cell.x, "--y": cell.y, "--w": cell.w, "--h": cell.h } as React.CSSProperties)
                        : undefined
                    }
                  >
                    {card}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>

    </motion.div>
      )}
    </AnimatePresence>
  );
}

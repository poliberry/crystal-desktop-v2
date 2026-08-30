"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, Hash, LayoutDashboard, Pencil, Volume2 } from "lucide-react";
import moment from "moment";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ServerOverviewEditor } from "@/components/community/server-overview-editor";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
        "overflow-hidden rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm",
        wide && "sm:col-span-2",
      )}
    >
      {title && (
        <header className="border-b border-border/40 px-4 py-2.5">
          <h3 className="text-sm font-semibold">{title}</h3>
        </header>
      )}
      {children}
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

function BannerCard({
  widget,
}: {
  widget: Extract<OverviewWidget, { kind: "banner" }>;
}) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-xl border border-border/50",
        widget.width === "full" && "sm:col-span-2",
      )}
    >
      {widget.imageUrl && (
        <>
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${widget.imageUrl})` }}
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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* The server's own banner behind the page, if it has one — the overview
          is the closest thing a server has to a cover. */}
      {community?.bannerUrl && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-center opacity-15 blur-2xl"
          style={{ backgroundImage: `url(${community.bannerUrl})` }}
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
            <div className="grid gap-3 sm:grid-cols-2">
              {widgets.map((widget) => {
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
                  case "banner":
                    return <BannerCard key={widget.id} widget={widget} />;
                }
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      {canEdit && (
        <ServerOverviewEditor
          communityId={communityId}
          open={editing}
          onOpenChange={setEditing}
        />
      )}
    </div>
  );
}

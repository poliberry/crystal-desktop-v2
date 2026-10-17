"use client";

import { usePaginatedQuery, useQuery, useMutation } from "convex/react";
import { ArrowRight, Bell, CheckCheck, Clock3, Sparkles } from "lucide-react";
import moment from "moment";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useNavigation } from "@/components/home/navigation-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery as useConvexQuery } from "convex/react";

function greeting(name?: string) {
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return `Good ${part}${name ? `, ${name}` : ""}`;
}

/** Home briefing, currently built from the user's own unread notification feed. */
export function MyCrystal({ onOpenFriends }: { onOpenFriends: () => void }) {
  const me = useConvexQuery(api.users.getCurrentUser);
  const unread = useConvexQuery(api.notifications.unreadCount) ?? 0;
  const priority = useConvexQuery(api.notifications.priorityCount) ?? 0;
  const markRead = useMutation(api.notifications.markRead);
  const nav = useNavigation();
  const { results, status, loadMore } = usePaginatedQuery(api.notifications.list, {}, { initialNumItems: 12 });

  const open = (item: (typeof results)[number]) => {
    if (!item.read) void markRead({ notificationId: item.id });
    if (item.conversationId) nav.openConversation(item.conversationId as Id<"conversations">);
    else if (item.communityId && item.channelId) nav.openCommunity(item.communityId as Id<"communities">, item.channelId as Id<"channels">);
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 overflow-y-auto px-5 py-8 md:px-10">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-primary"><Sparkles className="size-4" /> My Crystal</div>
        <h1 className="text-3xl font-semibold tracking-tight">{greeting(me?.name?.split(/\s+/)[0])}</h1>
        <p className="max-w-2xl text-muted-foreground">Here&apos;s what&apos;s waiting for you. Your private briefing is based on Crystal activity and updates available to this account.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-primary/20 bg-primary/[0.035]">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Bell className="size-4 text-primary" /> What you missed</CardTitle><CardDescription>Unread updates since you were away</CardDescription></CardHeader>
          <CardContent><p className="text-3xl font-semibold tabular-nums">{unread}</p><p className="mt-1 text-sm text-muted-foreground">{unread === 1 ? "update to catch up on" : "updates to catch up on"}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="size-4 text-amber-500" /> What to prioritise</CardTitle><CardDescription>Messages and mentions that may need a reply</CardDescription></CardHeader>
          <CardContent><p className="text-3xl font-semibold tabular-nums">{priority}</p><p className="mt-1 text-sm text-muted-foreground">unread conversations, replies or mentions</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div><CardTitle className="text-base">Pick up where you left off</CardTitle><CardDescription>Recent notifications, newest first</CardDescription></div>
          <Button variant="ghost" size="sm" onClick={onOpenFriends}>Friends <ArrowRight className="ml-1 size-4" /></Button>
        </CardHeader>
        <CardContent className="space-y-1">
          {results.length === 0 && status !== "LoadingFirstPage" ? (
            <div className="rounded-lg border border-dashed p-6 text-center"><CheckCheck className="mx-auto mb-2 size-5 text-muted-foreground" /><p className="text-sm font-medium">You&apos;re all caught up</p><p className="mt-1 text-sm text-muted-foreground">New messages and mentions will show up here.</p></div>
          ) : results.map((item) => (
            <button key={item.id} type="button" onClick={() => open(item)} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/60">
              <span className={`size-2 shrink-0 rounded-full ${item.read ? "bg-transparent" : "bg-primary"}`} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.actor?.name ? `${item.actor.name} · ` : ""}{item.title}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.body ?? "Open to see the update"}</span></span>
              <span className="shrink-0 text-xs text-muted-foreground">{moment(item.createdAt).fromNow()}</span>
            </button>
          ))}
          {status === "CanLoadMore" && <Button variant="outline" className="mt-2 w-full" onClick={() => loadMore(12)}>Show older updates</Button>}
        </CardContent>
      </Card>
      <p className="px-1 text-xs text-muted-foreground">Crystal activity may include encrypted messages. This page shows only the notification details available on this device; AI summaries will be clearly marked and processed locally when enabled.</p>
    </div>
  );
}

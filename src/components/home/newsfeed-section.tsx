"use client";

import { useQuery } from "convex/react";
import { ArrowRight, FileText } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MessageContent } from "@/components/home/message-content";
import { useNavigation } from "@/components/home/navigation-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { useLocale } from "@/hooks/use-locale";
import { formatRelative } from "@/lib/relative-time";

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

/**
 * Home's newsfeed: the newest posts from every announcements channel the person follows into it,
 * newest first. Follow one from the channel's header or its right-click menu.
 */
export function NewsfeedSection() {
  useLocale();
  const nav = useNavigation();
  const items = useQuery(api.announcements.newsfeed);

  if (items === undefined) {
    return <div className="h-24 animate-pulse rounded-xl bg-accent/30" />;
  }
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        Follow an announcements channel and its posts show up here. Right-click one in a community’s sidebar, or use
        Follow in its header.
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="max-h-[32rem] space-y-1 overflow-y-auto p-3">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => nav.openCommunity(item.communityId as Id<"communities">, item.channelId as Id<"channels">)}
            className="group block w-full rounded-xl p-3 text-left transition-colors hover:bg-accent/60"
          >
            <div className="flex items-center gap-2.5">
              <Avatar className="size-8 rounded-lg">
                <AvatarImage src={item.communityImageUrl ?? undefined} alt="" />
                <AvatarFallback className="rounded-lg">{initials(item.communityName)}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="font-semibold">{item.communityName}</span>
                <span className="text-muted-foreground"> · #{item.channelName}</span>
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelative(item.createdAt)}</span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            <div className="mt-2 pl-[2.625rem]">
              {item.author && <p className="mb-0.5 text-xs text-muted-foreground">{item.author.name}</p>}
              {item.text && <MessageContent text={item.text} />}
              {item.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.attachments.map((file) =>
                    file.url && file.fileType.startsWith("image/") ? (
                      <img key={file.id} src={file.url} alt={file.fileName} className="max-h-40 rounded-lg object-cover" loading="lazy" />
                    ) : (
                      <span key={file.id} className="flex items-center gap-1 rounded-md bg-accent/60 px-2 py-1 text-xs">
                        <FileText className="size-3.5" />
                        {file.fileName}
                      </span>
                    ),
                  )}
                </div>
              )}
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

"use client";

import { useAction, useQuery } from "convex/react";
import { BadgeCheck, ExternalLink, Loader2, Play, Radio, Rss } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, errorText, SurfaceFrame } from "@/components/community/surfaces/surface-frame";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PLATFORM_META } from "../../../../convex/lib/communityKinds";
import { cn } from "@/lib/utils";

const duration = (s?: number) => {
  if (!s) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

const ago = (ms: number) => {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(ms).toLocaleDateString();
};

const compact = (n?: number) => (n === undefined ? null : Intl.NumberFormat(undefined, { notation: "compact" }).format(n));

const KIND_LABEL = { live: "Live", vod: "Stream", upload: "Video", short: "Short" } as const;

/** Recent streams, VODs and uploads from the channel the community is centred on. */
export function FeedView({ communityId, name, topic }: { communityId: Id<"communities">; name: string; topic?: string }) {
  const feed = useQuery(api.creatorCommunities.feed, { communityId });
  const overview = useQuery(api.creatorCommunities.overview, { communityId });
  const verify = useAction(api.creatorCommunities.verifyMembership);
  const [verifying, setVerifying] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const showVerify = overview && !overview.canManage && overview.tiers.length > 0;

  return (
    <SurfaceFrame
      communityId={communityId}
      icon={Rss}
      name={name}
      topic={topic}
      actions={
        showVerify ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={verifying}
            onClick={async () => {
              setVerifying(true);
              setNote(null);
              try {
                const r = await verify({ communityId });
                setNote(r.member ? `You're a ${r.tierName ?? "member"} — your role is updated.` : (r.reason ?? "The platform doesn't list you as a member."));
              } catch (e) {
                setNote(errorText(e));
              } finally {
                setVerifying(false);
              }
            }}
          >
            {verifying ? <Loader2 className="animate-spin" /> : <BadgeCheck />} Verify my tier
          </Button>
        ) : null
      }
    >
      {feed === undefined ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : !feed.linked ? (
        <EmptyState
          icon={Rss}
          title="No channel linked yet"
          body={overview?.canManage ? "Connect your channel in Settings → Creator and its streams and videos will show up here." : "The creator hasn't linked their channel yet."}
        />
      ) : (
        <div className="mx-auto max-w-5xl space-y-4 p-4">
          {note && <p className="rounded-lg border border-foreground/10 px-3 py-2 text-sm">{note}</p>}
          {feed.live && (
            <a
              href={feed.live.url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-2xl border border-red-500/40 bg-gradient-to-r from-red-500/15 to-transparent p-4"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
                <Radio className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold tracking-wide text-red-500 uppercase">Live now</span>
                <span className="block truncate text-sm font-semibold">{feed.live.title}</span>
              </span>
              <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
            </a>
          )}

          {feed.items.length === 0 ? (
            <EmptyState icon={Rss} title="Nothing yet" body="Streams and videos appear here a few minutes after they're posted." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {feed.items.map((item) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group overflow-hidden rounded-xl border border-foreground/10 bg-gradient-to-b from-foreground/[0.05] to-transparent transition-colors hover:border-foreground/25"
                >
                  <div className={cn("relative bg-foreground/10", item.kind === "short" ? "aspect-[9/12]" : "aspect-video")}>
                    {item.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-muted-foreground">
                        <Play className="size-8" />
                      </div>
                    )}
                    {duration(item.durationSeconds) && (
                      <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
                        {duration(item.durationSeconds)}
                      </span>
                    )}
                    <Badge variant="secondary" className={cn("absolute top-2 left-2 bg-black/60 text-white", item.kind === "live" && "bg-red-500")}>
                      {KIND_LABEL[item.kind]}
                    </Badge>
                  </div>
                  <div className="space-y-0.5 p-3">
                    <p className="line-clamp-2 text-sm font-semibold">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {PLATFORM_META[item.provider].label} · {ago(item.publishedAt)}
                      {compact(item.views) && ` · ${compact(item.views)} views`}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </SurfaceFrame>
  );
}

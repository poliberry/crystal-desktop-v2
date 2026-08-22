"use client";

import { useQuery } from "convex/react";
import { Gamepad2, Sparkles } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  MemberProfileCard,
  type MemberProfileMember,
} from "@/components/community/member-profile-card";
import { RichPresenceCards } from "@/components/rich-presence-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUserActivities } from "@/hooks/use-rich-presence";

/** "26m ago" / "7h ago" / "3w ago", matching how the reference reads. */
function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.round(days / 7)}w ago`;
}

/** Total play time, only once it's worth showing. */
function playtime(totalMs: number): string | null {
  const minutes = Math.round(totalMs / 60000);
  if (minutes < 1) return null;
  if (minutes < 60) return `${minutes} min played`;
  const hours = totalMs / 3600000;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hrs played`;
}

/** One row of the recent-games list. */
function RecentGameRow({
  game,
}: {
  game: { id: string; name: string; imageUrl?: string; lastPlayedAt: number; totalMs: number };
}) {
  const played = playtime(game.totalMs);
  return (
    <div className="flex items-center gap-3 rounded-md border border-border/40 bg-muted/30 p-2">
      <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded bg-background/60">
        {game.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={game.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-full object-cover"
          />
        ) : (
          <Gamepad2 className="size-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-semibold">{game.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {timeAgo(game.lastPlayedAt)}
          {played ? ` · ${played}` : ""}
        </p>
      </div>
    </div>
  );
}

/**
 * The expanded, two-column form of a profile card: the card itself on the
 * left at a comfortable width, and everything the user is currently doing on
 * the right.
 *
 * The popover version has room for one or two activities at most, which
 * stopped being enough once a user could be playing something *and*
 * listening to something — this is where the full list lives, and why the
 * card on the left drops its own copy (`showActivity={false}`).
 */
export function ProfileDialog({
  open,
  onOpenChange,
  member,
  communityId,
  communityName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: MemberProfileMember;
  communityId?: Id<"communities">;
  communityName?: string;
}) {
  const activities = useUserActivities(member.userId);
  const recentGames = useQuery(api.presence.recentGames, { userId: member.userId, limit: 10 }) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] gap-0 overflow-hidden border-border/50 p-0 sm:max-w-3xl">
        <DialogTitle className="sr-only">{member.name}</DialogTitle>
        <DialogDescription className="sr-only">
          Profile and current activity for {member.name}
        </DialogDescription>

        {/* The banner bleeds a tint across the whole dialog, the way the
            reference does, rather than stopping at the card's edge. */}
        {member.bannerUrl && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-25 blur-2xl"
            style={{ backgroundImage: `url(${member.bannerUrl})` }}
          />
        )}

        <div className="relative grid max-h-[86vh] grid-cols-1 sm:grid-cols-[360px_1fr]">
          <div className="min-h-0 p-3">
            <ScrollArea className="max-h-[calc(86vh-1.5rem)]">
              {/* `expandable={false}`: this *is* the expanded view, so the
                  card must not offer to expand again. */}
              <MemberProfileCard
                member={member}
                communityId={communityId}
                communityName={communityName}
                expandable={false}
                expanded
                showActivity={false}
              />
            </ScrollArea>
          </div>

          <div className="flex min-h-0 flex-col bg-background/40 p-4 pt-3">
            <div className="mb-3 border-b border-border/40">
              <span className="inline-block border-b-2 border-primary pb-2 text-sm font-semibold">
                Activity
              </span>
            </div>

            <p className="mb-2 text-xs font-medium text-muted-foreground">Current activity</p>

            <ScrollArea className="min-h-0 flex-1">
              <div className="pr-2">
                {activities.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border/50 py-8 text-center text-sm text-muted-foreground">
                    <Sparkles className="size-5" />
                    <p>Nothing right now.</p>
                  </div>
                ) : (
                  // The column is the point here, so no deck — list everything.
                  <RichPresenceCards activities={activities} stack={false} />
                )}

                {/* Games only — see convex/lib/gameHistory.ts for why music
                    isn't recorded. */}
                <p className="mt-5 text-xs font-medium text-muted-foreground">Recent activity</p>
                <p className="mb-2 text-[11px] text-muted-foreground/70">
                  Games {member.name} has played in the last 30 days.
                </p>
                {recentGames.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border/50 px-3 py-4 text-center text-xs text-muted-foreground">
                    No games played recently.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {recentGames.map((game) => (
                      <RecentGameRow key={game.id} game={game} />
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

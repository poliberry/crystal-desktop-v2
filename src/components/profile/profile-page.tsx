"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQuery } from "convex/react";
import { Gamepad2, Sparkles, X } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  MemberProfileCard,
  type MemberProfileMember,
} from "@/components/community/member-profile-card";
import { ProfileBoard } from "@/components/profile/profile-board";
import { RichPresenceCards } from "@/components/rich-presence-card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUserActivities } from "@/hooks/use-rich-presence";
import { type FriendStatus } from "@/lib/presence";
import { cn } from "@/lib/utils";

/**
 * A profile, as a page rather than a dialog.
 *
 * It used to be a `Dialog`, which put a hard ceiling on it: the card, the
 * activity list and now a Board of widgets do not fit in a box that has to
 * stay smaller than the window and leave the app visible around its edges. A
 * page has the room, and reads as somewhere you went rather than something
 * that interrupted you.
 *
 * It is a full-bleed layer inside the app shell rather than a route, because
 * this app is a static export — a `/profile/[userId]` route would need every
 * user id known at build time. Nothing about the layout depends on that
 * choice; opening one is still one call, through `useOpenProfile`.
 */

interface ProfileTarget {
  member: MemberProfileMember;
  communityId?: Id<"communities">;
  communityName?: string;
}

const ProfilePageContext = createContext<((target: ProfileTarget) => void) | null>(
  null,
);

/** "26m ago" / "7h ago" / "3w ago". */
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

function RecentGameRow({
  game,
}: {
  game: {
    id: string;
    name: string;
    imageUrl?: string;
    lastPlayedAt: number;
    totalMs: number;
  };
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

type ProfileTab = "board" | "activity";

function ProfilePageBody({
  target,
  onClose,
}: {
  target: ProfileTarget;
  onClose: () => void;
}) {
  const { member, communityId, communityName } = target;
  const [tab, setTab] = useState<ProfileTab>("board");
  const activities = useUserActivities(member.userId);
  const recentGames =
    useQuery(api.presence.recentGames, { userId: member.userId, limit: 10 }) ?? [];

  // Escape closes it, the way the dialog it replaced did. A page without this
  // is a page you can only leave by finding the right button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background mt-9">
      {/* The banner bleeds a tint across the whole page, as it did across the
          dialog — at this size it's what stops a wide layout reading as an
          empty grey sheet. */}
      {member.bannerUrl && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-20 blur-3xl"
          style={{ backgroundImage: `url(${member.bannerUrl})` }}
        />
      )}

      <div
        // The titlebar row stays draggable on the desktop, so a full-screen
        // page doesn't cost the user the ability to move the window.
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        className="relative flex h-11 shrink-0 items-center justify-between px-4 mt-2"
      >
        <span className="text-sm font-medium text-muted-foreground">
          {member.name}
          {communityName ? ` · ${communityName}` : ""}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close profile"
          onClick={onClose}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="relative mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-cols-1 gap-6 px-6 pb-6 lg:grid-cols-[380px_1fr]">
        <div className="min-h-0">
          <ScrollArea className="h-full">
            {/* The card reserves its own room for the frame — see
                MemberProfileCard. */}
            <div className="px-3 pb-6">
              {/* `expandable={false}`: this *is* the expanded view. */}
              <MemberProfileCard
                member={member}
                communityId={communityId}
                communityName={communityName}
                expandable={false}
                expanded
                showActivity={false}
              />
            </div>
          </ScrollArea>
        </div>

        <div className="flex min-h-0 flex-col">
          <div className="mb-3 flex items-center gap-4 border-b border-border/40">
            {(["board", "activity"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={cn(
                  "border-b-2 pb-2 text-sm font-semibold capitalize transition-colors",
                  tab === value
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {value}
              </button>
            ))}
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="pr-3 pb-6">
              {tab === "board" ? (
                <ProfileBoard
                  userId={member.userId}
                  communityId={communityId}
                  name={member.name}
                />
              ) : (
                <>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    Current activity
                  </p>
                  {activities.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border/50 py-8 text-center text-sm text-muted-foreground">
                      <Sparkles className="size-5" />
                      <p>Nothing right now.</p>
                    </div>
                  ) : (
                    <RichPresenceCards activities={activities} stack={false} />
                  )}

                  {/* Games only — see convex/lib/gameHistory.ts for why music
                      isn't recorded. */}
                  <p className="mt-5 text-xs font-medium text-muted-foreground">
                    Recent activity
                  </p>
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
                </>
              )}
            </div>
          </ScrollArea>
        </div>

      </div>
    </div>
  );
}

/**
 * Hosts the one profile page the app can have open at a time.
 *
 * One at a time rather than a stack: a profile is a destination, and a page
 * opened over a page is how you end up unable to say what closing does.
 */
export function ProfilePageProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<ProfileTarget | null>(null);
  const open = useCallback((next: ProfileTarget) => setTarget(next), []);

  return (
    <ProfilePageContext.Provider value={open}>
      {children}
      {target && (
        <ProfilePageBody target={target} onClose={() => setTarget(null)} />
      )}
    </ProfilePageContext.Provider>
  );
}

/** Opens somebody's profile. A no-op outside the provider, which is only the
 * case in shells that have no room for one (the pop-out window). */
export function useOpenProfile(): (target: ProfileTarget) => void {
  const open = useContext(ProfilePageContext);
  return useMemo(() => open ?? (() => {}), [open]);
}

/**
 * A profile page opened from nothing but a user id — for a mention, a
 * notification, a deep link.
 *
 * The card wants an identity to paint on its first frame; when the caller has
 * none, this fetches one first rather than flashing a placeholder name.
 */
export function useOpenProfileById(): (
  userId: Id<"users">,
  communityId?: Id<"communities">,
) => void {
  const open = useOpenProfile();
  return useCallback(
    (userId, communityId) => {
      open({
        member: {
          userId,
          name: "",
          username: "",
          status: "offline" as FriendStatus,
        },
        communityId,
      });
    },
    [open],
  );
}

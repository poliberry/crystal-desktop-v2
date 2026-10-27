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
import { CachedBackground } from "@/components/cached-background";
import { ProfileBoard } from "@/components/profile/profile-board";
import {
  ProfileCssLayer,
  profileCssAttributes,
} from "@/components/profile/profile-css";
import { MutualFriendList, MutualServerList, hasMutuals, useMutuals } from "@/components/profile/profile-mutuals";
import { RichPresenceCards } from "@/components/rich-presence-card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUserActivities } from "@/hooks/use-rich-presence";
import { useTrafficLightsInset } from "@/hooks/use-window-controls";
import { useReservesWindowControls, WINDOW_CONTROLS_HEIGHT, WINDOW_CONTROLS_WIDTH } from "@/components/window-controls-dock";
import { type FriendStatus } from "@/lib/presence";
import { cn } from "@/lib/utils";
import { BotTag } from "@/components/bot-tag";
import { PERMISSION_GROUPS, PERMISSION_LABELS, PERMISSIONS } from "@/lib/permissions";

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
  /** Open on this tab (the card's "3 mutual servers" goes straight to it). */
  tab?: ProfileTab;
  /**
   * How a mutual server is opened. Passed in by whoever opens the page, because the page itself is mounted above the
   * navigation (see `ProfilePageProvider`) and has no way to reach it; where it's absent the servers are listed but
   * not clickable.
   */
  onOpenCommunity?: (id: Id<"communities">) => void;
}

const ProfilePageContext = createContext<((target: ProfileTarget) => void) | null>(
  null,
);

/** Whether a full-page profile is open, for the chrome that should get out of its way. False outside the provider. */
const ProfilePageOpenContext = createContext(false);
export function useProfilePageOpen(): boolean {
  return useContext(ProfilePageOpenContext);
}

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

export type ProfileTab = "board" | "activity" | "servers" | "friends" | "bot-permissions" | "bot-commands";

const TAB_LABEL: Record<ProfileTab, string> = { board: "Board", activity: "Activity", servers: "Mutual servers", friends: "Mutual friends", "bot-permissions": "Permissions", "bot-commands": "Slash commands" };

function ProfilePageBody({
  target,
  onClose,
}: {
  target: ProfileTarget;
  onClose: () => void;
}) {
  const { member, communityId, communityName } = target;
  const [tab, setTab] = useState<ProfileTab>(target.tab ?? "board");
  const trafficLights = useTrafficLightsInset();
  const reservesControls = useReservesWindowControls();
  const openProfile = useOpenProfile();
  const mutuals = useMutuals(member.userId);
  // Only the tabs that have something in them: nothing for yourself, nothing for a stranger you share nothing with.
  const tabs: ProfileTab[] = ["board", "activity"];
  if (hasMutuals(mutuals) && mutuals.communityCount > 0) tabs.push("servers");
  if (hasMutuals(mutuals) && mutuals.friendCount > 0) tabs.push("friends");
  const activities = useUserActivities(member.userId);
  const recentGames =
    useQuery(api.presence.recentGames, { userId: member.userId, limit: 10 }) ?? [];
  /**
   * The owner's own stylesheet.
   *
   * The page wears it as well as the card, because the page *is* their
   * profile — the board, the activity list and the tabs above them are all
   * theirs, and a stylesheet that could only reach the card in the corner
   * would be a strange half-measure. It's still confined to this subtree, so
   * it reaches none of the app around it.
   *
   * The card inside renders the same rules under its own copy of the
   * attribute. Identical declarations at identical specificity, so the
   * duplication costs a few bytes and changes nothing.
   */
  const profile = useQuery(api.users.getProfile, {
    userId: member.userId,
    communityId,
  });
  const profileCss = profile?.profileCss ?? member.profileCss;
  const botInfo = useQuery(api.bots.profileForUser, { userId: member.userId, communityId });
  if (botInfo?.isBot && communityId) tabs.push("bot-permissions", "bot-commands");

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
    <div
      data-slot="profile-page"
      {...profileCssAttributes(profileCss, member.userId)}
      // The whole window, titlebar row included: the app's top bar is hidden while this is open (see `useProfilePageOpen`), so
      // the page's own header takes its place instead of sitting under a second bar with both sidebars cut off behind it.
      className="fixed inset-0 z-50 flex flex-col bg-background"
      style={{
        background: member.borderGradientStart ? `linear-gradient(to bottom, rgba(0,0,0,0.6), rgba(0,0,0,0.6)), linear-gradient(to bottom, ${member.borderGradientStart}, ${member.borderGradientEnd})` : `var(--background)`
      }}
    >
      <ProfileCssLayer css={profileCss} scopeId={member.userId} />
      {/* The banner bleeds a tint across the whole page, as it did across the
          dialog — at this size it's what stops a wide layout reading as an
          empty grey sheet. */}
      {member.bannerUrl && (
        <CachedBackground
          url={member.bannerUrl}
          aria-hidden
          data-slot="profile-page-backdrop"
          className="fade-mask-b pointer-events-none absolute inset-0 bg-cover bg-center h-[40%] opacity-20"
        />
      )}

      <div
        data-slot="profile-page-header"
        // The whole width of the window, like the titlebar it replaces: the title at the left edge and the close button at the
        // right one, rather than both pulled in to the width of the body. The row is as tall as the macOS titlebar, so it is
        // centred on the traffic lights.
        className="relative flex h-12 shrink-0 items-center justify-between gap-4"
        // Draggable on the desktop, so a full-screen page doesn't cost the user the ability to move the window. What it leaves
        // clear is whatever the system draws over this row, which differs by platform:
        //   macOS          the traffic lights at the left (`trafficLights`, 92px, and none in full screen)
        //   Windows/Linux  the minimise / maximise / close dock at the right (`WINDOW_CONTROLS_WIDTH`, 96px)
        // and a plain gutter on every other side, so nothing sits against the window's edge.
        style={{
          WebkitAppRegion: "drag",
          paddingLeft: trafficLights ? trafficLights + 8 : 20,
          paddingRight: reservesControls ? WINDOW_CONTROLS_WIDTH + 8 : 20,
        } as React.CSSProperties}
      >
        <span className="min-w-0 truncate text-sm font-medium text-muted-foreground">
          <span className="flex min-w-0 items-center gap-2">Profile{communityName ? ` · ${communityName}` : ""}{(member.isBot || botInfo?.isBot) && <BotTag />}</span>
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close profile"
          onClick={onClose}
          className="shrink-0"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <X className="size-4" />
        </Button>
        {/* The window's buttons are fixed over this corner (WindowControlsDock). The header is a drag region end to end, and
            on Windows and Linux that swallows clicks, so the corner is cut out of it here (see the spacer in TopNav). */}
        {reservesControls && (
          <div
            aria-hidden
            className="absolute top-0 right-0"
            style={{ width: WINDOW_CONTROLS_WIDTH, height: WINDOW_CONTROLS_HEIGHT, WebkitAppRegion: "no-drag" } as React.CSSProperties}
          />
        )}
      </div>

      <div
        data-slot="profile-page-body"
        // One column on a narrow window (and then the page scrolls); on a wide one the card is a fixed column beside the panel.
        className="relative mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-cols-1 gap-8 overflow-y-auto px-6 pb-6 lg:grid-cols-[minmax(340px,420px)_1fr] lg:overflow-visible"
      >
        <div data-slot="profile-page-card-column" className="min-h-[34rem] min-w-0 lg:min-h-0">
          {/* The card is exactly as tall as its column: no hanging it up under the titlebar and letting it run off the
              bottom. A frame hangs outside the card, so the room it needs is padding here rather than a margin on the
              card (`reserveFrameRoom={false}`). */}
          <div className="h-full px-3 py-4">
            {/* `expandable={false}`: this *is* the expanded view. */}
            <MemberProfileCard
              member={member}
              communityId={communityId}
              communityName={communityName}
              expandable={false}
              expanded
              showActivity={true}
              reserveFrameRoom={false}
              className="h-full min-h-0 shadow-xl ring-1 ring-white/10"
            />
          </div>
        </div>

        <div data-slot="profile-page-panel" className="flex min-h-0 flex-col">
          <div
            data-slot="profile-page-tabs"
            className="mb-3 flex items-center gap-4 border-b border-border/40"
          >
            {tabs.map((value) => (
              <button
                key={value}
                type="button"
                data-slot="profile-page-tab"
                data-state={tab === value ? "active" : "inactive"}
                onClick={() => setTab(value)}
                className={cn(
                  "border-b-2 pb-2 text-sm font-semibold transition-colors",
                  tab === value
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {TAB_LABEL[value]}
                {value === "servers" && hasMutuals(mutuals) && <span className="ml-1.5 text-xs font-medium text-muted-foreground">{mutuals.communityCount}</span>}
                {value === "friends" && hasMutuals(mutuals) && <span className="ml-1.5 text-xs font-medium text-muted-foreground">{mutuals.friendCount}</span>}
              </button>
            ))}
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="pr-3 pb-6">
              {tab === "bot-permissions" ? (
                <section className="space-y-5">
                  <div><h2 className="text-base font-semibold">Server permissions</h2><p className="mt-1 text-sm text-muted-foreground">What this bot can do in {communityName ?? "this server"}.</p></div>
                  {PERMISSION_GROUPS.map((group) => {
                    const granted = group.keys.filter((key) => (botInfo?.permissions ?? 0) & PERMISSIONS[key]);
                    if (!granted.length) return null;
                    return <div key={group.title} className="space-y-2"><h3 className="text-sm font-semibold">{group.title}</h3><div className="flex flex-wrap gap-1.5">{granted.map((key) => <span key={key} className="rounded-md border border-border bg-muted/30 px-2 py-1 text-xs">{PERMISSION_LABELS[key]}</span>)}</div></div>;
                  })}
                  {!botInfo?.permissions && <p className="rounded-md border border-dashed border-border/50 p-4 text-sm text-muted-foreground">No server permissions granted.</p>}
                </section>
              ) : tab === "bot-commands" ? (
                <section className="space-y-3"><div><h2 className="text-base font-semibold">Registered slash commands</h2><p className="mt-1 text-sm text-muted-foreground">Commands this bot has registered in {communityName ?? "this server"}.</p></div>{botInfo?.commands.length ? <div className="space-y-2">{botInfo.commands.map((command) => <div key={command.name} className="rounded-md border border-border/50 bg-muted/20 p-3"><p className="font-mono text-sm font-semibold">/{command.name}</p><p className="mt-1 text-xs text-muted-foreground">{command.description}</p></div>)}</div> : <p className="rounded-md border border-dashed border-border/50 p-4 text-sm text-muted-foreground">No slash commands registered.</p>}</section>
              ) : tab === "board" ? (
                <ProfileBoard
                  userId={member.userId}
                  communityId={communityId}
                  name={member.name}
                />
              ) : tab === "servers" ? (
                <MutualServerList
                  mutuals={mutuals}
                  name={member.name}
                  onOpen={
                    target.onOpenCommunity
                      ? (id) => {
                          onClose();
                          target.onOpenCommunity?.(id);
                        }
                      : undefined
                  }
                />
              ) : tab === "friends" ? (
                <MutualFriendList
                  mutuals={mutuals}
                  name={member.name}
                  // Their profile replaces this one (a profile is a destination, not a stack — see ProfilePageProvider),
                  // and carries the same way to open a server so it can be followed from there too.
                  onOpen={(friend) =>
                    openProfile({
                      member: { userId: friend.id, name: friend.name, username: friend.username, imageUrl: friend.imageUrl, status: "offline" as FriendStatus },
                      onOpenCommunity: target.onOpenCommunity,
                    })
                  }
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
      <ProfilePageOpenContext.Provider value={target !== null}>
        {children}
        {target && (
          <ProfilePageBody target={target} onClose={() => setTarget(null)} />
        )}
      </ProfilePageOpenContext.Provider>
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

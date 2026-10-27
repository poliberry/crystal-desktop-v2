"use client";

import { useQuery } from "convex/react";
import { Users } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * What you and somebody else have in common: the friends you both have and the servers you're both in.
 *
 * Three pieces, because they live in three places. `MutualsStrip` is the one-line summary on the card — a few faces and a
 * count — which is how most people will notice it. The two lists are the full profile page's tabs, where there's room for
 * every name. All three read the one query (see `users.mutuals`), which is empty for your own profile and for a stranger
 * you share nothing with, and in both of those cases nothing is drawn rather than a heading over an empty list.
 */

export type Mutuals = NonNullable<ReturnType<typeof useMutuals>>;

/** The mutuals with `userId`, or undefined while loading or for your own profile. */
export function useMutuals(userId: Id<"users">, skip = false) {
  return useQuery(api.users.mutuals, skip ? "skip" : { userId });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Whether there is anything to show: used to decide if a tab or a strip exists at all. */
export const hasMutuals = (m: Mutuals | undefined): m is Mutuals => !!m && (m.friendCount > 0 || m.communityCount > 0);

/** A row of faces, overlapping, each a little way in from the last. */
function Faces({ items, shape }: { items: { id: string; name: string; imageUrl?: string }[]; shape: "user" | "server" }) {
  const rounded = shape === "user" ? "rounded-md" : "rounded-xl";
  return (
    <div className="flex -space-x-2">
      {items.slice(0, 4).map((item) => (
        <Avatar key={item.id} className={cn("size-6 ring-2 ring-background", rounded)}>
          <AvatarImage src={item.imageUrl} alt="" className={rounded} />
          <AvatarFallback className={cn("text-[9px]", rounded)}>{item.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      ))}
    </div>
  );
}

/**
 * The summary on a profile card. A button when `onOpen` is given (it opens the full profile at the right tab), plain text
 * where that isn't possible.
 */
export function MutualsStrip({ mutuals, onOpen }: { mutuals: Mutuals | undefined; onOpen?: (tab: "servers" | "friends") => void }) {
  if (!hasMutuals(mutuals)) return null;
  const parts: { tab: "servers" | "friends"; text: string; faces: React.ReactNode }[] = [];
  if (mutuals.communityCount > 0) parts.push({ tab: "servers", text: plural(mutuals.communityCount, "mutual server", "mutual servers"), faces: <Faces items={mutuals.communities} shape="server" /> });
  if (mutuals.friendCount > 0) parts.push({ tab: "friends", text: plural(mutuals.friendCount, "mutual friend", "mutual friends"), faces: <Faces items={mutuals.friends.map((f) => ({ id: f.id, name: f.name, imageUrl: f.imageUrl }))} shape="user" /> });
  return (
    <div data-slot="profile-mutuals" className="space-y-1.5 border-t border-border/40 pt-3">
      {parts.map((part) => {
        const body = (
          <>
            {part.faces}
            <span className="truncate text-xs font-medium text-muted-foreground group-hover/mutual:text-foreground">{part.text}</span>
          </>
        );
        return onOpen ? (
          <button key={part.tab} type="button" onClick={() => onOpen(part.tab)} className="group/mutual flex w-full items-center gap-2 rounded-md text-left" title={`See ${part.text}`}>
            {body}
          </button>
        ) : (
          <div key={part.tab} className="flex items-center gap-2">
            {body}
          </div>
        );
      })}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border/50 py-8 text-center text-sm text-muted-foreground">
      <Users className="size-5" />
      <p>{children}</p>
    </div>
  );
}

/** More than are listed, so the count above the list isn't the number of rows. */
function More({ shown, total, noun }: { shown: number; total: number; noun: string }) {
  if (total <= shown) return null;
  return <p className="px-1 pt-1 text-xs text-muted-foreground">…and {total - shown} more {noun}.</p>;
}

/** The servers you're both in. A row opens that server when the page was opened from somewhere that can. */
export function MutualServerList({ mutuals, name, onOpen }: { mutuals: Mutuals | undefined; name: string; onOpen?: (id: Id<"communities">) => void }) {
  if (!mutuals) return null;
  if (mutuals.communityCount === 0) return <Empty>No servers in common with {name}.</Empty>;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{plural(mutuals.communityCount, "server", "servers")} you and {name} are both in</p>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {mutuals.communities.map((c) => {
          const inner = (
            <>
              <Avatar className="size-10 rounded-xl">
                <AvatarImage src={c.imageUrl} alt="" className="rounded-xl" />
                <AvatarFallback className="rounded-xl">{c.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={c.name}>{c.name}</span>
            </>
          );
          return (
            <li key={c.id}>
              {onOpen ? (
                <button type="button" onClick={() => onOpen(c.id)} className="flex w-full items-center gap-3 rounded-md border border-border/40 bg-muted/30 p-2 text-left transition-colors hover:bg-muted/60">
                  {inner}
                </button>
              ) : (
                <div className="flex items-center gap-3 rounded-md border border-border/40 bg-muted/30 p-2">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
      <More shown={mutuals.communities.length} total={mutuals.communityCount} noun="servers" />
    </div>
  );
}

/** The friends you both have. A row opens their profile. */
export function MutualFriendList({ mutuals, name, onOpen }: { mutuals: Mutuals | undefined; name: string; onOpen?: (friend: Mutuals["friends"][number]) => void }) {
  if (!mutuals) return null;
  if (mutuals.friendCount === 0) return <Empty>No friends in common with {name}.</Empty>;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{plural(mutuals.friendCount, "friend", "friends")} you and {name} both have</p>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {mutuals.friends.map((f) => {
          const inner = (
            <>
              <Avatar className="size-10 rounded-md">
                <AvatarImage src={f.imageUrl} alt="" className="rounded-md" />
                <AvatarFallback className="rounded-md">{f.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-semibold">{f.name}</span>
                <span className="block truncate text-xs text-muted-foreground">@{f.username}</span>
              </span>
            </>
          );
          return (
            <li key={f.id}>
              {onOpen ? (
                <button type="button" onClick={() => onOpen(f)} className="flex w-full items-center gap-3 rounded-md border border-border/40 bg-muted/30 p-2 text-left transition-colors hover:bg-muted/60">
                  {inner}
                </button>
              ) : (
                <div className="flex items-center gap-3 rounded-md border border-border/40 bg-muted/30 p-2">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
      <More shown={mutuals.friends.length} total={mutuals.friendCount} noun="friends" />
    </div>
  );
}

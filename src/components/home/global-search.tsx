"use client";

import { useQuery } from "convex/react";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../../convex/_generated/api";
import { GroupAvatar } from "@/components/home/group-avatar";
import { useNavigation } from "@/components/home/navigation-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useSmoothScrollRef } from "@/hooks/use-smooth-scroll";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Quick-switcher dialog: search your DMs/group chats and communities by
 * name, jump straight to one. Opened from a search icon in the top bar. */
export function GlobalSearch() {
  const smoothRef = useSmoothScrollRef<HTMLDivElement>();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const conversations = useQuery(api.conversations.listMine) ?? [];
  const communities = useQuery(api.communities.listMine) ?? [];
  const nav = useNavigation();

  const needle = query.trim().toLowerCase();

  const matchedConversations = useMemo(() => {
    if (!needle) return [];
    return conversations
      .filter((c: any) => {
        const title =
          c.type === "group" ? c.name || c.members.map((m: any) => m.name).join(", ") : (c.members[0]?.name ?? "");
        return title.toLowerCase().includes(needle);
      })
      .slice(0, 5);
  }, [conversations, needle]);

  const matchedCommunities = useMemo(() => {
    if (!needle) return [];
    return communities.filter((c: any) => c.name.toLowerCase().includes(needle)).slice(0, 5);
  }, [communities, needle]);

  const hasResults = matchedConversations.length > 0 || matchedCommunities.length > 0;

  const select = (action: () => void) => {
    action();
    setQuery("");
    setOpen(false);
  };

  const setOpenState = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setOpen(true)}
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              className="flex size-6 pointer-events-auto shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-opacity hover:bg-accent/60 hover:opacity-100"
              aria-label="Search"
            >
              <Search className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Search</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={open} onOpenChange={setOpenState}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md" showCloseButton={false}>
          <DialogTitle className="sr-only">Search</DialogTitle>
          <div className="relative border-b">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search anything..."
              className="h-11 rounded-none border-0 pl-9 shadow-none focus-visible:ring-0"
            />
          </div>

          <div ref={smoothRef} className="max-h-80 overflow-y-auto p-1">
            {needle.length === 0 && (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                Search direct messages and communities.
              </p>
            )}
            {needle.length > 0 && !hasResults && (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">No results.</p>
            )}

            {matchedConversations.length > 0 && (
              <div className="mb-1">
                <p className="px-2 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Direct messages
                </p>
                {matchedConversations.map((c: any) => {
                  const isGroup = c.type === "group";
                  const title = isGroup
                    ? c.name || c.members.map((m: any) => m.name).join(", ")
                    : (c.members[0]?.name ?? "Unknown");
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => select(() => nav.openConversation(c.id))}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/60"
                    >
                      {isGroup ? (
                        <GroupAvatar size="sm" imageUrl={c.imageUrl} members={c.members} />
                      ) : (
                        <Avatar size="sm">
                          <AvatarImage src={c.members[0]?.imageUrl} alt={title} />
                          <AvatarFallback>{title.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                      )}
                      <span className="truncate">{title}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {matchedCommunities.length > 0 && (
              <div>
                <p className="px-2 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Communities
                </p>
                {matchedCommunities.map((c: any) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => select(() => nav.openCommunity(c.id))}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/60"
                  >
                    <Avatar size="sm">
                      <AvatarImage src={c.imageUrl} alt={c.name} />
                      <AvatarFallback>{c.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

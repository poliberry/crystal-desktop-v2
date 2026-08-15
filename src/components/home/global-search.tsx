"use client";

import { useQuery } from "convex/react";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../../convex/_generated/api";
import { GroupAvatar } from "@/components/home/group-avatar";
import { useNavigation } from "@/components/home/navigation-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

/** Topbar quick-switcher: search your DMs/group chats and communities by
 * name, jump straight to one. */
export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const conversations = useQuery(api.conversations.listMine) ?? [];
  const communities = useQuery(api.communities.listMine) ?? [];
  const nav = useNavigation();

  const needle = query.trim().toLowerCase();

  const matchedConversations = useMemo(() => {
    if (!needle) return [];
    return conversations
      .filter((c) => {
        const title =
          c.type === "group" ? c.name || c.members.map((m) => m.name).join(", ") : (c.members[0]?.name ?? "");
        return title.toLowerCase().includes(needle);
      })
      .slice(0, 5);
  }, [conversations, needle]);

  const matchedCommunities = useMemo(() => {
    if (!needle) return [];
    return communities.filter((c) => c.name.toLowerCase().includes(needle)).slice(0, 5);
  }, [communities, needle]);

  const hasResults = matchedConversations.length > 0 || matchedCommunities.length > 0;

  const select = (action: () => void) => {
    action();
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover open={open && needle.length > 0 && hasResults} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          className="relative mx-auto w-full max-w-md"
        >
          <Search className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search"
            className="pl-8 h-7 rounded-none"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="center"
        className="w-120 max-h-80 overflow-y-auto rounded-none p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {matchedConversations.length > 0 && (
          <div className="mb-1">
            <p className="px-2 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Direct messages
            </p>
            {matchedConversations.map((c) => {
              const isGroup = c.type === "group";
              const title = isGroup
                ? c.name || c.members.map((m) => m.name).join(", ")
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
            {matchedCommunities.map((c) => (
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
      </PopoverContent>
    </Popover>
  );
}

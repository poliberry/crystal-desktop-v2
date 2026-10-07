"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { Globe2, Search, UserRound } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import { EmptyState, ListRow, Loading, PageHeader, Panel, Person, StatusPill } from "@/components/admin/admin-ui";
import { useOpenEntity } from "@/components/admin/console-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/money";

/** A value that only follows the input once it has stopped changing. */
function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative max-w-md">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9" />
    </div>
  );
}

export function AccountsSection() {
  const open = useOpenEntity();
  const [search, setSearch] = useState("");
  const rows = useQuery(api.operations.users, { search: useDebounced(search) });

  return (
    <div className="space-y-4">
      <PageHeader title="Accounts" description="Find a person, see their history, and act on their account." icon={UserRound} />
      <SearchBox value={search} onChange={setSearch} placeholder="Search by username or display name" />
      <Panel flush>
        {rows === undefined ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState icon={UserRound} title="No one found">Try a different spelling.</EmptyState>
        ) : (
          <div className="divide-y divide-foreground/10">
            {rows.map((u) => (
              <ListRow key={u.id} onOpen={(e) => open({ kind: "user", id: u.id, title: u.name, subtitle: `@${u.username}` }, e)}>
                <Person user={u} className="flex-1" />
                {u.suspended && <StatusPill tone="bad">{u.suspended.until ? `Suspended until ${formatDate(u.suspended.until)}` : "Suspended"}</StatusPill>}
                <span className="hidden w-28 text-right text-xs text-muted-foreground md:block">Joined {formatDate(u.joinedAt)}</span>
              </ListRow>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

export function CommunitiesSection() {
  const open = useOpenEntity();
  const [search, setSearch] = useState("");
  const rows = useQuery(api.operations.communities, { search: useDebounced(search) });

  return (
    <div className="space-y-4">
      <PageHeader title="Communities" description="Ownership, size and platform status." icon={Globe2} />
      <SearchBox value={search} onChange={setSearch} placeholder="Search communities" />
      <Panel flush>
        {rows === undefined ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState icon={Globe2} title="No communities found" />
        ) : (
          <div className="divide-y divide-foreground/10">
            {rows.map((c) => (
              <ListRow key={c.id} onOpen={(e) => open({ kind: "community", id: c.id, title: c.name, subtitle: `${c.memberCount} members` }, e)}>
                <Avatar className="size-8 shrink-0 rounded-lg">
                  <AvatarImage src={c.imageUrl} alt="" />
                  <AvatarFallback className="rounded-lg text-xs">{c.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">Owned by @{c.owner}</p>
                </div>
                {c.status !== "active" && <StatusPill tone={c.status === "archived" ? "bad" : "warn"}>{c.status}</StatusPill>}
                <span className="w-24 text-right text-xs text-muted-foreground tabular-nums">{c.memberCount} members</span>
                <span className="hidden w-28 text-right text-xs text-muted-foreground md:block">{formatDate(c.createdAt)}</span>
              </ListRow>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

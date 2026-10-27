"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useQueries, useQuery } from "convex/react";
import { ArrowRight, Bookmark, Clock3, Home, Plus, Search, Settings, ShoppingBag } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useNavigation } from "@/components/home/navigation-context";
import { useOpenSettings, usePage } from "@/components/pages/page-context";
import { useE2eeSnapshot } from "@/lib/e2ee";
import { getSearchIndex, type SearchHit } from "@/lib/e2ee/search-index";
import { FOCUS_MESSAGE_SEARCH_EVENT, openSavedMessages, searchShortcutLabel } from "@/lib/command-events";
import { getRecentViewsSnapshot, getServerSnapshot, keyOf, subscribeRecentViews } from "@/lib/recent-views";
import { revealMessage } from "@/lib/reveal-message";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onActivate: () => void;
  onClose: () => void;
  autoFocus?: boolean;
  className?: string;
};

type Suggestion = {
  key: string;
  label: string;
  detail: string;
  kind: "message" | "action" | "recent";
  run: () => void;
  hit?: SearchHit;
  Icon: typeof Search;
};

type Conversation = { id: string; name?: string; members: { name: string }[] };
type Community = { id: string; name: string };
type Channel = { id: string; name: string; type: string };

const ACTIONS = [
  { key: "settings", label: "Settings", detail: "Open app settings", terms: "preferences account notifications appearance", Icon: Settings },
  { key: "saved", label: "Saved messages", detail: "Open saved messages and reminders", terms: "bookmarks saved reminders", Icon: Bookmark },
  { key: "home", label: "Friends and home", detail: "Go to your friends list", terms: "friends home direct messages", Icon: Home },
  { key: "community", label: "Create a community", detail: "Start a new community", terms: "server create community", Icon: Plus },
  { key: "marketplace", label: "Marketplace", detail: "Browse the marketplace", terms: "shop store themes", Icon: ShoppingBag },
];

export function SidebarSearch({ value, onChange, onActivate, onClose, autoFocus = false, className = "" }: Props) {
  const nav = useNavigation();
  const { openPage } = usePage();
  const openSettings = useOpenSettings();
  const e2ee = useE2eeSnapshot();
  const recentViews = useSyncExternalStore(subscribeRecentViews, getRecentViewsSnapshot, getServerSnapshot);
  const conversations = useQuery(api.conversations.listMine, {}) as Conversation[] | undefined;
  const communities = useQuery(api.communities.listMine, {}) as Community[] | undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  const query = value.trim();
  const foldedQuery = query.toLocaleLowerCase();
  const index = getSearchIndex();

  const recentChannelViews = useMemo(
    () => recentViews.filter((view) => view.type === "channel").slice(0, 5),
    [recentViews],
  );
  const recentCommunityIds = useMemo(
    () => [...new Set(recentChannelViews.map((view) => view.communityId))],
    [recentChannelViews],
  );
  const channelQueries = useMemo(() => Object.fromEntries(recentCommunityIds.map((communityId) => [
    `community:${communityId}`,
    { query: api.channels.list, args: { communityId: communityId as Id<"communities"> } },
  ])), [recentCommunityIds.join("|")]);
  const channelLists = useQueries(channelQueries);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!autoFocus) return;
    const focus = () => {
      inputRef.current?.focus();
    };
    window.addEventListener(FOCUS_MESSAGE_SEARCH_EVENT, focus);
    return () => window.removeEventListener(FOCUS_MESSAGE_SEARCH_EVENT, focus);
  }, [autoFocus]);

  useEffect(() => {
    if (query.length < 2 || e2ee.status !== "ready") {
      setHits([]);
      return;
    }
    let live = true;
    const update = () => {
      if (live) setHits(index.search(query, { limit: 6 }));
    };
    const unsubscribe = index.subscribe(update);
    const timer = window.setTimeout(() => {
      void index.ensureAllLoaded().then(update).catch(() => update());
    }, 120);
    update();
    return () => {
      live = false;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [index, query, e2ee.status]);

  const runAction = (key: string) => {
    if (key === "settings") openSettings();
    else if (key === "saved") openSavedMessages();
    else if (key === "home") nav.goHome();
    else if (key === "community") openPage({ type: "create-community" });
    else if (key === "marketplace") openPage({ type: "marketplace" });
    onClose();
  };

  const openHit = (hit: SearchHit) => {
    const separator = hit.room.indexOf(":");
    const kind = hit.room.slice(0, separator);
    const target = hit.room.slice(separator + 1);
    if (kind === "dm") nav.openConversation(target as Id<"conversations">);
    else if (hit.communityId) nav.openCommunity(hit.communityId as Id<"communities">, target as Id<"channels">);
    revealMessage(hit.id);
    onClose();
  };

  const messageSuggestions: Suggestion[] = hits.map((hit) => ({
    key: `${hit.room}:${hit.id}`,
    label: hit.authorName || "Unknown sender",
    detail: `${hit.channelName ? `# ${hit.channelName}` : hit.room.startsWith("dm:") ? "Direct message" : "Channel"} · ${hit.text || hit.attachments?.map((file) => file.fileName).join(", ") || "Attachment"}`,
    kind: "message",
    run: () => openHit(hit),
    hit,
    Icon: Search,
  }));

  const actionSuggestions: Suggestion[] = ACTIONS
    .filter((action) => !foldedQuery || `${action.label} ${action.terms}`.toLocaleLowerCase().includes(foldedQuery))
    .map((action) => ({
      key: `action:${action.key}`,
      label: action.label,
      detail: action.detail,
      kind: "action",
      run: () => runAction(action.key),
      Icon: action.Icon,
    }));

  const channelResults = Object.values(channelLists).flatMap((result) => Array.isArray(result) ? result as Channel[] : []);
  const recentSuggestions: Suggestion[] = recentViews.slice(0, 8).flatMap((view) => {
    if (view.type === "dm") {
      const conversation = conversations?.find((item) => item.id === view.conversationId);
      if (!conversation) return [];
      const label = conversation.name || conversation.members.map((member) => member.name).join(", ") || "Direct message";
      if (foldedQuery && !label.toLocaleLowerCase().includes(foldedQuery)) return [];
      return [{ key: `recent:${keyOf(view)}`, label, detail: "Recent conversation", kind: "recent", run: () => { nav.openConversation(view.conversationId as Id<"conversations">); onClose(); }, Icon: Clock3 }];
    }
    const channel = channelResults.find((item) => item.id === view.channelId);
    const community = communities?.find((item) => item.id === view.communityId);
    if (!channel && !community) return [];
    const label = channel ? `# ${channel.name}` : "Recent channel";
    const detail = community?.name ?? "Recent community";
    if (foldedQuery && !`${label} ${detail}`.toLocaleLowerCase().includes(foldedQuery)) return [];
    return [{ key: `recent:${keyOf(view)}`, label, detail, kind: "recent", run: () => { nav.openCommunity(view.communityId as Id<"communities">, view.channelId as Id<"channels">); onClose(); }, Icon: Clock3 }];
  });

  const suggestions = query.length >= 2
    ? [...messageSuggestions.slice(0, 5), ...actionSuggestions.slice(0, 2), ...recentSuggestions.slice(0, 3)].slice(0, 8)
    : [...actionSuggestions.slice(0, 4), ...recentSuggestions.slice(0, 4)];

  useEffect(() => setActive(-1), [query]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!query) return;
    openPage({ type: "search", query });
    onClose();
  };

  return (
    <form className={`relative ${className}`} role="search" onSubmit={submit}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        data-sidebar-message-search
        type="search"
        value={value}
        onFocus={() => { setFocused(true); onActivate(); }}
        onBlur={() => setFocused(false)}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); return; }
          if (event.key === "ArrowDown" && suggestions.length) { event.preventDefault(); setActive((current) => (current + 1) % suggestions.length); }
          if (event.key === "ArrowUp" && suggestions.length) { event.preventDefault(); setActive((current) => current < 0 ? suggestions.length - 1 : (current + suggestions.length - 1) % suggestions.length); }
          if (event.key === "Enter" && active >= 0 && suggestions[active]) { event.preventDefault(); suggestions[active].run(); }
        }}
        placeholder={`Search messages · ${searchShortcutLabel()}`}
        aria-label="Search messages and actions"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={focused && suggestions.length > 0}
        className="h-10 w-full rounded-xl border border-white/10 bg-background/70 pl-9 pr-10 text-base outline-none md:text-sm transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
      />
      <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground max-md:right-0.5 max-md:p-2.5 hover:text-foreground" aria-label="See all search results">
        <ArrowRight className="size-4" />
      </button>
      {focused && suggestions.length > 0 && (
        <div id={listId} role="listbox" aria-label="Search suggestions" className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl">
          {suggestions.map((suggestion, i) => {
            const Icon = suggestion.Icon;
            return (
              <button key={suggestion.key} type="button" role="option" aria-selected={i === active} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(i)} onClick={suggestion.run} className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left ${i === active ? "bg-accent" : "hover:bg-accent/60"}`}>
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{suggestion.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{suggestion.detail}</span>
                </span>
                <span className="shrink-0 pt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{suggestion.kind}</span>
              </button>
            );
          })}
          {query && <button type="submit" className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-primary hover:bg-accent">Search all messages for “{query}”</button>}
        </div>
      )}
    </form>
  );
}

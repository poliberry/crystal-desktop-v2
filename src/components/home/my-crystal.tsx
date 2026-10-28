"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import moment from "moment";
import { useCallback, useMemo, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, AtSign, Eye, EyeOff, Gamepad2, Hash, MessageCircle, MessageSquare, Newspaper, Play, Settings2, Star, Users } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AddFriendDialog } from "@/components/home/add-friend-dialog";
import { FriendRow } from "@/components/home/friend-row";
import { useNavigation } from "@/components/home/navigation-context";
import { NewsfeedSection } from "@/components/home/newsfeed-section";
import { useUiPreferences, type HomeSectionId } from "@/components/ui-preferences-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCachedQuery } from "@/hooks/use-cached-query";
import type { RichPresenceActivity } from "@/types/desktop-api";
import { MessagePreview } from "@/components/message-preview";
import { encryptedSource, NEW_ENCRYPTED_MESSAGE, useEncryptedPreview } from "@/lib/e2ee/preview";

function initials(name: string) { return name.slice(0, 2).toUpperCase(); }
function greeting(name?: string) { const hour = new Date().getHours(); return `Good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}${name ? `, ${name}` : ""}`; }
function Empty({ children }: { children: React.ReactNode }) { return <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{children}</div>; }
function Section({ title, icon: Icon, action, children }: { title: string; icon: typeof MessageCircle; action?: React.ReactNode; children: React.ReactNode }) { return <section className="flex h-full flex-col gap-3"><div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight"><Icon className="size-4 text-primary" />{title}</h2>{action}</div><div className="min-h-0 flex-1 [&>div]:h-full">{children}</div></section>; }

function PreviewText({ preview }: { preview: any }) {
  const encrypted = useEncryptedPreview(
    preview.enc
      ? encryptedSource("channel", preview.channelId, preview.authorId, preview.enc)
      : null,
  );
  const text = encrypted.state === "decrypted"
    ? encrypted.text
    : encrypted.state === "none"
      ? preview.text
      : NEW_ENCRYPTED_MESSAGE;
  return text ? <MessagePreview text={text} /> : <span>{preview.attachmentName ? `📎 ${preview.attachmentName}` : "New activity"}</span>;
}

const HOME_SECTION_LABELS: Record<HomeSectionId, string> = {
  "jump-back-in": "Let’s jump back in",
  missed: "What’s been missed",
  newsfeed: "Newsfeed",
  important: "What’s important",
  online: "Who’s online",
  games: "Game sesh",
  dms: "Direct messages",
  friends: "Your friends",
};

export function MyCrystal({ onOpenFriends }: { onOpenFriends: () => void }) {
  const { homeSections, setHomeSections } = useUiPreferences();
  const visible = useCallback(
    (id: HomeSectionId) => homeSections.find((section) => section.id === id)?.visible ?? true,
    [homeSections],
  );
  const loadCommunities = visible("jump-back-in");
  const loadConversations = visible("dms") || visible("friends") || visible("games");
  const loadFriends = visible("online") || visible("friends");
  const me = useQuery(api.users.getCurrentUser);
  const conversations = useCachedQuery(api.conversations.listMine, loadConversations ? {} : "skip", loadConversations ? "conversations.listMine" : null) ?? [];
  const communities = useCachedQuery(api.communities.listMine, loadCommunities ? {} : "skip", loadCommunities ? "communities.listMine" : null) ?? [];
  const previews = useQuery(api.sidebar.communityPreviews, loadCommunities ? {} : "skip") ?? [];
  const priority = useQuery(api.priority.list, visible("important") ? {} : "skip") ?? [];
  const friends = useCachedQuery(api.friends.listFriends, loadFriends ? {} : "skip", loadFriends ? "friends.listFriends" : null) ?? [];
  const requests = useCachedQuery(api.friends.listIncomingRequests, visible("friends") ? {} : "skip", visible("friends") ? "friends.listIncomingRequests" : null) ?? [];
  const activeNow = useQuery(api.presence.activeNow, visible("games") ? {} : "skip");
  const { results: notifications } = usePaginatedQuery(
    api.notifications.list,
    visible("missed") ? {} : "skip",
    { initialNumItems: 18 },
  );
  const nav = useNavigation();
  const [customizing, setCustomizing] = useState(false);

  const recent = useMemo(() => [...previews].filter((entry) => entry.preview).sort((a, b) => (b.preview?.createdAt ?? 0) - (a.preview?.createdAt ?? 0)).slice(0, 6), [previews]);
  const mentions = useMemo(() => notifications.filter((item) => item.type === "channel_mention").slice(0, 6), [notifications]);
  const important = useMemo(() => (priority as any[]).slice(0, 6), [priority]);
  const online = useMemo(() => friends.filter((friend: any) => friend.status !== "offline").slice(0, 8), [friends]);
  const gameFriends = useMemo(() => (activeNow?.activities ?? []).filter((entry: any) => (entry.activities as RichPresenceActivity[]).some((activity) => activity.type === "playing")), [activeNow]);
  const dms = useMemo(() => [...conversations].sort((a: any, b: any) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)).slice(0, 6), [conversations]);
  const openFriend = useCallback((id: Id<"users">) => { const dm = conversations.find((item: any) => item.members.some((member: any) => member.id === id)); if (dm) nav.openConversation(dm.id); }, [conversations, nav]);
  const move = (id: HomeSectionId, direction: -1 | 1) => { const index = homeSections.findIndex((section) => section.id === id); const next = index + direction; if (index < 0 || next < 0 || next >= homeSections.length) return; const copy = [...homeSections]; [copy[index], copy[next]] = [copy[next], copy[index]]; setHomeSections(copy); };
  const toggle = (id: HomeSectionId) => setHomeSections(homeSections.map((section) => section.id === id ? { ...section, visible: !section.visible } : section));
  const labels = HOME_SECTION_LABELS;

  const sections: Record<HomeSectionId, React.ReactNode> = {
    "jump-back-in": <Section title="Let’s jump back in" icon={MessageCircle}>{recent.length === 0 ? <Empty>No recent server activity yet.</Empty> : <div className="flex snap-x gap-3 overflow-x-auto pb-1">{recent.map((entry) => { const community = communities.find((item: any) => item.id === entry.communityId); return <button key={entry.communityId} type="button" onClick={() => entry.preview && nav.openCommunity(entry.communityId as Id<"communities">, entry.preview.channelId as Id<"channels">)} className="group w-64 shrink-0 snap-start rounded-2xl border border-border/70 bg-card/80 p-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/40"><div className="flex items-center gap-2.5"><Avatar className="size-9 rounded-xl"><AvatarImage src={community?.imageUrl} alt="" /><AvatarFallback className="rounded-xl">{initials(community?.name ?? "Server")}</AvatarFallback></Avatar><span className="min-w-0 flex-1 truncate text-sm font-semibold">{community?.name ?? "Server"}</span><ArrowRight className="size-4 text-muted-foreground" /></div><p className="mt-4 truncate text-xs text-muted-foreground"><Hash className="mr-1 inline size-3" />{entry.preview?.channelName}</p><p className="mt-1 line-clamp-2 min-h-8 text-sm">{entry.preview && <PreviewText preview={entry.preview} />}</p></button>; })}</div>}</Section>,
    missed: <Section title="What’s been missed" icon={AtSign}><Card><CardContent className="space-y-1 p-3">{mentions.length === 0 ? <Empty>You’re all caught up on mentions.</Empty> : mentions.map((item) => <button key={item.id} type="button" onClick={() => item.communityId && item.channelId && nav.openCommunity(item.communityId as Id<"communities">, item.channelId as Id<"channels">)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-accent/60"><Avatar size="sm"><AvatarImage src={item.actor?.imageUrl ?? undefined} alt="" /><AvatarFallback>{initials(item.actor?.name ?? "?")}</AvatarFallback></Avatar><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.actor?.name ?? "Someone"} mentioned you in {item.communityName ?? "a server"}</span><span className="block truncate text-xs text-muted-foreground">{item.message ? <PreviewText preview={{ ...item.message, channelId: item.channelId, text: item.body }} /> : item.body ?? "Open to view the mention"}</span></span><span className="text-[11px] text-muted-foreground">{moment(item.createdAt).fromNow()}</span></button>)}</CardContent></Card></Section>,
    newsfeed: <Section title="Newsfeed" icon={Newspaper}><NewsfeedSection /></Section>,
    important: <Section title="What’s important" icon={Star}><Card><CardContent className="space-y-1 p-3">{important.length === 0 ? <Empty>Star a conversation or channel to keep it close.</Empty> : important.map((item) => <button key={item.conversationId ?? item.channelId} type="button" onClick={() => item.kind === "conversation" ? nav.openConversation(item.conversationId) : nav.openCommunity(item.communityId, item.channelId)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-accent/60"><Star className="size-4 shrink-0 text-amber-400" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.kind === "conversation" ? "Direct message" : `${item.communityName} · #${item.channelName}`}</span><span className="block truncate text-xs text-muted-foreground">{item.last?.text || "Open this priority item"}</span></span></button>)}</CardContent></Card></Section>,
    online: <Section title="Who’s online" icon={Users} action={<Button variant="ghost" size="sm" onClick={onOpenFriends}>All friends <ArrowRight className="ml-1 size-3.5" /></Button>}><Card><CardContent className="grid gap-1 p-3 sm:grid-cols-2">{online.length === 0 ? <div className="sm:col-span-2"><Empty>No friends are online right now.</Empty></div> : online.map((friend: any) => <FriendRow key={friend.id} name={friend.name} username={friend.username} imageUrl={friend.imageUrl} status={friend.status} customStatus={friend.customStatus} nameplateUrl={friend.nameplateUrl} avatarDecoration={friend.avatarDecoration} actions={<Button variant="ghost" size="icon" className="size-8" onClick={() => openFriend(friend.id)}><MessageSquare className="size-4" /></Button>} />)}</CardContent></Card></Section>,
    games: <Section title="Jump into a game sesh" icon={Gamepad2}><Card><CardContent className="space-y-1 p-3">{gameFriends.length === 0 ? <Empty>No friends are in a game right now.</Empty> : gameFriends.slice(0, 6).map((entry: any) => { const game = (entry.activities as RichPresenceActivity[]).find((activity) => activity.type === "playing"); return <button key={entry.userId} type="button" onClick={() => openFriend(entry.userId)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-accent/60"><Avatar size="sm"><AvatarImage src={entry.imageUrl} alt="" /><AvatarFallback>{initials(entry.name)}</AvatarFallback></Avatar><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{entry.name}</span><span className="block truncate text-xs text-muted-foreground">Playing {game?.name}</span></span><Play className="size-4 text-emerald-500" /></button>; })}</CardContent></Card></Section>,
    dms: <Section title="Direct messages" icon={MessageSquare}><Card><CardContent className="space-y-1 p-3">{dms.length === 0 ? <Empty>No direct messages yet.</Empty> : dms.map((conversation: any) => <button key={conversation.id} type="button" onClick={() => nav.openConversation(conversation.id)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-accent/60"><Avatar size="sm"><AvatarImage src={conversation.members[0]?.imageUrl} alt="" /><AvatarFallback>{initials(conversation.name || conversation.members[0]?.name || "DM")}</AvatarFallback></Avatar><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{conversation.name || conversation.members[0]?.name || "Direct message"}</span><span className="block truncate text-xs text-muted-foreground">{conversation.lastMessageText || "No messages yet"}</span></span>{conversation.unread && <span className="size-2 rounded-full bg-primary" />}</button>)}</CardContent></Card></Section>,
    friends: <Section title="Your friends" icon={Users} action={<div className="flex items-center gap-2"><AddFriendDialog /><Button variant="ghost" size="sm" onClick={onOpenFriends}>Manage <ArrowRight className="ml-1 size-3.5" /></Button></div>}><Card><CardContent className="space-y-1 p-3">{friends.slice(0, 6).map((friend: any) => <FriendRow key={friend.id} name={friend.name} username={friend.username} imageUrl={friend.imageUrl} status={friend.status} customStatus={friend.customStatus} actions={null} />)}{friends.length === 0 && <Empty>Add friends to see them here.</Empty>}{requests.length > 0 && <p className="px-2 pt-2 text-xs font-medium text-primary">{requests.length} friend request{requests.length === 1 ? "" : "s"} waiting</p>}</CardContent></Card></Section>,
  };

  return <div className="settings-surface flex h-full w-full flex-col gap-8 overflow-y-auto px-5 py-8 md:px-10"><header className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Home</p><h1 className="text-3xl font-semibold tracking-tight">{greeting(me?.name?.split(/\s+/)[0])}</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Everything worth picking up, in one calm place.</p></div><div className="relative"><Button variant="outline" size="sm" onClick={() => setCustomizing((value) => !value)}><Settings2 className="mr-2 size-4" />Customize</Button>{customizing && <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-border/70 bg-background/95 p-3 shadow-xl backdrop-blur"><p className="mb-2 text-xs font-semibold text-muted-foreground">Home sections</p>{homeSections.map((section, index) => <div key={section.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent"><button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm" onClick={() => toggle(section.id)}>{section.visible ? <Eye className="size-3.5 text-primary" /> : <EyeOff className="size-3.5 text-muted-foreground" />}<span className={section.visible ? "truncate" : "truncate text-muted-foreground line-through"}>{labels[section.id]}</span></button><button type="button" aria-label="Move section up" disabled={index === 0} onClick={() => move(section.id, -1)} className="rounded p-1 hover:bg-background disabled:opacity-30"><ArrowUp className="size-3.5" /></button><button type="button" aria-label="Move section down" disabled={index === homeSections.length - 1} onClick={() => move(section.id, 1)} className="rounded p-1 hover:bg-background disabled:opacity-30"><ArrowDown className="size-3.5" /></button></div>)}</div>}</div></header><div className="grid grid-cols-1 items-stretch gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">{homeSections.map((section) => visible(section.id) ? <div key={section.id} className={section.id === "jump-back-in" || section.id === "newsfeed" ? "w-full xl:col-span-2" : "w-full min-w-0"}>{sections[section.id]}</div> : null)}</div></div>;
}

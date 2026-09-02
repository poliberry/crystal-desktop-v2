import { Notification, nativeImage, type BrowserWindow, type NativeImage } from "electron";
import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";

/**
 * Watches Convex for new DM/channel messages and friend requests from the
 * main process, independent of whether the main window is open or focused —
 * that's the whole point (OS notifications that still show up when the app
 * is "closed" to the tray). Can't use the app's typed `api` object here:
 * electron/tsconfig.json's `rootDir` is scoped to electron/, so it can't
 * reach into convex/_generated/. `anyApi` is Convex's documented escape
 * hatch for exactly this (untyped scripts/processes without codegen).
 *
 * Runs one persistent subscription against convex/notifications.ts's `feed`
 * query, authenticated with whatever Clerk token the renderer last pushed
 * over IPC (see notifications:configure in main.ts / use-sync-notifications
 * .ts in the renderer) — the renderer still owns the actual Clerk session,
 * this just borrows a token from it.
 */

/** What a message carried, when it carried files. */
interface FeedAttachment {
  fileName: string;
  count: number;
}

/**
 * One line for a toast: the paperclip when files came with it, then whatever
 * was said — or the file itself when nothing was.
 */
function describe(text: string, attachment: FeedAttachment | null): string {
  const said = text.trim();
  if (!attachment) return said || "Sent a message";
  const what =
    said || (attachment.count > 1 ? `${attachment.count} files` : attachment.fileName);
  return `📎 ${what}`;
}

interface FeedConversation {
  conversationId: string;
  conversationName: string;
  messageId: string;
  authorId: string;
  authorName: string;
  authorImageUrl?: string;
  text: string;
  attachment: FeedAttachment | null;
  createdAt: number;
}

interface FeedChannel {
  channelId: string;
  channelName: string;
  communityId: string;
  communityName: string;
  messageId: string;
  authorId: string;
  authorName: string;
  authorImageUrl?: string;
  text: string;
  attachment: FeedAttachment | null;
  createdAt: number;
}

interface FeedFriendRequest {
  requestId: string;
  createdAt: number;
  fromName: string;
  fromImageUrl?: string;
}

interface FeedCallEvent {
  id: string;
  type: "call_ring" | "call_started" | "stream_started";
  title: string;
  body: string;
  actorImageUrl?: string;
  conversationId?: string;
  channelId?: string;
  communityId?: string;
}

interface Feed {
  conversations: FeedConversation[];
  channels: FeedChannel[];
  friendRequests: FeedFriendRequest[];
  callEvents: FeedCallEvent[];
}

export type ActiveView = { kind: "conversation" | "channel"; id: string } | null;

export type NavigateTarget =
  | { kind: "conversation"; conversationId: string }
  | { kind: "channel"; communityId: string; channelId: string };

let client: ConvexClient | null = null;
let currentToken: string | null = null;
let myUserId: string | null = null;
let unsubscribe: (() => void) | null = null;

// Baselined on the first feed callback after each (re)configure so we never
// fire a wall of notifications for a whole pre-existing unread backlog —
// only for messages/requests that show up after we started watching.
let seeded = false;
const lastConversationMessage = new Map<string, string>();
const lastChannelMessage = new Map<string, string>();
const seenFriendRequests = new Set<string>();
const seenCallEvents = new Set<string>();

let activeView: ActiveView = null;
let getMainWindow: (() => BrowserWindow | null) | null = null;
let onNavigate: ((target: NavigateTarget) => void) | null = null;

export function init(opts: { getMainWindow: () => BrowserWindow | null; onNavigate: (target: NavigateTarget) => void }): void {
  getMainWindow = opts.getMainWindow;
  onNavigate = opts.onNavigate;
}

/** Pushed whenever the renderer's focused conversation/channel changes, so a
 * message in the thing you're already looking at doesn't also pop a toast. */
export function setActiveView(view: ActiveView): void {
  activeView = view;
}

function teardown(): void {
  unsubscribe?.();
  unsubscribe = null;
  client = null;
  seeded = false;
  lastConversationMessage.clear();
  lastChannelMessage.clear();
  seenFriendRequests.clear();
  seenCallEvents.clear();
}

export function configure(url: string, token: string | null, userId: string | null): void {
  myUserId = userId;
  currentToken = token;

  if (!token || !userId) {
    teardown();
    return;
  }

  if (!client) {
    client = new ConvexClient(url, { unsavedChangesWarning: false });
  }
  client.setAuth(async () => currentToken);

  if (!unsubscribe) {
    unsubscribe = client.onUpdate(anyApi.notifications.feed, {}, (feed: Feed) => handleFeed(feed));
  }
}

function isFocusedOn(kind: "conversation" | "channel", id: string): boolean {
  const win = getMainWindow?.();
  return !!win && win.isFocused() && activeView?.kind === kind && activeView.id === id;
}

/**
 * Avatars already fetched, keyed by URL.
 *
 * Avatar URLs are content-addressed, so an entry can never go stale — a new
 * picture is a new URL. Bounded anyway: a busy server's worth of distinct
 * senders shouldn't accumulate in the main process forever. Cut 50→30; each
 * 64×64 NativeImage is ~16KB + overhead and main process has no GC pressure
 * release for them.
 */
const iconCache = new Map<string, NativeImage>();
const ICON_CACHE_LIMIT = 30;

/**
 * The sender's avatar as a native image, or undefined if it can't be had.
 *
 * The OS won't fetch a remote URL for us, so the bytes have to come through
 * here. Anything `nativeImage` can't decode (it has no WebP support, which
 * some avatar CDNs serve by default) simply means no icon — a toast without a
 * face is still a perfectly good toast.
 */
async function iconFor(url: string | undefined): Promise<NativeImage | undefined> {
  if (!url) return undefined;
  const cached = iconCache.get(url);
  if (cached) return cached;

  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
    if (image.isEmpty()) return undefined;
    // Toasts render this small; sending a 512px avatar to the shell is waste.
    const sized = image.resize({ width: 64, height: 64 });
    if (iconCache.size >= ICON_CACHE_LIMIT) {
      const oldest = iconCache.keys().next().value;
      if (oldest !== undefined) iconCache.delete(oldest);
    }
    iconCache.set(url, sized);
    return sized;
  } catch {
    return undefined;
  }
}

async function notify(
  title: string,
  body: string,
  onClick: () => void,
  iconUrl?: string
): Promise<void> {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body, icon: await iconFor(iconUrl) });
  notification.on("click", () => {
    const win = getMainWindow?.();
    win?.show();
    win?.focus();
    onClick();
  });
  notification.show();
}

function handleFeed(feed: Feed): void {
  if (!seeded) {
    for (const c of feed.conversations) lastConversationMessage.set(c.conversationId, c.messageId);
    for (const c of feed.channels) lastChannelMessage.set(c.channelId, c.messageId);
    for (const r of feed.friendRequests) seenFriendRequests.add(r.requestId);
    for (const e of feed.callEvents) seenCallEvents.add(e.id);
    seeded = true;
    return;
  }

  for (const c of feed.conversations) {
    const last = lastConversationMessage.get(c.conversationId);
    lastConversationMessage.set(c.conversationId, c.messageId);
    if (last === c.messageId) continue;
    if (c.authorId === myUserId) continue;
    if (isFocusedOn("conversation", c.conversationId)) continue;

    void notify(
      c.conversationName,
      `${c.authorName}: ${describe(c.text, c.attachment)}`,
      () => onNavigate?.({ kind: "conversation", conversationId: c.conversationId }),
      c.authorImageUrl
    );
  }

  for (const c of feed.channels) {
    const last = lastChannelMessage.get(c.channelId);
    lastChannelMessage.set(c.channelId, c.messageId);
    if (last === c.messageId) continue;
    if (c.authorId === myUserId) continue;
    if (isFocusedOn("channel", c.channelId)) continue;

    void notify(
      `#${c.channelName} · ${c.communityName}`,
      `${c.authorName}: ${describe(c.text, c.attachment)}`,
      () => onNavigate?.({ kind: "channel", communityId: c.communityId, channelId: c.channelId }),
      c.authorImageUrl
    );
  }

  for (const r of feed.friendRequests) {
    if (seenFriendRequests.has(r.requestId)) continue;
    seenFriendRequests.add(r.requestId);
    void notify(
      "Friend request",
      `${r.fromName} sent you a friend request`,
      () => {},
      r.fromImageUrl
    );
  }

  for (const e of feed.callEvents) {
    if (seenCallEvents.has(e.id)) continue;
    seenCallEvents.add(e.id);
    // Not for a call you're already looking at — the roster in front of you
    // already shows it.
    if (e.conversationId && isFocusedOn("conversation", e.conversationId)) continue;
    if (e.channelId && isFocusedOn("channel", e.channelId)) continue;
    void notify(
      e.title,
      e.body,
      () => {
        if (e.conversationId) {
          onNavigate?.({ kind: "conversation", conversationId: e.conversationId });
        } else if (e.communityId && e.channelId) {
          onNavigate?.({ kind: "channel", communityId: e.communityId, channelId: e.channelId });
        }
      },
      e.actorImageUrl
    );
  }
}

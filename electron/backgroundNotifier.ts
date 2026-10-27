import { Notification, ipcMain, nativeImage, type BrowserWindow, type NativeImage } from "electron";
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

/** An end-to-end encrypted body exactly as stored. This process never holds a key for it. */
interface FeedEnvelope {
  keyId: string;
  iv: string;
  ct: string;
}

interface FeedConversation {
  conversationId: string;
  conversationName: string;
  messageId: string;
  authorId: string;
  authorName: string;
  authorImageUrl?: string;
  /** Legacy plaintext, or the server's generic line for an encrypted message. */
  text: string;
  enc?: FeedEnvelope | null;
  mentionsMe?: boolean;
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
  enc?: FeedEnvelope | null;
  mentionsMe?: boolean;
  attachment: FeedAttachment | null;
  createdAt: number;
}

/** What the renderer is asked to open: the room, the author and the envelope. Never plaintext. */
export interface DecryptRequest {
  /** The account this notifier is watching; the renderer refuses if it is signed in as anyone else. */
  userId: string;
  scope: "conversation" | "channel";
  targetId: string;
  authorId: string;
  enc: FeedEnvelope;
}

/** What a toast says about an encrypted message it couldn't open on this device. */
const ENCRYPTED_FALLBACK = "New encrypted message";

/**
 * How long a toast waits for the renderer to decrypt its preview. The renderer may be throttled in
 * the background, or gone (closed to the tray, mid-reload): past this the toast goes out with the
 * fallback rather than late.
 */
const DECRYPT_TIMEOUT_MS = 2_500;
/** A toast body is a line, not a message; and the renderer is not trusted to size it. */
const DECRYPTED_MAX = 300;

let decryptSeq = 0;
const pendingDecrypts = new Map<string, (text: string | null) => void>();
let decryptListening = false;

/**
 * Ask the main window's renderer — the only place this device's E2EE keys live — for a one-line
 * preview of an encrypted message. The plaintext stays on this machine (renderer → main → the OS
 * notification); it is never sent to the server. Null when there is no renderer, it has no key, the
 * account changed, the user turned previews off, or it took too long.
 */
function decryptInRenderer(request: DecryptRequest): Promise<string | null> {
  const win = getMainWindow?.();
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return Promise.resolve(null);
  const id = `${Date.now().toString(36)}-${(decryptSeq++).toString(36)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingDecrypts.delete(id);
      resolve(null);
    }, DECRYPT_TIMEOUT_MS);
    pendingDecrypts.set(id, (text) => {
      clearTimeout(timer);
      pendingDecrypts.delete(id);
      resolve(text);
    });
    try {
      win.webContents.send("notifications:decrypt", id, request);
    } catch {
      pendingDecrypts.get(id)?.(null);
    }
  });
}

function listenForDecrypts(): void {
  if (decryptListening) return;
  decryptListening = true;
  ipcMain.on("notifications:decrypt-result", (event, id: unknown, text: unknown) => {
    // Only the window we asked may answer.
    const win = getMainWindow?.();
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
    if (typeof id !== "string") return;
    const settle = pendingDecrypts.get(id);
    if (!settle) return;
    settle(typeof text === "string" && text.trim() ? text.trim().slice(0, DECRYPTED_MAX) : null);
  });
}

/**
 * The toast line for a message: decrypted on this device when it is encrypted and the key is here,
 * the server's (legacy) text otherwise, and a safe fallback — never ciphertext — when it can't be
 * opened.
 */
async function messageLine(
  item: FeedConversation | FeedChannel,
  scope: "conversation" | "channel",
  targetId: string
): Promise<string | null> {
  if (!item.enc) return describe(item.text, item.attachment);
  const userId = myUserId;
  const decrypted = userId
    ? await decryptInRenderer({ userId, scope, targetId, authorId: item.authorId, enc: item.enc })
    : null;
  // Signed out or switched account while waiting: no toast at all for the last account's message.
  if (!userId || userId !== myUserId) return null;
  // Opened it while we were waiting: the message is in front of them already.
  if (isFocusedOn(scope, targetId)) return null;
  if (decrypted) return describe(decrypted, item.attachment);
  if (item.attachment) return describe("", item.attachment);
  return scope === "channel" && item.mentionsMe ? `Mentioned you · ${ENCRYPTED_FALLBACK.toLowerCase()}` : ENCRYPTED_FALLBACK;
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
  listenForDecrypts();
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
  // Nothing still waiting on a decrypt may outlive the session it was for.
  for (const settle of [...pendingDecrypts.values()]) settle(null);
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

    void messageLine(c, "conversation", c.conversationId).then((line) =>
      line === null ? undefined : notify(
        c.conversationName,
        `${c.authorName}: ${line}`,
        () => onNavigate?.({ kind: "conversation", conversationId: c.conversationId }),
        c.authorImageUrl
      )
    );
  }

  for (const c of feed.channels) {
    const last = lastChannelMessage.get(c.channelId);
    lastChannelMessage.set(c.channelId, c.messageId);
    if (last === c.messageId) continue;
    if (c.authorId === myUserId) continue;
    if (isFocusedOn("channel", c.channelId)) continue;

    void messageLine(c, "channel", c.channelId).then((line) =>
      line === null ? undefined : notify(
        `#${c.channelName} · ${c.communityName}`,
        `${c.authorName}: ${line}`,
        () => onNavigate?.({ kind: "channel", communityId: c.communityId, channelId: c.channelId }),
        c.authorImageUrl
      )
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

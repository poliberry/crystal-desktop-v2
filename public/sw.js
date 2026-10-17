/*
 * Crystal's service worker, for the installed web app (PWA). Registered by src/lib/pwa.ts, never in the
 * desktop app.
 *
 * Deliberately small. It does three things:
 *  1. Caches the build's fingerprinted static files (/_next/static/…), which never change once published,
 *     so an installed app opens quickly. Everything else (Convex, the CDN, the API) goes straight to the
 *     network: chat must never be served stale.
 *  2. Falls back to the cached app shell when a page is opened with no connection.
 *  3. Shows Web Push notifications (sent by convex/webPush.ts) and opens the right conversation, channel or
 *     call when one is tapped. Each push carries a `url` deep link such as /app/#/dm/<id>.
 *
 * Bump VERSION to drop old caches.
 */
const VERSION = "v3";
const STATIC_CACHE = `crystal-static-${VERSION}`;
const SHELL_CACHE = `crystal-shell-${VERSION}`;
const SHELL_URL = "/app/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(new Request(SHELL_URL, { cache: "reload" })))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("crystal-") && k !== STATIC_CACHE && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Fingerprinted build files: cache first, forever. Only real production builds (never a dev server,
  // whose file names don't change when the code does), and only names that carry a content hash.
  const devHost = /^(localhost|127\.0\.0\.1|.*\.localhost)$/.test(self.location.hostname);
  if (!devHost && url.pathname.startsWith("/_next/static/") && /[.-][a-z0-9_-]{8,}\.(js|css|woff2|png|svg|webp|wasm)$/i.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Opening the app: the network first (so a new release shows up), the cached shell when offline.
  if (request.mode === "navigate" && url.pathname.startsWith("/app")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_URL, response.clone()));
          return response;
        })
        .catch(() => caches.open(SHELL_CACHE).then((cache) => cache.match(SHELL_URL)).then((hit) => hit || Response.error())),
    );
  }
});

// --- Decrypting a message on this device ---------------------------------------------------------------
//
// The push carries the message still encrypted, plus this person's copy of the room key (encrypted to
// their identity key). The identity key lives in this origin's IndexedDB, saved there by the app
// (src/lib/e2ee/keystore.ts), so the worker can open it without asking anyone. Everything below mirrors
// src/lib/e2ee/crypto.ts; keep the two in step. Any failure falls back to the generic text.

const WRAP_INFO = "crystal-e2ee-wrap-v1";
const AAD_PREFIX = "crystal-e2ee-msg-v1";
const te = new TextEncoder();
const td = new TextDecoder();

function fromB64u(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const s = atob(padded);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function idbGet(db, store, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb(name, stores) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => stores.forEach((s) => req.result.createObjectStore(s));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The identity saved for this account on this device, or null. */
async function loadIdentity(userId) {
  const db = await openDb("crystal-e2ee-keys", ["wrap", "blob"]);
  try {
    const [wrap, blob] = await Promise.all([idbGet(db, "wrap", userId), idbGet(db, "blob", userId)]);
    if (!wrap || !blob) return null;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64u(blob.iv) }, wrap, fromB64u(blob.ct));
    return JSON.parse(td.decode(plain));
  } finally {
    db.close();
  }
}

/** Whether this device shows encrypted message text in notifications (Settings → Notifications). On unless turned off. */
async function previewsAllowed() {
  try {
    const db = await openDb("crystal-sw-prefs", ["prefs"]);
    try {
      return (await idbGet(db, "prefs", "showEncryptedPreviews")) !== false;
    } finally {
      db.close();
    }
  } catch {
    return true;
  }
}

async function unwrapRoomKey(wrapped, privateKey, ownPublicKey) {
  const [tag, ephemeralPublic, iv, ct] = wrapped.split(".");
  if (tag !== "w1") throw new Error("unknown wrap");
  const priv = await crypto.subtle.importKey("pkcs8", fromB64u(privateKey), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const pub = await crypto.subtle.importKey("spki", fromB64u(ephemeralPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256));
  const base = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: concat(fromB64u(ephemeralPublic), fromB64u(ownPublicKey)), info: te.encode(WRAP_INFO) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64u(iv) }, key, fromB64u(ct)));
}

/** Mentions and custom emoji arrive as tokens; a notification shows them as words. */
function readable(text) {
  return text
    .replace(/<@&[a-z0-9]+>/gi, "@role")
    .replace(/<@!?[a-z0-9]+>/gi, "@someone")
    .replace(/<#[a-z0-9]+>/gi, "#channel")
    .replace(/<a?:([\w-]+):[a-z0-9]+>/gi, ":$1:")
    .replace(/\s+/g, " ")
    .trim();
}

/** The message's text, decrypted here, or null if this device can't (no key saved, previews off). */
async function decryptSealed(sealed) {
  if (!sealed || !(await previewsAllowed())) return null;
  try {
    const identity = await loadIdentity(sealed.userId);
    if (!identity) return null;
    const roomKey = await unwrapRoomKey(sealed.wrapped, identity.privateKey, identity.publicKey);
    const aes = await crypto.subtle.importKey("raw", roomKey, "AES-GCM", false, ["decrypt"]);
    const aad = te.encode([AAD_PREFIX, sealed.scope, sealed.targetId, sealed.keyId, sealed.authorId].join("|"));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64u(sealed.iv), additionalData: aad }, aes, fromB64u(sealed.ct));
    const payload = JSON.parse(td.decode(plain));
    if (payload?.v !== 1) return null;
    if (payload.text) return readable(payload.text).slice(0, 300) || null;
    if (payload.embeds?.length) return payload.embeds[0].title || payload.embeds[0].description || "Sent an embed";
    return null;
  } catch {
    return null;
  }
}

// --- Notifications ------------------------------------------------------------------------------------

/** A window of the app that the person is looking at right now. */
async function visibleClient() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return windows.find((w) => w.visibilityState === "visible" && w.focused);
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Crystal", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      // The app is open in front of them: it shows its own in-app notice and sound, so don't double up.
      // Calls are the exception, since a ring should always reach them.
      if (data.kind !== "call_ring" && (await visibleClient())) return;
      const call = data.kind === "call_ring";
      // The real message text, decrypted on this device; the server only ever sent ciphertext.
      const text = await decryptSealed(data.sealed);
      const body = text || data.body || "";
      await self.registration.showNotification(data.title || "Crystal", {
        body,
        icon: data.icon || "/pwa/icon-192.png",
        badge: "/pwa/icon-192.png",
        // One notification per conversation or channel: a burst of messages updates it instead of stacking.
        tag: data.tag || undefined,
        renotify: !!data.tag,
        requireInteraction: call,
        vibrate: call ? [300, 150, 300, 150, 300] : [80],
        timestamp: data.at || Date.now(),
        data: { url: data.url || SHELL_URL, answerUrl: data.answerUrl },
        actions: call && data.answerUrl ? [{ action: "answer", title: "Answer" }, { action: "dismiss", title: "Decline" }] : [],
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;
  const info = event.notification.data || {};
  const target = new URL((event.action === "answer" && info.answerUrl) || info.url || SHELL_URL, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const app = windows.find((w) => new URL(w.url).pathname.startsWith("/app"));
      if (app) {
        // Already open: send it to the place in-app (no reload, so a call in progress isn't dropped).
        app.postMessage({ type: "crystal:navigate", url: target });
        return app.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});

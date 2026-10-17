"use client";

import type { ConvexReactClient } from "convex/react";

import { api } from "../../convex/_generated/api";
import { isElectron } from "@/lib/desktop";
import { mirrorForServiceWorker } from "@/lib/notification-previews";

/**
 * The web app as an installable app: the service worker (public/sw.js), Web Push, and "Add to Home
 * Screen". None of it runs in the desktop app, which has native notifications and its own window.
 */

export function pwaSupported(): boolean {
  return typeof window !== "undefined" && !isElectron() && "serviceWorker" in navigator;
}

export function pushSupported(): boolean {
  return pwaSupported() && "PushManager" in window && "Notification" in window;
}

/** Running as an installed app (home-screen icon), not in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pwaSupported()) return Promise.resolve(null);
  // Not in development: the dev server reuses the same file names for new code, so a worker caching
  // them would serve stale modules. Remove any worker (and its caches) a dev build picked up before.
  if (process.env.NODE_ENV !== "production") {
    registration ??= (async () => {
      for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
      for (const key of await caches.keys()) if (key.startsWith("crystal-")) await caches.delete(key);
      return null;
    })().catch(() => null);
    return registration;
  }
  mirrorForServiceWorker();
  registration ??= navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null);
  return registration;
}

/**
 * Opens a deep link such as `/app/#/dm/<id>` inside the running app. Hash routes are handled in place
 * (tabs-context listens for hashchange), so a call in progress isn't dropped by a reload.
 */
export function openAppLink(url: string) {
  const target = new URL(url, window.location.origin);
  if (target.pathname.replace(/\/+$/, "") === window.location.pathname.replace(/\/+$/, "") && target.hash) {
    if (window.location.hash !== target.hash) window.location.hash = target.hash;
    else window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  window.location.assign(target.href);
}

/** Notification taps while the app is already open arrive as a message from the service worker. */
export function listenForServiceWorkerLinks(): () => void {
  if (!pwaSupported()) return () => {};
  const onMessage = (event: MessageEvent) => {
    if (event.data?.type === "crystal:navigate" && typeof event.data.url === "string") openAppLink(event.data.url);
  };
  navigator.serviceWorker.addEventListener("message", onMessage);
  return () => navigator.serviceWorker.removeEventListener("message", onMessage);
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

/** Where this browser stands. iOS only allows web push from an installed (home-screen) app. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** Asks permission (must be called from a tap), subscribes this browser and tells the server. */
export async function enablePush(convex: ConvexReactClient): Promise<PushState> {
  if (!pushSupported()) return pushState();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const key = await convex.query(api.webPush.publicKey, {});
  if (!key) throw new Error("Notifications aren't set up on this server yet.");
  const reg = await registerServiceWorker();
  if (!reg) throw new Error("This browser can't run the notification service.");
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await convex.mutation(api.webPush.subscribe, { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, userAgent: navigator.userAgent });
  return "on";
}

export async function disablePush(convex: ConvexReactClient): Promise<PushState> {
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await convex.mutation(api.webPush.unsubscribe, { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return "off";
}

/** Re-sends this browser's subscription after sign-in, so a browser shared between accounts notifies the right one. */
export async function resyncPush(convex: ConvexReactClient) {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const reg = await registerServiceWorker();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await convex.mutation(api.webPush.subscribe, { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, userAgent: navigator.userAgent }).catch(() => {});
}

// --- "Install app" -------------------------------------------------------------------------------------

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
let deferred: InstallPrompt | null = null;
const installListeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPrompt;
    installListeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installListeners.forEach((fn) => fn());
  });
}

export function canPromptInstall() {
  return !!deferred;
}

export function onInstallAvailabilityChange(fn: () => void) {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  installListeners.forEach((fn) => fn());
  return outcome === "accepted";
}

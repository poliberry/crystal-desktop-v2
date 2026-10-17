"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the desktop's OS notifications may show what an encrypted message says.
 *
 * Per device, and never sent anywhere: the decision is about what this machine's notification
 * centre (which keeps its own history, outside Crystal) and lock screen get to display. Off, a toast
 * still says who wrote and where, with "New encrypted message" in place of the text. The in-app
 * inbox and sidebars always show what this device can decrypt; they are inside the app.
 */
const KEY = "crystal.notifications.showEncryptedPreviews";

const listeners = new Set<() => void>();

export function readEncryptedNotificationPreviews(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeEncryptedNotificationPreviews(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Storage unavailable: the default (on) stands for this session.
  }
  mirrorForServiceWorker(on);
  for (const listener of listeners) listener();
}

/**
 * The service worker can't read localStorage, so the choice is copied to IndexedDB, where
 * public/sw.js looks before decrypting a pushed message.
 */
export function mirrorForServiceWorker(on: boolean = readEncryptedNotificationPreviews()): void {
  if (typeof indexedDB === "undefined") return;
  try {
    const req = indexedDB.open("crystal-sw-prefs", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("prefs");
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("prefs", "readwrite");
      tx.objectStore("prefs").put(on, "showEncryptedPreviews");
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    };
  } catch {
    // No IndexedDB: the worker falls back to its default (on).
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useEncryptedNotificationPreviews(): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(subscribe, readEncryptedNotificationPreviews, () => true);
  return [value, writeEncryptedNotificationPreviews];
}

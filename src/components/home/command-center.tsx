"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { FOCUS_MESSAGE_SEARCH_EVENT, OPEN_SAVED_MESSAGES_EVENT } from "@/lib/command-events";

// Neither is needed to draw the app: each loads the first time it's opened.
const SavedMessagesDialog = dynamic(() => import("@/components/home/saved-messages-dialog").then((m) => m.SavedMessagesDialog), { ssr: false });
const SavedReminderWatcher = dynamic(() => import("@/components/home/saved-reminders").then((m) => m.SavedReminderWatcher), { ssr: false });

/** The reminder watcher waits until the app has settled; a reminder that's due then still shows. */
const WATCHER_DELAY_MS = 5000;

/**
 * App-wide search focus shortcut and saved-message overlays. Mounted once for the signed-in app.
 */
export function CommandCenter() {
  const [saved, setSaved] = useState<{ open: boolean; focusKey: string | null }>({ open: false, focusKey: null });
  const [savedUsed, setSavedUsed] = useState(false);
  const [watching, setWatching] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      window.dispatchEvent(new Event(FOCUS_MESSAGE_SEARCH_EVENT));
    };
    const openSaved = (event: Event) => {
      const focusKey = (event as CustomEvent<{ focusId?: string }>).detail?.focusId ?? null;
      setSavedUsed(true);
      setSaved({ open: true, focusKey });
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SAVED_MESSAGES_EVENT, openSaved);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SAVED_MESSAGES_EVENT, openSaved);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setWatching(true), WATCHER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      {savedUsed && (
        <SavedMessagesDialog
          open={saved.open}
          focusKey={saved.focusKey}
          onOpenChange={(open) => setSaved((current) => ({ open, focusKey: open ? current.focusKey : null }))}
        />
      )}
      {watching && <SavedReminderWatcher />}
    </>
  );
}

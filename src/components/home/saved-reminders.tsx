"use client";

import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { AlarmClock, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { openSavedMessages } from "@/lib/command-events";

/** setTimeout can't wait longer than ~24.8 days; look again at least this often anyway. */
const MAX_WAIT_MS = 60 * 60 * 1000;

/**
 * Shows a saved message's reminder when it comes due, while Crystal is open.
 *
 * The card says only that a saved message is due, never what it says: it can appear over a shared
 * screen, and the message may be encrypted. Opening it goes to the saved list, which decrypts on this
 * device. Each reminder is claimed on the server first, so with two windows or devices open it shows once.
 * Reminders that come due while the app is closed show the next time it opens.
 */
export function SavedReminderWatcher() {
  const pending = useQuery(api.savedMessages.pendingReminders);
  const claim = useMutation(api.savedMessages.claimReminders);
  const [shown, setShown] = useState<{ id: Id<"savedMessages">; messageKey: string }[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const wake = () => setTick((n) => n + 1);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  useEffect(() => {
    if (!pending?.length) return;
    const now = Date.now();
    const due = pending.filter((r) => r.remindAt <= now);
    if (due.length) {
      void claim({ ids: due.map((r) => r.id) })
        .then((claimed) => {
          const mine = new Set(claimed);
          const fresh = due.filter((r) => mine.has(r.id)).map((r) => ({ id: r.id, messageKey: r.messageKey }));
          if (fresh.length) setShown((list) => [...list, ...fresh].slice(-3));
        })
        .catch(() => undefined);
      return;
    }
    const next = Math.min(...pending.map((r) => r.remindAt));
    const timer = window.setTimeout(() => setTick((n) => n + 1), Math.min(Math.max(next - now, 250), MAX_WAIT_MS));
    return () => window.clearTimeout(timer);
  }, [pending, claim, tick]);

  const dismiss = useCallback((id: string) => setShown((list) => list.filter((r) => r.id !== id)), []);

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {shown.map((reminder) => (
          <motion.div
            key={reminder.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            role="status"
            className="pointer-events-auto flex items-start gap-3 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
          >
            <AlarmClock className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium">Reminder: a message you saved</p>
              <Button
                size="sm"
                className="h-7"
                onClick={() => {
                  openSavedMessages(reminder.messageKey);
                  dismiss(reminder.id);
                }}
              >
                View
              </Button>
            </div>
            <button type="button" aria-label="Dismiss reminder" onClick={() => dismiss(reminder.id)} className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

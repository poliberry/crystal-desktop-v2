"use client";

import { useConvexConnectionState } from "convex/react";

import { useIsOnline } from "@/hooks/use-is-online";
import { getEntries, useOutboxTick } from "@/lib/outbox";

/**
 * A small ambient pill, bottom-left, that surfaces the durable outbox's state:
 * offline with a backlog, a flush in progress, or messages that permanently
 * failed. Silent whenever the queue is empty and the socket is up — which is
 * almost always.
 */
export function OutboxStatus() {
  if (process.env.NODE_ENV === "production") return null;
  useOutboxTick();
  const online = useIsOnline();
  const connection = useConvexConnectionState();
  const connected = online && connection.isWebSocketConnected;

  const entries = getEntries();
  if (entries.length === 0) return null;

  const blocked = entries.filter((e) => e.status === "blocked").length;
  const inFlight = entries.length - blocked;

  let text: string;
  let tone: "muted" | "warn" | "error";
  if (blocked > 0 && inFlight === 0) {
    text = `${blocked} message${blocked === 1 ? "" : "s"} couldn't send`;
    tone = "error";
  } else if (!connected) {
    text = `Offline — ${inFlight} queued`;
    tone = "warn";
  } else {
    text = `Sending ${inFlight}…`;
    tone = "muted";
  }

  return (
    <div
      className={
        "pointer-events-none fixed bottom-3 left-3 z-50 rounded-full border px-3 py-1 text-xs shadow-sm backdrop-blur " +
        (tone === "error"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : tone === "warn"
            ? "border-amber-400/40 bg-amber-400/10 text-amber-500"
            : "border-border bg-background/80 text-muted-foreground")
      }
    >
      {text}
    </div>
  );
}

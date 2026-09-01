"use client";

import { useConvex, useConvexConnectionState } from "convex/react";
import { useEffect, useRef } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useIsOnline } from "@/hooks/use-is-online";
import {
  currentOutboxUser,
  getEntries,
  isRunnable,
  loadBlob,
  markBlocked,
  markFailed,
  markSending,
  markSent,
  nextWakeupAt,
  remapMessageId,
  setFlushRequester,
  setResolvedId,
  useOutboxTick,
} from "@/lib/outbox";
import type { OutboxEntry } from "@/lib/outbox-types";
import { setOverlayBlobUrlListener } from "@/lib/outbox-overlay";
import { uploadToStorage } from "@/lib/storage-upload";

/**
 * Drains the durable outbox to Convex.
 *
 * Mounts once, next to `<DataPreloader/>` inside the Convex provider. It's the
 * single owner of a messaging mutation's lifecycle: it calls `convex.mutation`
 * only while it believes the socket is up, and owns the retry if that rejects.
 *
 * Ordering: one in-flight op per conversation/channel (`targetKey`), drained
 * oldest-`seq` first, so sends land in the same order they were composed and a
 * dependent edit/react/delete always follows its send. Different targets flush
 * concurrently. A permanently-failed op (`blocked`) stops its own target's
 * lane until the user retries or discards it — the ops behind it would only
 * fail too, and letting a later one through would break the order.
 */
export function OutboxFlusher() {
  const convex = useConvex();
  const connection = useConvexConnectionState();
  const online = useIsOnline();
  const tick = useOutboxTick();

  const canFlush = online && connection.isWebSocketConnected;
  const canFlushRef = useRef(canFlush);
  canFlushRef.current = canFlush;

  // Bumped on every account switch (via the tick, which fires from
  // setOutboxUser) — a runner checks it after each await and bails if it's
  // stale, so an in-flight flush can't spill into the next account.
  const generation = useRef(0);
  const locks = useRef(new Set<string>());
  const kickRef = useRef<() => void>(() => {});

  useEffect(() => {
    const kick = () => kickRef.current();
    setFlushRequester(kick);
    setOverlayBlobUrlListener(kick);
    return () => {
      setFlushRequester(null);
      setOverlayBlobUrlListener(null);
    };
  }, []);

  useEffect(() => {
    generation.current += 1;
  }, [/* account switches surface through the tick */ currentOutboxUser()]);

  useEffect(() => {
    kickRef.current = () => void flush();

    async function runTarget(targetKey: string, gen: number) {
      if (locks.current.has(targetKey)) return;
      locks.current.add(targetKey);
      try {
        while (canFlushRef.current && gen === generation.current) {
          const now = Date.now();
          const next = getEntries().find(
            (e) => e.targetKey === targetKey && isRunnable(e, now),
          );
          if (!next) break;
          const outcome = await runOne(next, gen);
          if (gen !== generation.current) break;
          if (outcome === "stop") break;
        }
      } finally {
        locks.current.delete(targetKey);
      }
    }

    async function runOne(
      entry: OutboxEntry,
      gen: number,
    ): Promise<"next" | "stop"> {
      markSending(entry.id);
      try {
        await execute(entry);
        if (gen !== generation.current) return "stop";
        markSent(entry.id);
        return "next";
      } catch (error) {
        if (gen !== generation.current) return "stop";
        const message = error instanceof Error ? error.message : String(error);
        if (isRetryable(message)) {
          markFailed(entry.id, message);
        } else {
          markBlocked(entry.id, message);
        }
        return "stop";
      }
    }

    async function execute(entry: OutboxEntry): Promise<void> {
      const args = entry.args;
      const dm = entry.variant === "dm";

      if (args.kind === "send") {
        const attachments: {
          storageId: Id<"_storage">;
          fileName: string;
          fileType: string;
          fileSize: number;
        }[] = [];
        for (const attachment of args.attachments) {
          let storageId = attachment.storageId;
          if (!storageId && attachment.blobKey) {
            const stored = await loadBlob(attachment.blobKey);
            if (!stored) throw new Error("Attachment bytes are missing.");
            const uploadUrl = await convex.mutation(
              dm
                ? api.messages.generateUploadUrl
                : api.channelMessages.generateUploadUrl,
              {},
            );
            storageId = await uploadToStorage(uploadUrl, stored.blob);
          }
          if (!storageId) throw new Error("Attachment never uploaded.");
          attachments.push({
            storageId: storageId as Id<"_storage">,
            fileName: attachment.fileName,
            fileType: attachment.fileType,
            fileSize: attachment.fileSize,
          });
        }

        let realId: string;
        if (dm) {
          realId = await convex.mutation(api.messages.send, {
            conversationId: args.conversationId as Id<"conversations">,
            text: args.text,
            attachments: attachments.length ? attachments : undefined,
            birthdayWish: args.birthdayWish || undefined,
            replyToId: args.replyToId as Id<"messages"> | undefined,
            pingReply: args.pingReply,
            clientId: entry.id,
          });
        } else {
          realId = await convex.mutation(api.channelMessages.send, {
            channelId: args.channelId as Id<"channels">,
            text: args.text,
            attachments: attachments.length ? attachments : undefined,
            replyToId: args.replyToId as Id<"channelMessages"> | undefined,
            pingReply: args.pingReply,
            clientId: entry.id,
          });
        }

        setResolvedId(entry.id, realId);
        remapMessageId(entry.id, realId);
        return;
      }

      if (args.kind === "edit") {
        if (dm) {
          await convex.mutation(api.messages.update, {
            messageId: args.messageId as Id<"messages">,
            text: args.text,
          });
        } else {
          await convex.mutation(api.channelMessages.update, {
            messageId: args.messageId as Id<"channelMessages">,
            text: args.text,
          });
        }
        return;
      }

      if (args.kind === "delete") {
        if (dm) {
          await convex.mutation(api.messages.remove, {
            messageId: args.messageId as Id<"messages">,
          });
        } else {
          await convex.mutation(api.channelMessages.remove, {
            messageId: args.messageId as Id<"channelMessages">,
          });
        }
        return;
      }

      if (args.kind === "react") {
        if (dm) {
          await convex.mutation(api.messages.toggleReaction, {
            messageId: args.messageId as Id<"messages">,
            emoji: args.emoji,
            desired: args.desired,
          });
        } else {
          await convex.mutation(api.channelMessages.toggleReaction, {
            messageId: args.messageId as Id<"channelMessages">,
            emoji: args.emoji,
            desired: args.desired,
          });
        }
        return;
      }

      if (args.kind === "markRead") {
        try {
          if (dm) {
            await convex.mutation(api.conversations.markRead, {
              conversationId: args.conversationId as Id<"conversations">,
            });
          } else {
            await convex.mutation(api.channels.markRead, {
              channelId: args.channelId as Id<"channels">,
            });
          }
        } catch {
          // Best-effort: a read marker that didn't land is not worth a failed
          // row. The next markRead (or the open chat's own effect) covers it.
        }
        return;
      }
    }

    async function flush(): Promise<void> {
      if (!canFlushRef.current) return;
      const user = currentOutboxUser();
      if (!user) return;
      const gen = generation.current;
      const targets = new Set(
        getEntries()
          .filter((e) => e.userId === user)
          .map((e) => e.targetKey),
      );
      for (const targetKey of targets) void runTarget(targetKey, gen);
    }

    void flush();

    // Re-check failed entries when their backoff elapses.
    const soon = nextWakeupAt();
    if (soon !== null) {
      const delay = Math.max(250, soon - Date.now());
      const timer = setTimeout(() => void flush(), delay);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFlush, tick, convex]);

  return null;
}

/** Network/transport/auth failures are retried; anything a handler threw on
 * purpose (permission, timeout, validation) stops the lane. */
function isRetryable(message: string): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return /network|failed to fetch|fetch failed|timeout|timed out|connection|websocket|socket|ECONN|Could not reach|Unauthenticated|auth/i.test(
    message,
  );
}

"use client";

import { useCallback } from "react";

import { enqueue, stashBlob } from "@/lib/outbox";
import type {
  OutboxAttachmentInput,
  OutboxVariant,
} from "@/lib/outbox-types";

/**
 * `useMutation`, but durable: the call lands in the IndexedDB outbox first (see
 * src/lib/outbox.ts), renders optimistically through the overlay, and is
 * flushed to Convex by `<OutboxFlusher/>` with retry + reconnect handling.
 *
 * The returned callback resolves as soon as the op is *durably enqueued* — not
 * when the server accepts it. That's the one deliberate difference from
 * `useMutation`: call sites only use the result to clear the composer or close
 * an edit box, and the real message id isn't known yet anyway.
 */

/** What a composer hands the `send` variant — the pending-attachment shape
 * from use-composer-attachments, plus an optional raw `File` for the offline
 * path. */
export interface ComposerAttachmentInput {
  storageId?: string;
  file?: File;
  fileName: string;
  fileType: string;
  fileSize: number;
  previewUrl?: string;
}

export interface OutboxSendInput {
  conversationId?: string;
  channelId?: string;
  text?: string;
  birthdayWish?: boolean;
  replyToId?: string;
  pingReply?: boolean;
  replyToPreview?: {
    authorName: string;
    authorImageUrl?: string;
    text: string | null;
    hasAttachment: boolean;
  };
  attachments?: ComposerAttachmentInput[];
}

/** edit / delete / react all target a message in a known conversation or
 * channel — the id is what files the op under the same target the overlay and
 * the flusher's FIFO lane use. */
interface TargetedInput {
  conversationId?: string;
  channelId?: string;
}
export interface OutboxEditInput extends TargetedInput {
  messageId: string;
  text: string;
}
export interface OutboxDeleteInput extends TargetedInput {
  messageId: string;
}
export interface OutboxReactInput extends TargetedInput {
  messageId: string;
  emoji: string;
  desired: "add" | "remove";
}
export interface OutboxMarkReadInput {
  conversationId?: string;
  channelId?: string;
}

type InputFor<K> = K extends "send"
  ? OutboxSendInput
  : K extends "edit"
    ? OutboxEditInput
    : K extends "delete"
      ? OutboxDeleteInput
      : K extends "react"
        ? OutboxReactInput
        : OutboxMarkReadInput;

function targetKeyOf(conversationId?: string, channelId?: string): string {
  if (conversationId) return `dm:${conversationId}`;
  if (channelId) return `channel:${channelId}`;
  throw new Error("Outbox op needs a conversationId or channelId.");
}

export function useOutboxMutation<
  K extends "send" | "edit" | "delete" | "react" | "markRead",
>(kind: K, variant: OutboxVariant): (input: InputFor<K>) => Promise<{ clientId: string }> {
  return useCallback(
    async (input: InputFor<K>) => {
      const id = crypto.randomUUID();

      if (kind === "send") {
        const send = input as OutboxSendInput;
        const targetKey = targetKeyOf(send.conversationId, send.channelId);
        const attachments: OutboxAttachmentInput[] = [];
        for (const [index, attachment] of (send.attachments ?? []).entries()) {
          let blobKey: string | undefined;
          // Stash the bytes when we'll actually need them again: the upload
          // still has to happen (no `storageId` yet), or it's an image whose
          // preview object URL must survive a reload. A file that's already
          // uploaded and isn't shown inline doesn't need a local copy.
          const needsBytes =
            !attachment.storageId || attachment.fileType.startsWith("image/");
          if (attachment.file && needsBytes) {
            blobKey = `${id}:${index}`;
            const ok = await stashBlob(blobKey, {
              blob: attachment.file,
              fileName: attachment.fileName,
              fileType: attachment.fileType,
              fileSize: attachment.fileSize,
            });
            if (!ok) blobKey = undefined;
          }
          attachments.push({
            index,
            fileName: attachment.fileName,
            fileType: attachment.fileType,
            fileSize: attachment.fileSize,
            storageId: attachment.storageId,
            blobKey,
            previewUrl: attachment.previewUrl,
          });
        }
        enqueue({
          id,
          targetKey,
          variant,
          args: {
            kind: "send",
            conversationId: send.conversationId,
            channelId: send.channelId,
            text: send.text,
            birthdayWish: send.birthdayWish,
            replyToId: send.replyToId,
            pingReply: send.pingReply,
            replyToPreview: send.replyToPreview,
            attachments,
          },
        });
        return { clientId: id };
      }

      if (kind === "markRead") {
        const mr = input as OutboxMarkReadInput;
        enqueue({
          id,
          targetKey: targetKeyOf(mr.conversationId, mr.channelId),
          variant,
          args: {
            kind: "markRead",
            conversationId: mr.conversationId,
            channelId: mr.channelId,
            at: Date.now(),
          },
        });
        return { clientId: id };
      }

      // edit / delete / react — filed under the message's own conversation or
      // channel so the overlay and the flusher's per-target FIFO lane see them
      // alongside that target's sends.
      const withMsg = input as OutboxEditInput | OutboxDeleteInput | OutboxReactInput;
      const targetKey = targetKeyOf(withMsg.conversationId, withMsg.channelId);
      if (kind === "edit") {
        const e = withMsg as OutboxEditInput;
        enqueue({
          id,
          targetKey,
          variant,
          args: { kind: "edit", messageId: e.messageId, text: e.text },
        });
      } else if (kind === "delete") {
        const d = withMsg as OutboxDeleteInput;
        enqueue({
          id,
          targetKey,
          variant,
          args: { kind: "delete", messageId: d.messageId },
        });
      } else {
        const r = withMsg as OutboxReactInput;
        enqueue({
          id,
          targetKey,
          variant,
          args: {
            kind: "react",
            messageId: r.messageId,
            emoji: r.emoji,
            desired: r.desired,
          },
        });
      }
      return { clientId: id };
    },
    [kind, variant],
  );
}

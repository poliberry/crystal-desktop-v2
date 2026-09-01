"use client";

import { useMemo } from "react";

import { getEntriesForTarget, loadBlob, useOutboxTick } from "@/lib/outbox";
import type { OutboxEntry } from "@/lib/outbox-types";

/**
 * Splices the pending outbox into a message page — the optimistic half of the
 * durable send layer.
 *
 * Applied strictly *downstream* of `useCachedFirstPage` (see
 * src/lib/message-cache.ts): that hook must keep caching the real server
 * results, because it mirrors them to persistent storage. This overlay is a
 * per-render transform on top and is never persisted anywhere.
 *
 * Four shapes:
 *  - a pending `send` with no matching real row yet → a synthesised row
 *  - a pending `edit` → the target row's text, overridden
 *  - a pending `delete` → the target row, dropped
 *  - a pending `react` → the target row's reaction counts, adjusted
 *
 * Everything clears data-driven: a synthesised send disappears the moment a
 * live row with its `clientId` arrives, an edit/react/delete when the flusher
 * removes the entry on success (or when the live row already satisfies it).
 */

export interface OverlayReaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

export interface OverlayAttachment {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  url: string | null;
}

export interface OverlayReplyPreview {
  id: string;
  authorName: string;
  authorImageUrl?: string;
  text: string | null;
  hasAttachment: boolean;
  /** The target no longer exists — render as "original message was deleted". */
  deleted: boolean;
}

export interface OverlayMessage {
  id: string;
  clientId?: string | null;
  text: string | null;
  createdAt: number;
  editedAt: number | null;
  isMine: boolean;
  author:
    | {
        id: string;
        name: string;
        username: string;
        imageUrl?: string;
        avatarDecoration?: string;
      }
    | null;
  attachments: OverlayAttachment[];
  reactions: OverlayReaction[];
  /** The message this one replies to, if any. */
  replyTo?: OverlayReplyPreview | null;
  /** Overlay-only. A synthesised or not-yet-acked row. */
  __pending?: boolean;
  /** Overlay-only. The op backing this row has permanently failed. */
  __failed?: boolean;
  /** Overlay-only. The outbox op id, for the Retry / Discard affordance. */
  __opId?: string;
}

export interface OverlayMe {
  _id: string;
  name: string;
  username: string;
  imageUrl?: string;
  avatarDecoration?: string;
}

// --- stashed-blob object URLs -------------------------------------------
//
// An object URL made from a stashed attachment blob dies on reload, so the
// overlay rebuilds one per blobKey on demand and holds it for the window's
// life (same "never revoked" trade as src/lib/image-cache.ts). `notify` is a
// stand-in — populating a url bumps the outbox tick so the overlay re-runs.

const blobUrls = new Map<string, string>();
const blobUrlPending = new Set<string>();
let onBlobUrlReady: (() => void) | null = null;

export function setOverlayBlobUrlListener(fn: (() => void) | null): void {
  onBlobUrlReady = fn;
}

function blobUrlFor(blobKey: string | undefined): string | undefined {
  if (!blobKey) return undefined;
  const existing = blobUrls.get(blobKey);
  if (existing) return existing;
  if (!blobUrlPending.has(blobKey)) {
    blobUrlPending.add(blobKey);
    void loadBlob(blobKey).then((stored) => {
      blobUrlPending.delete(blobKey);
      if (!stored) return;
      blobUrls.set(blobKey, URL.createObjectURL(stored.blob));
      onBlobUrlReady?.();
    });
  }
  return undefined;
}

// --- transform ---------------------------------------------------------

function syntheticRow(entry: OutboxEntry, me: OverlayMe): OverlayMessage {
  const args = entry.args;
  const attachments: OverlayAttachment[] =
    args.kind === "send"
      ? args.attachments.map((attachment) => ({
          id: `outbox:${entry.id}:${attachment.index}`,
          fileName: attachment.fileName,
          fileType: attachment.fileType,
          fileSize: attachment.fileSize,
          // A rebuilt object URL from the stashed bytes wins: `previewUrl` is
          // only alive for the session that created it, so after a reload it's
          // a dead `blob:` string and the stashed-blob URL is the real one.
          url: blobUrlFor(attachment.blobKey) ?? attachment.previewUrl ?? null,
        }))
      : [];
  const replyPreview = args.kind === "send" ? args.replyToPreview : undefined;
  return {
    id: `outbox:${entry.id}`,
    clientId: entry.id,
    text: args.kind === "send" ? (args.text ?? null) : null,
    createdAt: entry.createdAt,
    editedAt: null,
    isMine: true,
    replyTo:
      args.kind === "send" && args.replyToId && replyPreview
        ? {
            id: args.replyToId,
            authorName: replyPreview.authorName,
            authorImageUrl: replyPreview.authorImageUrl,
            text: replyPreview.text,
            hasAttachment: replyPreview.hasAttachment,
            deleted: false,
          }
        : null,
    author: {
      id: me._id,
      name: me.name,
      username: me.username,
      imageUrl: me.imageUrl,
      avatarDecoration: me.avatarDecoration,
    },
    attachments,
    // Never plays local cakes — the server re-derives `birthdayWish` at send
    // time, and `latestBirthdayWish` + the real row drive the animation.
    reactions: [],
    __pending: true,
    __failed: entry.status === "blocked",
    __opId: entry.id,
  };
}

/**
 * The page with the outbox applied. `T` is whatever the list component calls
 * its message shape — it only has to be assignable to `OverlayMessage`.
 */
export function applyOutboxOverlay<T extends OverlayMessage>(
  page: readonly T[],
  entries: OutboxEntry[],
  me: OverlayMe | null | undefined,
): T[] {
  if (entries.length === 0) return page as T[];

  const sends = entries.filter((e) => e.kind === "send");
  const edits = entries.filter((e) => e.kind === "edit");
  const deletes = entries.filter((e) => e.kind === "delete");
  const reacts = entries.filter((e) => e.kind === "react");

  // ids the live page already carries a row for — a synthesised send for one
  // of these has been superseded.
  const landedClientIds = new Set<string>();
  const rowById = new Map<string, T>();
  for (const row of page) {
    if (row.clientId) landedClientIds.add(row.clientId);
    rowById.set(row.id, row);
  }

  let result: T[] = page.filter((row) => {
    // Drop a row a pending delete targets (real id, or a resolved send id).
    return !deletes.some((e) => {
      if (e.args.kind !== "delete") return false;
      const target = e.args.messageId;
      return row.id === target || row.clientId === target;
    });
  });

  // Edits: override text on the matching row.
  if (edits.length) {
    result = result.map((row) => {
      const edit = edits.find((e) => {
        if (e.args.kind !== "edit") return false;
        return row.id === e.args.messageId || row.clientId === e.args.messageId;
      });
      if (!edit || edit.args.kind !== "edit") return row;
      if (row.text === edit.args.text) return row;
      return { ...row, text: edit.args.text, editedAt: row.editedAt ?? Date.now() };
    });
  }

  // Reactions: nudge the counts on the matching row.
  if (reacts.length) {
    result = result.map((row) => {
      const mine = reacts.filter((e) => {
        if (e.args.kind !== "react") return false;
        return row.id === e.args.messageId || row.clientId === e.args.messageId;
      });
      if (mine.length === 0) return row;
      let reactions = row.reactions.map((r) => ({ ...r }));
      for (const op of mine) {
        if (op.args.kind !== "react") continue;
        const { emoji, desired } = op.args;
        const found = reactions.find((r) => r.emoji === emoji);
        if (desired === "add") {
          if (found) {
            if (!found.reactedByMe) {
              found.reactedByMe = true;
              found.count += 1;
            }
          } else {
            reactions.push({ emoji, count: 1, reactedByMe: true });
          }
        } else if (found?.reactedByMe) {
          found.reactedByMe = false;
          found.count -= 1;
        }
      }
      reactions = reactions.filter((r) => r.count > 0);
      return { ...row, reactions };
    });
  }

  // Synthesised send rows, placed at the newest end in seq order. The page is
  // newest-first (`.order("desc")`), so that end is the *front* of the array —
  // appending would bury them at the bottom of history, where they'd flash at
  // the top of the rendered list until the real row landed. Dropped the moment
  // the live page carries the real row — matched by our `clientId`, or by the
  // id the flush recorded on `resolvedId`.
  if (me) {
    const synthetic = sends
      .filter((e) => {
        if (landedClientIds.has(e.id)) return false;
        if (e.resolvedId && rowById.has(e.resolvedId)) return false;
        return true;
      })
      // Descending seq to match the newest-first page: after the list reverses
      // this to chronological order, the queued sends read oldest → newest.
      .sort((a, b) => b.seq - a.seq)
      .map((e) => syntheticRow(e, me) as unknown as T);
    result = [...synthetic, ...result];
  }

  return result;
}

/**
 * Hook form: `page` with this target's outbox applied, re-running whenever the
 * queue changes.
 */
export function useOutboxOverlay<T extends OverlayMessage>(
  targetKey: string,
  page: readonly T[],
  me: OverlayMe | null | undefined,
): T[] {
  const t = useOutboxTick();
  return useMemo(
    () => applyOutboxOverlay(page, getEntriesForTarget(targetKey), me),
    // `t` is the external-store version; `page`/`me` identity covers the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetKey, page, me, t],
  );
}

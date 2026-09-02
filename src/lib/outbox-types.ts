/**
 * Shapes for the durable send outbox. Split from src/lib/outbox.ts so the
 * IndexedDB layer (outbox-db.ts) and the overlay (outbox-overlay.ts) can share
 * them without importing the module that owns the in-memory mirror.
 */

/** Which conversation or channel an op belongs to — also the FIFO domain the
 * flusher serialises on. */
export type TargetKey = string; // "dm:<conversationId>" | "channel:<channelId>"

export type OutboxKind = "send" | "edit" | "delete" | "react" | "markRead";
export type OutboxVariant = "dm" | "channel";

export type OutboxStatus =
  /** Waiting for the flusher. */
  | "pending"
  /** The flusher has a call in flight for it right now. */
  | "sending"
  /** A retryable failure (offline, transport). Retried after `nextAttemptAt`. */
  | "failed"
  /** A permanent failure (no permission, timed out, validation). The flusher
   * stops this target's queue until the user retries or discards. */
  | "blocked";

export interface OutboxAttachmentInput {
  index: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  /** Set when the bytes are already in Convex storage (the online path). */
  storageId?: string;
  cdnKey?: string;
  cdnUrl?: string;
  /** Set when the bytes are stashed in the outbox `blobs` store and still need
   * uploading during the flush (the offline path). Key is `"<opId>:<index>"`. */
  blobKey?: string;
  /** A local object URL for the optimistic thumbnail, rebuilt from the stashed
   * blob on hydration. Never sent anywhere. */
  previewUrl?: string;
}

export interface SendArgs {
  conversationId?: string;
  channelId?: string;
  text?: string;
  birthdayWish?: boolean;
  /** The message this send is a reply to. */
  replyToId?: string;
  /** Whether the reply notifies its target — the composer's "@" toggle. */
  pingReply?: boolean;
  /** A snapshot of the reply target, stashed at enqueue so the optimistic row
   * can render its reply preview offline (never sent to the server — the
   * `list` query re-resolves the real preview once the row lands). */
  replyToPreview?: {
    authorName: string;
    authorImageUrl?: string;
    text: string | null;
    hasAttachment: boolean;
  };
  attachments: OutboxAttachmentInput[];
}

export interface EditArgs {
  /** A real message id, or the `clientId` of a still-pending send. */
  messageId: string;
  text: string;
}

export interface DeleteArgs {
  messageId: string;
}

export interface ReactArgs {
  messageId: string;
  emoji: string;
  desired: "add" | "remove";
}

export interface MarkReadArgs {
  conversationId?: string;
  channelId?: string;
  at: number;
}

export type OutboxArgs =
  | ({ kind: "send" } & SendArgs)
  | ({ kind: "edit" } & EditArgs)
  | ({ kind: "delete" } & DeleteArgs)
  | ({ kind: "react" } & ReactArgs)
  | ({ kind: "markRead" } & MarkReadArgs);

export interface OutboxEntry {
  /** uuid — also the `clientId` idempotency key handed to `send`. */
  id: string;
  /** Clerk user id; matches the persistent-cache namespace. */
  userId: string;
  targetKey: TargetKey;
  kind: OutboxKind;
  variant: OutboxVariant;
  /** `Date.now()` at enqueue — the optimistic row's timestamp. */
  createdAt: number;
  /** Monotonic per user, persisted — the total order the flusher drains in. */
  seq: number;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms the next attempt is allowed. `0` for a fresh `pending` entry. */
  nextAttemptAt: number;
  lastError?: string;
  /** The real message id once a send has been acked, before the live query
   * has delivered the row. Lets a dependent edit/delete/react resolve its
   * target in that window. */
  resolvedId?: string;
  args: OutboxArgs;
}

/**
 * The message a composer is currently replying to.
 *
 * Held by the chat view, set by the "Reply" action on a message row, and
 * handed to the composer so it can show the "Replying to…" bar and attach the
 * pointer (plus a preview snapshot for the optimistic row) to the next send.
 */
export interface ReplyDraft {
  /** The real id of the message being replied to. */
  id: string;
  authorName: string;
  authorImageUrl?: string;
  /** Already rendered/trimmed for a one-line preview, or null for an
   * attachment-only message. */
  text: string | null;
  hasAttachment: boolean;
}

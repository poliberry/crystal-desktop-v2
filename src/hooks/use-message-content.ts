"use client";

import { useEffect, useMemo } from "react";

import type { Id } from "../../convex/_generated/dataModel";
import { useDecryptedMessage, type Room } from "@/lib/e2ee";
import type { Envelope } from "@/lib/e2ee/crypto";
import { getSearchIndex, roomKeyOf } from "@/lib/e2ee/search-index";
import { safePollWords, sanitizeComponents, sanitizeEmbeds, type SafeActionRow, type SafeEmbed } from "@/lib/e2ee/sanitize";

export type ContentState = "plain" | "decrypted" | "locked" | "pending" | "plaintext-in-encrypted-room";

export interface MessageContentValue {
  text?: string;
  embeds: SafeEmbed[];
  components: SafeActionRow[];
  /** The words of an encrypted poll, as decrypted. A plaintext poll's words are on the row itself. */
  pollWords: unknown;
  state: ContentState;
}

/** The parts of a server row that decide what is readable. */
export interface ContentRow {
  enc?: Envelope | null;
  text?: string | null;
  /** Legacy rows only (bot cards stored in the clear before E2EE). Sanitised the same way. */
  embeds?: unknown[] | null;
  components?: unknown[] | null;
}

const NONE: SafeEmbed[] = [];
const NONE_ROWS: SafeActionRow[] = [];

/**
 * What to draw for a message row: decrypted, and with the bot-supplied pieces rebuilt through
 * the client sanitiser (the server no longer validates them — it can't read them).
 *
 * `local` marks a row that exists only on this device: a queued send or a queued edit. Its text is
 * what the person just typed, not something to decrypt, and it must not be mistaken for a plaintext
 * row somebody slipped into an encrypted room.
 */
export function useMessageContent(
  room: Room,
  authorId: string | undefined,
  row: ContentRow,
  local = false,
): MessageContentValue {
  const decrypted = useDecryptedMessage(
    room,
    (authorId ?? "") as Id<"users">,
    local ? {} : { enc: row.enc ?? undefined, text: row.text ?? undefined },
  );

  const state: ContentState = local ? "plain" : decrypted.state;
  const text = local ? (row.text ?? undefined) : decrypted.text;
  const rawEmbeds = state === "decrypted" ? decrypted.embeds : state === "plain" && !local ? (decrypted.embeds ?? row.embeds ?? undefined) : undefined;
  const rawComponents =
    state === "decrypted" ? decrypted.components : state === "plain" && !local ? (decrypted.components ?? row.components ?? undefined) : undefined;

  const embeds = useMemo(() => (rawEmbeds ? sanitizeEmbeds(rawEmbeds) : NONE), [rawEmbeds]);
  const components = useMemo(() => (rawComponents ? sanitizeComponents(rawComponents) : NONE_ROWS), [rawComponents]);

  return { text, embeds, components, pollWords: state === "decrypted" ? decrypted.poll : undefined, state };
}

/** A decrypted poll's words, checked against the number of options the server counts. */
export function pollWordsOf(content: Pick<MessageContentValue, "pollWords">, optionCount: number) {
  return safePollWords(content.pollWords, optionCount);
}

/**
 * Feed a message that has been read to the local search index. Plaintext-in-encrypted-room and
 * queued local rows are left out: the first is not trustworthy and the second isn't a message yet.
 */
export function useIndexMessage(
  room: Room,
  doc: {
    id: string;
    authorId?: string;
    authorName?: string;
    createdAt: number;
    communityId?: string;
    channelName?: string;
    attachments?: { fileName: string; fileType: string }[];
  },
  content: MessageContentValue,
  skip = false,
): void {
  const key = roomKeyOf(room);
  const canIndex = !skip && (content.state === "decrypted" || content.state === "plain");
  const indexable = canIndex ? content.text : undefined;
  const attachmentKey = JSON.stringify(doc.attachments ?? []);
  useEffect(() => {
    if (!canIndex || (indexable === undefined && !doc.attachments?.length)) return;
    getSearchIndex().add({
      id: doc.id,
      room: key,
      authorId: doc.authorId ?? "",
      authorName: doc.authorName,
      createdAt: doc.createdAt,
      text: indexable ?? "",
      attachments: doc.attachments,
      communityId: doc.communityId,
      channelName: doc.channelName,
    });
  // The serialized key makes this stable when a row rerenders with an
  // equivalent attachment array from a live query.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, doc.id, doc.authorId, doc.authorName, doc.createdAt, doc.communityId, doc.channelName, attachmentKey, indexable, canIndex]);
}

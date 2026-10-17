"use client";

import type { ConvexReactClient } from "convex/react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { keyring, type Room } from "@/lib/e2ee";

/**
 * Builds "Download your data" on this device.
 *
 * Messages are end-to-end encrypted, so the server can't produce a readable copy: it sends the
 * encrypted envelopes (convex/dataExport.ts) and this decrypts them with the keys held here. Anything
 * this device can't decrypt (encryption not unlocked, or a room key it never had) is kept as
 * ciphertext and marked, so the export is complete either way.
 */

type Envelope = { keyId: Id<"e2eeKeys">; iv: string; ct: string };
type RawMessage = { id: string; sentAt: string; editedAt: string | null; text: string | null; enc: Envelope | null; attachments: unknown[] };

export type ExportProgress = { stage: "account" | "dms" | "channels" | "done"; messages: number };

async function readable(room: Room, authorId: Id<"users">, message: RawMessage) {
  const { enc, text, ...rest } = message;
  if (!enc) return { ...rest, text };
  const ready = keyring.getSnapshot().status === "ready";
  const payload = ready ? await keyring.decrypt(room, authorId, enc).catch(() => null) : null;
  if (payload) return { ...rest, text: payload.text ?? text ?? null, embeds: payload.embeds, decrypted: true };
  return { ...rest, text: text ?? null, decrypted: false, encrypted: enc };
}

async function* pages<T>(fetch: (cursor: string | null) => Promise<{ page: T[]; isDone: boolean; continueCursor: string }>) {
  let cursor: string | null = null;
  for (;;) {
    const result: { page: T[]; isDone: boolean; continueCursor: string } = await fetch(cursor);
    yield result.page;
    if (result.isDone) return;
    cursor = result.continueCursor;
  }
}

export async function buildDataExport(convex: ConvexReactClient, onProgress: (p: ExportProgress) => void): Promise<Blob> {
  onProgress({ stage: "account", messages: 0 });
  const account = await convex.query(api.dataExport.account, {});
  const me = (account.profile as { id: Id<"users"> }).id;
  let count = 0;

  const directMessages: unknown[] = [];
  onProgress({ stage: "dms", messages: count });
  for await (const page of pages((cursor) => convex.query(api.dataExport.dmMessages, { paginationOpts: { cursor, numItems: 200 } }))) {
    for (const m of page) directMessages.push({ conversationId: m.conversationId, ...(await readable({ scope: "conversation", conversationId: m.conversationId }, me, m as RawMessage)) });
    count += page.length;
    onProgress({ stage: "dms", messages: count });
  }

  const communityMessages: unknown[] = [];
  onProgress({ stage: "channels", messages: count });
  for await (const page of pages((cursor) => convex.query(api.dataExport.channelMessages, { paginationOpts: { cursor, numItems: 200 } }))) {
    for (const m of page) {
      communityMessages.push({ community: m.community, channel: m.channel, channelId: m.channelId, ...(await readable({ scope: "channel", channelId: m.channelId }, me, m as RawMessage)) });
    }
    count += page.length;
    onProgress({ stage: "channels", messages: count });
  }

  const undecrypted = [...directMessages, ...communityMessages].filter((m) => (m as { decrypted?: boolean }).decrypted === false).length;
  const file = {
    ...account,
    messages: {
      note: undecrypted
        ? `${undecrypted} message(s) couldn't be decrypted on this device and are included encrypted. Unlock encryption in Settings → Security and export again to read them.`
        : "Message text was decrypted on your device while making this file. Crystal's servers never saw it.",
      direct: directMessages,
      communities: communityMessages,
    },
  };
  onProgress({ stage: "done", messages: count });
  return new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

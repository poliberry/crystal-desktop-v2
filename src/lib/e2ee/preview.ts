"use client";

/**
 * One-line previews of encrypted messages, for everywhere a message is summarised rather than shown:
 * the inbox, the sidebars, the Priority card and the desktop's OS notifications.
 *
 * The server can't read an encrypted message, so every one of those used to say "New message" (or
 * nothing). This opens the stored envelope on this device, with this device's keys, and keeps the
 * plaintext in memory only — it is never written to a cache, a query or a push payload. When the
 * keys aren't here (locked, not set up, offline, a room we've lost) the caller gets `null` and shows
 * its own safe fallback, never ciphertext.
 */
import { useEffect, useState } from "react";

import type { Id } from "../../../convex/_generated/dataModel";
import { renderMentionsAsPlain } from "@/lib/mentions";
import { keyring, type Room } from "./keyring";
import type { Envelope, MessagePayload } from "./crypto";
import { useE2eeSnapshot } from "./index";

/** What a summary says about an encrypted message it can't open. */
export const ENCRYPTED_PREVIEW_FALLBACK = "Encrypted message";
/** The same, for something that has just arrived (notifications). */
export const NEW_ENCRYPTED_MESSAGE = "New encrypted message";

/** Long enough for a sidebar line or a toast; the full message is one click away. */
const PREVIEW_MAX = 160;

export type EncryptedSource = {
  room: Room;
  authorId: string;
  enc: Envelope;
};

/** Build a source from the loose shapes queries return, or null when something is missing. */
export function encryptedSource(
  scope: "conversation" | "channel",
  targetId: string | null | undefined,
  authorId: string | null | undefined,
  enc: Envelope | null | undefined,
): EncryptedSource | null {
  if (!targetId || !authorId || !enc) return null;
  const room: Room =
    scope === "conversation"
      ? { scope, conversationId: targetId as Id<"conversations"> }
      : { scope, channelId: targetId as Id<"channels"> };
  return { room, authorId, enc };
}

type Names = { user?: (id: string) => string | undefined; role?: (id: string) => string | undefined };

/**
 * Decrypted text as one line: mentions as `@name`, whitespace collapsed, capped. Custom emoji tags
 * are left for `MessagePreview` to draw; `plainEmoji` flattens them to `:name:` for surfaces that
 * can only show text (an OS notification).
 */
export function previewLine(text: string | undefined, names: Names = {}, plainEmoji = false): string | null {
  if (!text) return null;
  let line = renderMentionsAsPlain(text, {
    user: (id) => names.user?.(id),
    role: (id) => {
      const name = names.role?.(id);
      return name ? { name } : undefined;
    },
  });
  if (plainEmoji) line = line.replace(/<a?:([\w-]+):[\w-]+>/g, ":$1:");
  line = line.replace(/\s+/g, " ").trim();
  if (!line) return null;
  return line.length > PREVIEW_MAX ? `${line.slice(0, PREVIEW_MAX - 1)}…` : line;
}

export type EncryptedPreview =
  /** Nothing encrypted to show: the caller uses its plaintext/legacy path. */
  | { state: "none"; text: null }
  /** Opened on this device. `text` is null when the message had no words (a file, an embed). */
  | { state: "decrypted"; text: string | null }
  /** Keys still loading. */
  | { state: "pending"; text: null }
  /** No key here for it: locked, not set up, removed from the room, or tampered with. */
  | { state: "locked"; text: null };

function fromPayload(payload: MessagePayload, names: Names): EncryptedPreview {
  return { state: "decrypted", text: previewLine(payload.text, names) };
}

/**
 * The preview of one encrypted message, decrypted on this device when its key is here.
 *
 * Starts from the keyring's in-memory cache, so a message already read this session has its line on
 * the first frame instead of flashing the fallback.
 */
export function useEncryptedPreview(source: EncryptedSource | null | undefined, names: Names = {}): EncryptedPreview {
  const snapshot = useE2eeSnapshot();
  const room = source?.room;
  const targetId = room ? (room.scope === "conversation" ? room.conversationId : room.channelId) : null;
  const enc = source?.enc;
  const authorId = source?.authorId;

  const initial = (): EncryptedPreview => {
    if (!source) return { state: "none", text: null };
    const cached = keyring.peek(source.room, source.authorId, source.enc);
    return cached ? fromPayload(cached, names) : { state: "pending", text: null };
  };
  const [preview, setPreview] = useState<EncryptedPreview>(initial);

  useEffect(() => {
    let live = true;
    if (!source) {
      setPreview({ state: "none", text: null });
      return () => {
        live = false;
      };
    }
    const cached = keyring.peek(source.room, source.authorId, source.enc);
    if (cached) {
      setPreview(fromPayload(cached, names));
      return () => {
        live = false;
      };
    }
    if (snapshot.status !== "ready") {
      setPreview({ state: snapshot.status === "loading" ? "pending" : "locked", text: null });
      return () => {
        live = false;
      };
    }
    void keyring
      .decrypt(source.room, source.authorId as Id<"users">, source.enc)
      .then((payload) => {
        if (!live) return;
        setPreview(payload ? fromPayload(payload, names) : { state: "locked", text: null });
      })
      .catch(() => {
        if (live) setPreview({ state: "locked", text: null });
      });
    return () => {
      live = false;
    };
    // `names` is read when the payload arrives; a resolver identity change alone isn't a reason to
    // decrypt again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.scope, targetId, authorId, enc?.keyId, enc?.iv, enc?.ct, snapshot.status, snapshot.version]);

  return preview;
}

/**
 * Decrypt one message's preview outside React (the desktop notification bridge). Null whenever the
 * keys aren't ready or the message doesn't open; never throws.
 */
export async function decryptPreviewLine(source: EncryptedSource, names: Names = {}): Promise<string | null> {
  try {
    if (keyring.getSnapshot().status !== "ready") return null;
    const payload = await keyring.decrypt(source.room, source.authorId as Id<"users">, source.enc);
    return payload ? previewLine(payload.text, names, true) : null;
  } catch {
    return null;
  }
}

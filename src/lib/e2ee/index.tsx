"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useConvex, useQuery } from "convex/react";
import type { ConvexReactClient } from "convex/react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useAuthUserId } from "@/components/auth/auth-state";
import { keyring, type Room } from "./keyring";
import type { MessagePayload } from "./crypto";

export { keyring, getE2ee } from "./keyring";
export type { Room, E2eeStatus, MessagePayload, Envelope } from "./keyring";

export function E2eeProvider({ children }: { children: React.ReactNode }) {
  const client = useConvex();
  const userId = useAuthUserId();
  const identity = useQuery(api.e2eeKeys.myIdentity, userId ? {} : "skip");

  useEffect(() => {
    keyring.configure(client as ConvexReactClient);
    keyring.setAccount(userId);
  }, [client, userId]);

  useEffect(() => {
    keyring.setServer(identity === undefined ? undefined : identity ? { publicKey: identity.publicKey } : null);
  }, [identity]);

  useEffect(() => {
    const retry = () => {
      keyring.retryMissing();
      void keyring.fulfilPendingWraps().catch(() => undefined);
    };
    window.addEventListener("focus", retry);
    const timer = window.setInterval(retry, 15_000);
    return () => {
      window.removeEventListener("focus", retry);
      window.clearInterval(timer);
    };
  }, []);

  return <>{children}</>;
}

export function useE2eeSnapshot() {
  return useSyncExternalStore(keyring.subscribe, keyring.getSnapshot, keyring.getSnapshot);
}

export function useDecryptedMessage(
  room: Room,
  authorId: Id<"users">,
  row: { enc?: { keyId: string; iv: string; ct: string }; text?: string },
): { state: "plain" | "decrypted" | "locked" | "pending"; text?: string; embeds?: unknown[]; components?: unknown[] } {
  const snapshot = useE2eeSnapshot();
  const enc = row.enc;
  const [content, setContent] = useState<{ state: "plain" | "decrypted" | "locked" | "pending"; text?: string; embeds?: unknown[]; components?: unknown[] }>(() => ({ state: enc ? "pending" : "plain", text: row.text }));

  useEffect(() => {
    let live = true;
    if (!enc) {
      setContent({ state: "plain", text: row.text });
      return () => { live = false; };
    }
    if (snapshot.status !== "ready") {
      setContent({ state: snapshot.status === "loading" ? "pending" : "locked" });
      return () => { live = false; };
    }
    setContent({ state: "pending" });
    void keyring.decrypt(room, authorId, enc).then((payload: MessagePayload | null) => {
      if (!live) return;
      setContent(payload
        ? { state: "decrypted", text: payload.text, embeds: payload.embeds, components: payload.components }
        : { state: "locked" });
    });
    return () => { live = false; };
  }, [room.scope, room.scope === "conversation" ? room.conversationId : room.channelId, authorId, enc?.keyId, enc?.iv, enc?.ct, row.text, snapshot.status, snapshot.version]);

  return content;
}

"use client";

import { useAuthToken } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useEffect, useRef } from "react";

import { api } from "../../convex/_generated/api";
import { getDesktopAPI } from "@/lib/desktop";
import { keyring } from "@/lib/e2ee";
import { decryptPreviewLine, encryptedSource } from "@/lib/e2ee/preview";
import { readEncryptedNotificationPreviews } from "@/lib/notification-previews";
import type { NotificationDecryptRequest } from "@/types/desktop-api";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

const ENVELOPE_FIELD = /^[A-Za-z0-9_-]+$/;

/** The request crossed a process boundary: check its shape before it touches the keyring. */
function isDecryptRequest(value: unknown): value is NotificationDecryptRequest {
  const r = value as NotificationDecryptRequest | null;
  return (
    !!r &&
    typeof r.userId === "string" &&
    (r.scope === "conversation" || r.scope === "channel") &&
    typeof r.targetId === "string" &&
    typeof r.authorId === "string" &&
    !!r.enc &&
    typeof r.enc.keyId === "string" &&
    typeof r.enc.iv === "string" &&
    typeof r.enc.ct === "string" &&
    ENVELOPE_FIELD.test(r.enc.iv)
  );
}

/**
 * Keeps the Electron main process's background notifier (see
 * electron/backgroundNotifier.ts) supplied with a live sign-in token — it runs
 * its own headless Convex subscription so notifications still fire while
 * the window is hidden in the tray, but it needs *some* way to authenticate,
 * and only the renderer holds the actual session. Mounted once,
 * app-wide (see session-bootstrap.tsx), independent of whatever view is
 * currently showing.
 *
 * The token is a short-lived JWT that the auth provider refreshes before it
 * runs out, so this only has to pass along whichever one is current.
 *
 * Also answers the notifier's requests to decrypt an encrypted message's preview: the main process
 * has no keys, this renderer does. The answer is refused (null, so the toast says "New encrypted
 * message") when the device setting is off, when the request is for an account other than the one
 * whose keys are loaded, or when the key isn't here.
 */
export function useSyncNotifications(): void {
  const token = useAuthToken();
  const me = useQuery(api.users.getCurrentUser);

  useEffect(() => {
    const desktop = getDesktopAPI();
    if (!desktop) return;
    void desktop.notifications.configure(CONVEX_URL, token && me ? token : null, token && me ? me._id : null);
  }, [token, me]);

  const meRef = useRef<{ id: string; name: string } | null>(null);
  useEffect(() => {
    meRef.current = me ? { id: me._id, name: me.name } : null;
  }, [me]);

  useEffect(() => {
    const onDecryptRequest = getDesktopAPI()?.notifications.onDecryptRequest;
    if (!onDecryptRequest) return;
    return onDecryptRequest(async (request) => {
      if (!readEncryptedNotificationPreviews()) return null;
      if (!isDecryptRequest(request)) return null;
      const current = meRef.current;
      if (!current || request.userId !== current.id || keyring.accountId !== request.userId) return null;
      const source = encryptedSource(request.scope, request.targetId, request.authorId, request.enc);
      if (!source) return null;
      return decryptPreviewLine(source, { user: (id) => (id === current.id ? current.name : undefined) });
    });
  }, []);
}

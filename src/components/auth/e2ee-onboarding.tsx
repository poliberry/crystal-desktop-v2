"use client";

import { useQuery } from "convex/react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import { Spinner } from "@/components/auth/auth-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useE2eeSnapshot } from "@/lib/e2ee";
import {
  OPEN_E2EE_SETUP_EVENT,
  clearNewAccount,
  dismissForSession,
  isDismissedForSession,
  isNewAccount,
} from "@/lib/e2ee-onboarding";

// The panel (and the crypto UI behind it) is only needed by people who still have something to do.
const E2eeSetupPanel = dynamic(() => import("@/components/auth/e2ee-setup").then((m) => m.E2eeSetupPanel), {
  ssr: false,
  loading: () => (
    <div className="flex h-24 items-center justify-center text-muted-foreground">
      <Spinner />
    </div>
  ),
});

/** Long enough for the app to have drawn itself, so the prompt arrives on top of something. */
const AUTO_OPEN_DELAY_MS = 900;

/**
 * The prompt that asks a signed-in person to set up encryption (a new account, or an existing one from
 * before encryption) or to unlock it (a new device). It appears by itself once per run of the app while
 * there's something to do, straight after sign-up for a new account, and whenever something asks for it
 * (`openE2eeSetup()`: the command palette, a "set up encryption" link).
 *
 * "Not now" is allowed: setup needs a moment of attention and a safe place for the recovery key, and
 * forcing it would push people to click through. What not doing it costs is said plainly, and nothing
 * falls back to plaintext meanwhile — sending simply waits for encryption (see keyring.encrypt).
 */
export function E2eeOnboarding() {
  const snapshot = useE2eeSnapshot();
  const me = useQuery(api.users.getCurrentUser);
  const userId = me?._id ?? null;
  const isGuest = !!me?.isGuest;
  const status = snapshot.status;
  const needsAction = status === "needs-setup" || status === "needs-unlock";

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newAccount, setNewAccount] = useState(false);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    setNewAccount(isNewAccount());
  }, []);

  // Comes up by itself once per account per run, while there's something to do.
  useEffect(() => {
    if (!userId || !needsAction) return;
    const key = `${userId}:${status}`;
    if (handled.current === key) return;
    if (isDismissedForSession(userId) && !isNewAccount()) return;
    const timer = window.setTimeout(() => {
      handled.current = key;
      setOpen(true);
    }, AUTO_OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [userId, needsAction, status]);

  // Asked for from elsewhere: open whatever the state, so "ready" can show the fingerprint too.
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_E2EE_SETUP_EVENT, show);
    return () => window.removeEventListener(OPEN_E2EE_SETUP_EVENT, show);
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    if (newAccount) {
      clearNewAccount();
      setNewAccount(false);
    }
  }, [busy, newAccount]);

  const notNow = useCallback(() => {
    if (userId) dismissForSession(userId);
    close();
  }, [close, userId]);

  if (!userId) return null;

  const title =
    status === "needs-unlock"
      ? "Unlock your messages"
      : status === "ready"
        ? "Message encryption"
        : newAccount
          ? "Welcome to Crystal"
          : "Protect your messages";

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : needsAction ? notNow() : close())}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!busy}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">Set up, unlock or check end-to-end encryption for your messages.</DialogDescription>
        </DialogHeader>
        {open && <E2eeSetupPanel newAccount={newAccount} isGuest={isGuest} onBusyChange={setBusy} onDone={close} />}
        {needsAction && !busy && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              Until you {status === "needs-unlock" ? "unlock" : "set up"} encryption you can look around, but you can&apos;t send messages
              or read encrypted ones on this device. You can do it any time from Settings → Security or with{" "}
              <kbd className="rounded border px-1 font-mono text-[10px]">Ctrl/⌘ K</kbd>.
            </p>
            <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={notNow}>
              Not now
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

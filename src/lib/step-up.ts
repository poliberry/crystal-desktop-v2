import { useSyncExternalStore } from "react";

/**
 * The one place that asks "can I have a verification code?".
 *
 * Whenever the server refuses an administrative function because the session hasn't entered a second
 * step recently, the Convex client (see convex-client.ts) calls `requestPrompt`, the dialog in
 * step-up-dialog.tsx opens, and whatever was refused is run again once the person has answered.
 * Several refusals at once (a page that loads five admin queries' worth of buttons) share one prompt.
 */
export type PromptKind =
  /** Enter a code from the authenticator, a backup code, or use a passkey. */
  | { kind: "code" }
  /** The account has no second step yet: type the password to change security settings. */
  | { kind: "password" }
  /** The platform or the server requires two-step verification and this account hasn't got it. */
  | { kind: "enroll"; scope: "platform" | "server" };

interface Pending {
  prompt: PromptKind;
  waiters: ((ok: boolean) => void)[];
}

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Open (or join) the prompt. Resolves `true` once the person has verified, `false` if they gave up. */
export function requestPrompt(prompt: PromptKind): Promise<boolean> {
  return new Promise((resolve) => {
    if (pending && pending.prompt.kind === prompt.kind) {
      pending.waiters.push(resolve);
      return;
    }
    // A different prompt replaces the old one; whoever was waiting on it is told no.
    pending?.waiters.forEach((w) => w(false));
    pending = { prompt, waiters: [resolve] };
    emit();
  });
}

export function settlePrompt(ok: boolean): void {
  const done = pending;
  pending = null;
  emit();
  done?.waiters.forEach((w) => w(ok));
}

export function usePrompt(): PromptKind | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending?.prompt ?? null,
    () => null,
  );
}

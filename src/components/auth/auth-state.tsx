"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { cloneElement, isValidElement, useCallback, useRef } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { forgetAllRecoveryKeys } from "@/lib/e2ee";

/** Renders its children only while signed in. While the app is still finding out, nothing: the loading screen covers it. */
export function SignedIn({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  return isAuthenticated ? <>{children}</> : null;
}

/** Renders its children only once it is known that nobody is signed in. */
export function SignedOut({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  return !isLoading && !isAuthenticated ? <>{children}</> : null;
}

/**
 * Signs out, then goes to `redirectUrl` if given (Studio names itself, or logging out of Studio would
 * land on Crystal's own sign-in).
 *
 * `signOut` deletes the session on the server, so the token on this machine is dead from that moment
 * even if a copy were kept.
 */
export function useSignOut(redirectUrl?: string): () => Promise<void> {
  const { signOut } = useAuthActions();
  return useCallback(async () => {
    // The recovery key this browser remembered for refreshes (lib/e2ee/keyring.ts) goes with the session.
    forgetAllRecoveryKeys();
    await signOut();
    if (redirectUrl) window.location.assign(redirectUrl);
  }, [signOut, redirectUrl]);
}

/** Wraps one clickable child and makes it sign out: the same shape as the component it replaces. */
export function SignOutButton({ children, redirectUrl }: { children: React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>; redirectUrl?: string }) {
  const signOut = useSignOut(redirectUrl);
  if (!isValidElement(children)) return null;
  const original = children.props.onClick;
  return cloneElement(children, {
    onClick: (event: React.MouseEvent) => {
      original?.(event);
      void signOut();
    },
  });
}

/**
 * The signed-in account's id, `null` when signed out, and — while that is still being worked out — the
 * last answer, so switching things off and on again around a reconnect doesn't read as a different
 * person for a moment (the cache is namespaced by it).
 */
export function useAuthUserId(): Id<"users"> | null {
  const me = useQuery(api.users.getCurrentUser);
  const last = useRef<Id<"users"> | null>(null);
  if (me !== undefined) last.current = me?._id ?? null;
  return last.current;
}

/** `<Show when="signed-in">` / `<Show when="signed-out">`: the pair of switches above under the name the pages already use. */
export function Show({ when, children }: { when: "signed-in" | "signed-out"; children: React.ReactNode }) {
  return when === "signed-in" ? <SignedIn>{children}</SignedIn> : <SignedOut>{children}</SignedOut>;
}

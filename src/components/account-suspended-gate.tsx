"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { SignOutButton } from "@clerk/react";
import { Gavel, ShieldOff } from "lucide-react";

import { api } from "../../convex/_generated/api";
import { LogoMark } from "@/components/logo-mark";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/locale";

/** Mirrors `INDEFINITE` in convex/lib/moderation.ts. */
const INDEFINITE = 8_640_000_000_000_000;

/**
 * Stands in for the app while the signed-in account is suspended or banned.
 *
 * The server is what stops such an account from doing anything — every mutation
 * refuses it, and a banned account reads nothing — so this is only the
 * explanation: without it the app would load and then fail at everything, which
 * reads as being broken rather than as being suspended. A timed suspension lifts
 * by itself when it runs out (the app then reloads); a ban stays until staff lift it.
 */
export function AccountSuspendedGate({ children }: { children: React.ReactNode }) {
  const me = useQuery(api.users.getCurrentUser);
  const [now, setNow] = useState(() => Date.now());
  const until = me?.platformSuspendedUntil;
  const banned = me?.platformBannedAt !== undefined;
  const wasBlocked = useRef(false);

  // Everything under the gate was asked for while the account was blocked and
  // answered with nothing, and those answers don't update by themselves when a
  // suspension runs out (nothing in the database changed). Starting over is the
  // reliable way back in.
  const blocked = banned || (!!until && until > now);
  useEffect(() => {
    if (blocked) wasBlocked.current = true;
    else if (wasBlocked.current) window.location.reload();
  }, [blocked]);

  // Wake at the moment it ends. `setTimeout` can't wait longer than about 24
  // days, so a longer one wakes early and looks again.
  useEffect(() => {
    if (!until || until >= INDEFINITE) return;
    const wait = until - Date.now();
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(wait + 500, 2 ** 31 - 1));
    return () => window.clearTimeout(timer);
  }, [until, now]);

  if (banned) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background p-8 text-center">
        <LogoMark className="size-10 opacity-60" />
        <div className="flex size-14 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <Gavel className="size-7" />
        </div>
        <div className="max-w-md space-y-2">
          <h1 className="text-2xl font-semibold">Your account has been banned</h1>
          <p className="text-sm text-muted-foreground">You can no longer use Crystal with this account.</p>
          {me?.platformBanReason && <p className="rounded-lg bg-foreground/5 p-3 text-sm">{me.platformBanReason}</p>}
          <p className="text-xs text-muted-foreground">
            If you think this is a mistake, contact Crystal support by email.
          </p>
        </div>
        <SignOutButton>
          <Button variant="outline">Sign out</Button>
        </SignOutButton>
      </div>
    );
  }

  if (!until || until <= now) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background p-8 text-center">
      <LogoMark className="size-10 opacity-60" />
      <div className="flex size-14 items-center justify-center rounded-full bg-destructive/15 text-destructive">
        <ShieldOff className="size-7" />
      </div>
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-semibold">Your account is suspended</h1>
        <p className="text-sm text-muted-foreground">
          {until >= INDEFINITE
            ? "It stays suspended until Crystal staff lift it."
            : `It will be restored on ${formatDateTime(until, { dateStyle: "long", timeStyle: "short" })}.`}
        </p>
        {me?.platformSuspensionReason && (
          <p className="rounded-lg bg-foreground/5 p-3 text-sm">{me.platformSuspensionReason}</p>
        )}
        <p className="text-xs text-muted-foreground">
          If you think this is a mistake, contact Crystal support from another account or by email.
        </p>
      </div>
      <SignOutButton>
        <Button variant="outline">Sign out</Button>
      </SignOutButton>
    </div>
  );
}

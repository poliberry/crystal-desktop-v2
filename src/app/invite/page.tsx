"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { SignIn } from "@clerk/clerk-react";
import { Show } from "@clerk/react";
import { Loader2, MonitorDown } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getDesktopAPI } from "@/lib/desktop";
import { inviteDeepLink, parseInviteCode } from "@/lib/invites";

/**
 * Where an invite link lands.
 *
 * The page is `/invite`, not `/invite/[code]`, because this app is a static
 * export and a dynamic segment would need every code known at build time. The
 * code is read from the path instead, which works as long as the host rewrites
 * `/invite/*` to this page — the same rewrite any single-page app needs. A
 * `?code=` query is accepted too, so the link still works on a host that
 * hasn't been configured.
 *
 * The page's actual job is the handoff: if Crystal is installed, the invite
 * should open there, and the only way a web page can know is to try the
 * `crystal://` scheme and see whether the tab is still around afterwards. So
 * it offers the button rather than guessing, and joins in the browser for
 * anyone who'd rather.
 */

/** `/invite/abc123/` → `abc123`. */
function codeFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const query = new URLSearchParams(window.location.search).get("code");
  if (query) return parseInviteCode(query);
  const segments = window.location.pathname.split("/").filter(Boolean);
  const index = segments.indexOf("invite");
  const tail = index >= 0 ? segments[index + 1] : undefined;
  return tail ? parseInviteCode(tail) : null;
}

function InviteCard({ code }: { code: string }) {
  const invite = useQuery(api.communities.resolveInvite, { code });
  const joinByInviteCode = useMutation(api.communities.joinByInviteCode);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  // Inside the desktop app already — the deep link handler has this covered,
  // so the page just gets out of the way.
  const inApp = !!getDesktopAPI();

  if (invite === undefined) {
    return <Loader2 className="size-6 animate-spin text-muted-foreground" />;
  }

  if (invite === null) {
    return (
      <div className="text-center">
        <h1 className="text-xl font-semibold">This invite doesn&apos;t work</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          It may have been regenerated, or the server may be gone.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-5 rounded-xl border border-border/50 bg-card/60 p-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <Avatar className="size-16 rounded-2xl">
          <AvatarImage src={invite.imageUrl} alt={invite.name} className="rounded-2xl" />
          <AvatarFallback className="text-lg">
            {invite.name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="text-xs text-muted-foreground">
            You&apos;ve been invited to join
          </p>
          <h1 className="text-xl font-semibold">{invite.name}</h1>
          <p className="text-xs text-muted-foreground">
            {invite.memberCount} {invite.memberCount === 1 ? "member" : "members"}
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-2">
        <Button
          className="w-full"
          disabled={joining || joined}
          onClick={async () => {
            setJoining(true);
            setError(null);
            try {
              await joinByInviteCode({ code });
              setJoined(true);
              // Straight into the app: an invite is a door, not a
              // destination.
              window.location.assign("/");
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Couldn't join that server.",
              );
            } finally {
              setJoining(false);
            }
          }}
        >
          {joining ? (
            <Loader2 className="size-4 animate-spin" />
          ) : invite.isMember ? (
            "Open it"
          ) : (
            "Accept invite"
          )}
        </Button>

        {!inApp && (
          <Button
            variant="outline"
            className="w-full"
            // Assigning rather than opening a tab: the browser hands the URL to
            // the OS and, if nothing is registered for the scheme, simply does
            // nothing — which is the right outcome for someone who hasn't
            // installed the app.
            onClick={() => window.location.assign(inviteDeepLink(code))}
          >
            <MonitorDown className="size-4" />
            Open in the Crystal app
          </Button>
        )}
      </div>
    </div>
  );
}

export default function InvitePage() {
  const [code, setCode] = useState<string | null | undefined>(undefined);

  // On mount, not during render: the code lives in `window.location`, which
  // doesn't exist while this is being prerendered into a static file.
  useEffect(() => {
    setCode(codeFromLocation());
  }, []);

  return (
    <main className="dark flex min-h-screen items-center justify-center bg-background p-6">
      {code === undefined ? (
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      ) : code === null ? (
        <div className="text-center">
          <h1 className="text-xl font-semibold">No invite here</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            An invite link looks like{" "}
            <code className="font-mono">/invite/abc123</code>.
          </p>
        </div>
      ) : (
        <>
          <Show when="signed-out">
            <div className="w-full max-w-sm space-y-4">
              <p className="text-center text-sm text-muted-foreground">
                Sign in to accept this invite.
              </p>
              <SignIn
                // Back here afterwards, invite and all, rather than to the
                // app's front page with the invitation lost.
                forceRedirectUrl={
                  typeof window === "undefined" ? undefined : window.location.href
                }
              />
            </div>
          </Show>
          <Show when="signed-in">
            <InviteCard code={code} />
          </Show>
        </>
      )}
    </main>
  );
}

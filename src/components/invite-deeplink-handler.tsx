"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNavigation } from "@/components/home/navigation-context";
import { getDesktopAPI } from "@/lib/desktop";
import { parseInviteCode } from "@/lib/invites";

/**
 * Invites arriving from outside the app.
 *
 * Two doors into the same dialog. On the desktop, the OS hands over a
 * `crystal://invite/<code>` link — clicked in a browser, in another chat app,
 * anywhere. On the web, the app may have been loaded at `/?invite=<code>`,
 * which is where the invite page sends someone who was already signed in.
 *
 * It asks rather than joining outright: a link can be clicked by accident, and
 * silently adding somebody to a server is not something to do without a
 * sentence of confirmation.
 */
export function InviteDeepLinkHandler() {
  const [code, setCode] = useState<string | null>(null);
  const invite = useQuery(api.communities.resolveInvite, code ? { code } : "skip");
  const joinByInviteCode = useMutation(api.communities.joinByInviteCode);
  const { openCommunity } = useNavigation();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The URL the app was opened with, for the web hand-off. Cleared from the
    // address bar afterwards so a refresh doesn't re-prompt.
    const fromQuery = new URLSearchParams(window.location.search).get("invite");
    const parsed = fromQuery ? parseInviteCode(fromQuery) : null;
    if (parsed) {
      setCode(parsed);
      const url = new URL(window.location.href);
      url.searchParams.delete("invite");
      window.history.replaceState(null, "", url.toString());
    }

    return getDesktopAPI()?.invites?.onOpen((next) => {
      const valid = parseInviteCode(next);
      if (valid) setCode(valid);
    });
  }, []);

  const close = () => {
    setCode(null);
    setError(null);
  };

  const accept = async () => {
    if (!code) return;
    setJoining(true);
    setError(null);
    try {
      const communityId = (await joinByInviteCode({ code })) as Id<"communities">;
      close();
      openCommunity(communityId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't join that server.");
    } finally {
      setJoining(false);
    }
  };

  return (
    <Dialog open={!!code} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {invite ? `Join ${invite.name}?` : "Invitation"}
          </DialogTitle>
          <DialogDescription>
            {invite === undefined
              ? "Checking that invite…"
              : invite === null
                ? "That invite doesn't work any more — it may have been regenerated."
                : invite.isMember
                  ? "You're already in this server."
                  : `${invite.memberCount} ${
                      invite.memberCount === 1 ? "member" : "members"
                    }.`}
          </DialogDescription>
        </DialogHeader>

        {invite && (
          <div className="flex items-center gap-3">
            <Avatar className="size-12 rounded-xl">
              <AvatarImage
                src={invite.imageUrl}
                alt={invite.name}
                className="rounded-xl"
              />
              <AvatarFallback>
                {invite.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <p className="min-w-0 flex-1 truncate font-medium">{invite.name}</p>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>
            {invite === null ? "Close" : "Not now"}
          </Button>
          {invite && (
            <Button disabled={joining} onClick={() => void accept()}>
              {joining ? (
                <Loader2 className="size-4 animate-spin" />
              ) : invite.isMember ? (
                "Open it"
              ) : (
                "Join"
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

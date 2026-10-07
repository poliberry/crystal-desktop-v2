"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useNavigation } from "@/components/home/navigation-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CREATOR_PLATFORM_LIST } from "@/lib/community-kinds";
import { VERIFY_EVENT, type VerifyRequest } from "@/lib/members-only";

/**
 * The step between "this invite is members-only" and being in: connect the
 * platform account, let Crystal ask the platform, and join if it says yes.
 * Mounted once; opened by `requestMembershipVerification`.
 */
export function VerifyMembershipHost() {
  const [request, setRequest] = useState<VerifyRequest | null>(null);
  const [need, setNeed] = useState<{ communityName: string; platform: string | null } | null>(null);
  const [busy, setBusy] = useState<"connect" | "check" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requirement = useAction(api.creatorCommunities.inviteRequirement);
  const verify = useAction(api.creatorCommunities.verifyForInvite);
  const start = useAction(api.connectedAccounts.start);
  const join = useMutation(api.communities.joinByInviteCode);
  const accounts = useQuery(api.connectedAccounts.mine);
  const nav = useNavigation();

  useEffect(() => {
    const onRequest = (event: Event) => {
      setRequest((event as CustomEvent<VerifyRequest>).detail);
      setNeed(null);
      setMessage(null);
    };
    window.addEventListener(VERIFY_EVENT, onRequest);
    return () => window.removeEventListener(VERIFY_EVENT, onRequest);
  }, []);

  useEffect(() => {
    if (!request) return;
    requirement({ code: request.code })
      .then((r) => setNeed(r ? { communityName: r.communityName, platform: r.platform } : null))
      .catch(() => setNeed(null));
  }, [request, requirement]);

  const platform = CREATOR_PLATFORM_LIST.find((p) => p.id === need?.platform);
  const connected = accounts?.accounts.find((a) => a.provider === platform?.id);
  const available = !!platform && accounts?.available.includes(platform.id);

  const check = async () => {
    if (!request) return;
    setBusy("check");
    setMessage(null);
    try {
      const result = await verify({ code: request.code });
      if (!result.member) {
        setMessage(result.reason ?? "The platform doesn't list you as a member.");
        return;
      }
      const communityId = (await join({ code: request.code })) as Id<"communities">;
      request.onJoined?.(communityId);
      nav.openCommunityOverview(communityId);
      setRequest(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message.replace(/^.*Error:\s*/, "").split("\n")[0] : "Couldn't check right now.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && setRequest(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{need ? `${need.communityName} is for members` : "Members only"}</DialogTitle>
          <DialogDescription>
            {platform
              ? `You need to be a ${platform.label} member of this channel. Connect your ${platform.label} account and Crystal will check — it never sees your password.`
              : "This community is for members of its channel."}
          </DialogDescription>
        </DialogHeader>
        {message && <p className="text-sm text-destructive">{message}</p>}
        {platform && !available && <p className="text-sm text-muted-foreground">{platform.label} can&apos;t be connected on this version of Crystal yet.</p>}
        <DialogFooter>
          {platform && available && !connected && (
            <Button
              disabled={busy !== null}
              onClick={async () => {
                setBusy("connect");
                try {
                  window.open((await start({ provider: platform.id, purpose: "identity" })).url, "_blank", "noopener,noreferrer");
                } catch (e) {
                  setMessage(e instanceof Error ? e.message.replace(/^.*Error:\s*/, "").split("\n")[0] : "Couldn't start that.");
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === "connect" && <Loader2 className="animate-spin" />} Connect {platform.label}
            </Button>
          )}
          {platform && connected && (
            <Button disabled={busy !== null} onClick={() => void check()}>
              {busy === "check" && <Loader2 className="animate-spin" />} Check my membership
            </Button>
          )}
          {platform && available && !connected && (
            <Button variant="secondary" disabled={busy !== null} onClick={() => void check()}>
              I&apos;ve connected — check
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

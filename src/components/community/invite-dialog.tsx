"use client";

import { useMutation } from "convex/react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { inviteUrl } from "@/lib/invites";

interface InviteDialogProps {
  communityId: Id<"communities">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}


export function InviteDialog({ communityId, open, onOpenChange }: InviteDialogProps) {
  const getOrCreateInviteCode = useMutation(api.communities.getOrCreateInviteCode);
  const regenerateInviteCode = useMutation(api.communities.regenerateInviteCode);
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCode(null);
    setCopied(false);
  }, [communityId]);

  useEffect(() => {
    if (!open || code !== null || loading) return;
    setLoading(true);
    void getOrCreateInviteCode({ communityId })
      .then(setCode)
      .finally(() => setLoading(false));
    // Only re-run when the dialog opens or the code is cleared, not on every loading flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, communityId, code]);

  const handleRegenerate = async () => {
    setLoading(true);
    try {
      setCode(await regenerateInviteCode({ communityId }));
      setCopied(false);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(inviteUrl(code));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite people</DialogTitle>
          <DialogDescription>
            Share this link anywhere. It opens Crystal if it&apos;s installed and the
            web app if it isn&apos;t — and pasted into a message here, it renders as a
            join embed.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input readOnly value={code ? inviteUrl(code) : "Generating…"} className="font-mono" />
          <Button size="icon" variant="secondary" disabled={!code || loading} onClick={() => void handleCopy()}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </Button>
          <Button size="icon" variant="secondary" disabled={loading} onClick={() => void handleRegenerate()}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Regenerating replaces the code above — anyone with the old one won't be able to join.
        </p>
      </DialogContent>
    </Dialog>
  );
}

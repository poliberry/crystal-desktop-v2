"use client";

import { useMutation } from "convex/react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useState } from "react";

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

interface InviteDialogProps {
  communityId: Id<"communities">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const INVITE_PREFIX = "joincrystal:";

export function InviteDialog({ communityId, open, onOpenChange }: InviteDialogProps) {
  const getOrCreateInviteCode = useMutation(api.communities.getOrCreateInviteCode);
  const regenerateInviteCode = useMutation(api.communities.regenerateInviteCode);
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const ensureCode = async () => {
    setLoading(true);
    try {
      setCode(await getOrCreateInviteCode({ communityId }));
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (next && code === null && !loading) void ensureCode();
  };

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
    await navigator.clipboard.writeText(`${INVITE_PREFIX}${code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite people</DialogTitle>
          <DialogDescription>
            Share this code, or paste it into a message as-is — it'll render as a clickable join
            embed for anyone who sees it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input readOnly value={code ? `${INVITE_PREFIX}${code}` : "Generating..."} className="font-mono" />
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

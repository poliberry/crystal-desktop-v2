"use client";

import { useMutation, useQuery } from "convex/react";
import { Megaphone, Newspaper, Send, X } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface FollowChannelDialogProps {
  channel: { id: Id<"channels">; name: string };
  onClose: () => void;
}

/**
 * Follow an announcements channel: into your Home newsfeed, or into a channel of a community you
 * run. Lists what you already follow it with, so ending one is in the same place as starting one.
 */
export function FollowChannelDialog({ channel, onClose }: FollowChannelDialogProps) {
  const follows = (useQuery(api.announcements.listMine) ?? []).filter((f) => f.channelId === channel.id);
  const targets = useQuery(api.announcements.followTargets) ?? [];
  const follow = useMutation(api.announcements.follow);
  const unfollow = useMutation(api.announcements.unfollow);

  const [communityId, setCommunityId] = useState<string>("");
  const [targetId, setTargetId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFeed = follows.find((f) => f.kind === "feed");
  const forwards = follows.filter((f) => f.kind === "channel");
  const community = targets.find((t) => t.communityId === communityId);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="size-4" />
            Follow #{channel.name}
          </DialogTitle>
          <DialogDescription>Get its announcements in your Home newsfeed, or passed on into one of your own channels.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-lg border p-3">
          <Newspaper className="size-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">My newsfeed</p>
            <p className="text-xs text-muted-foreground">Shown on your Home page with everything else you follow.</p>
          </div>
          {inFeed ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => unfollow({ followId: inFeed.id }))}>
              Following
            </Button>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => void run(() => follow({ channelId: channel.id, kind: "feed" }))}>
              Follow
            </Button>
          )}
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center gap-3">
            <Send className="size-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Send to a channel</p>
              <p className="text-xs text-muted-foreground">Each announcement is copied into a channel of a community you manage.</p>
            </div>
          </div>
          {targets.length === 0 ? (
            <p className="text-xs text-muted-foreground">You don't manage channels in any community yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Community</Label>
                <Select
                  value={communityId}
                  onValueChange={(value) => {
                    setCommunityId(value);
                    setTargetId("");
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent>
                    {targets.map((t) => (
                      <SelectItem key={t.communityId} value={t.communityId}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Channel</Label>
                <Select value={targetId} onValueChange={setTargetId} disabled={!community}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(community?.channels ?? [])
                      .filter((c) => c.id !== channel.id && !c.isAnnouncement)
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          # {c.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="col-span-2"
                size="sm"
                disabled={!targetId || busy}
                onClick={() =>
                  void run(async () => {
                    await follow({ channelId: channel.id, kind: "channel", targetChannelId: targetId as Id<"channels"> });
                    setTargetId("");
                  })
                }
              >
                Send announcements there
              </Button>
            </div>
          )}

          {forwards.length > 0 && (
            <ul className="space-y-1 border-t pt-2">
              {forwards.map((f) => (
                <li key={f.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    # {f.targetChannelName} <span className="text-muted-foreground">· {f.targetCommunityName}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label="Stop sending there"
                    disabled={busy}
                    onClick={() => void run(() => unfollow({ followId: f.id }))}
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

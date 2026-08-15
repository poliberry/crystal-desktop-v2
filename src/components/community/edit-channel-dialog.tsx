"use client";

import { useMutation } from "convex/react";
import { useEffect, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface EditChannelDialogProps {
  channel: { id: Id<"channels">; name: string; topic?: string; type: "text" | "voice" } | null;
  onOpenChange: (open: boolean) => void;
}

export function EditChannelDialog({ channel, onOpenChange }: EditChannelDialogProps) {
  const update = useMutation(api.channels.update);
  const remove = useMutation(api.channels.remove);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (channel) {
      setName(channel.name);
      setTopic(channel.topic ?? "");
      setConfirmDelete(false);
      setError(null);
    }
  }, [channel]);

  if (!channel) return null;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await update({ channelId: channel.id, name, topic: channel.type === "text" ? topic : undefined });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    await remove({ channelId: channel.id });
    onOpenChange(false);
  };

  return (
    <Dialog open={!!channel} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {channel.type} channel</DialogTitle>
          <DialogDescription>Update this channel's details, or delete it entirely.</DialogDescription>
        </DialogHeader>

        {confirmDelete ? (
          <>
            <p className="text-sm text-muted-foreground">
              Delete <span className="font-medium text-foreground">#{channel.name}</span>? This deletes every
              message in it and can&apos;t be undone.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void handleDelete()}>
                Delete channel
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-channel-name">Name</Label>
                <Input
                  id="edit-channel-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={64}
                />
              </div>
              {channel.type === "text" && (
                <div className="space-y-1.5">
                  <Label htmlFor="edit-channel-topic">Topic</Label>
                  <Input
                    id="edit-channel-topic"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="Optional"
                    maxLength={256}
                  />
                </div>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                Delete channel
              </Button>
              <Button disabled={!name.trim() || saving} onClick={() => void handleSave()}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

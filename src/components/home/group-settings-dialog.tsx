"use client";

import { useMutation } from "convex/react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { GroupAvatar } from "@/components/home/group-avatar";
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

/** Matches the server's limit, so an over-long name is stopped by the input
 * rather than by a thrown error after the fact. */
const MAX_GROUP_NAME_LENGTH = 64;

interface GroupSettingsDialogProps {
  conversationId: Id<"conversations">;
  name: string | null;
  imageUrl?: string;
  members: { name: string; imageUrl?: string }[];
  /** What the group is called when it has no name of its own — shown as the
   * input's placeholder so clearing the field reads as a choice, not a gap. */
  fallbackName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Rename a group DM and change its icon.
 *
 * Every member can edit both: a group has no roles, so the person who created
 * it isn't its owner in any sense the rest of the app recognises.
 */
export function GroupSettingsDialog({
  conversationId,
  name,
  imageUrl,
  members,
  fallbackName,
  open,
  onOpenChange,
}: GroupSettingsDialogProps) {
  const renameGroup = useMutation(api.conversations.renameGroup);
  const generateUploadUrl = useMutation(api.conversations.generateGroupIconUploadUrl);
  const setGroupIcon = useMutation(api.conversations.setGroupIcon);
  const removeGroupIcon = useMutation(api.conversations.removeGroupIcon);

  const [draftName, setDraftName] = useState(name ?? "");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keyed on `open` alone, deliberately: re-seeding whenever `name` changes
  // would let a rename landing from another member overwrite what's being
  // typed here mid-edit.
  const seededName = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      seededName.current = null;
      return;
    }
    if (seededName.current !== null) return;
    seededName.current = name ?? "";
    setDraftName(name ?? "");
    setError(null);
  }, [open, name]);

  const handleIconPick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await setGroupIcon({ conversationId, storageId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload icon.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await renameGroup({ conversationId, name: draftName });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Group settings</DialogTitle>
          <DialogDescription>
            Anyone in the group can change its name and icon.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void handleIconPick(e.target.files?.[0])}
        />

        <div className="flex items-center gap-4">
          <div className="group relative shrink-0">
            <GroupAvatar size="xl" imageUrl={imageUrl} members={members} />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Change group icon"
              className="absolute inset-0 p-2 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-100"
            >
              {uploading ? (
                <Loader2 className="size-6 animate-spin text-white" />
              ) : (
                <Camera className="size-6 text-white" />
              )}
            </button>
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="group-name">Group name</Label>
            <Input
              id="group-name"
              value={draftName}
              maxLength={MAX_GROUP_NAME_LENGTH}
              placeholder={fallbackName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave();
              }}
            />
            <p className="text-xs text-muted-foreground">
              Leave it empty to go back to listing everyone in the group.
            </p>
          </div>
        </div>

        {imageUrl && (
          <Button
            variant="ghost"
            size="sm"
            className="w-fit gap-1.5 text-muted-foreground"
            onClick={() => void removeGroupIcon({ conversationId })}
          >
            <Trash2 className="size-4" />
            Remove icon
          </Button>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving || draftName === (name ?? "")} onClick={() => void handleSave()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

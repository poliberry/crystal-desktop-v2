"use client";

import { useMutation } from "convex/react";
import { Hash, Volume2 } from "lucide-react";
import { useState } from "react";

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
import { cn } from "@/lib/utils";

interface CreateChannelDialogProps {
  communityId: Id<"communities">;
  categoryId?: Id<"channelCategories">;
  defaultType?: "text" | "voice";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateChannelDialog({
  communityId,
  categoryId,
  defaultType = "text",
  open,
  onOpenChange,
}: CreateChannelDialogProps) {
  const create = useMutation(api.channels.create);
  const [type, setType] = useState<"text" | "voice">(defaultType);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await create({ communityId, name, type, categoryId });
      onOpenChange(false);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a channel</DialogTitle>
          <DialogDescription>
            {type === "text"
              ? "A place for text conversation."
              : "A place people can join to talk with voice/video."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setType("text")}
            className={cn(
              "flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-sm",
              type === "text" ? "border-primary bg-primary/10" : "text-muted-foreground"
            )}
          >
            <Hash className="size-4" /> Text
          </button>
          <button
            type="button"
            onClick={() => setType("voice")}
            className={cn(
              "flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-sm",
              type === "voice" ? "border-primary bg-primary/10" : "text-muted-foreground"
            )}
          >
            <Volume2 className="size-4" /> Voice
          </button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="channel-name">Name</Label>
          <Input
            id="channel-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === "text" ? "general" : "General Voice"}
            maxLength={64}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button disabled={!name.trim() || creating} onClick={() => void handleCreate()}>
            {creating ? "Creating…" : "Create channel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

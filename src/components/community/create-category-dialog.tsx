"use client";

import { useMutation } from "convex/react";
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

interface CreateCategoryDialogProps {
  communityId: Id<"communities">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateCategoryDialog({ communityId, open, onOpenChange }: CreateCategoryDialogProps) {
  const create = useMutation(api.channelCategories.create);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await create({ communityId, name });
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
          <DialogTitle>Create a category</DialogTitle>
          <DialogDescription>Groups channels together under a shared, draggable header.</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="category-name">Name</Label>
          <Input
            id="category-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Info"
            maxLength={64}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button disabled={!name.trim() || creating} onClick={() => void handleCreate()}>
            {creating ? "Creating…" : "Create category"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

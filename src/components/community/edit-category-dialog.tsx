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

interface EditCategoryDialogProps {
  category: { id: Id<"channelCategories">; name: string } | null;
  onOpenChange: (open: boolean) => void;
}

export function EditCategoryDialog({ category, onOpenChange }: EditCategoryDialogProps) {
  const rename = useMutation(api.channelCategories.rename);
  const remove = useMutation(api.channelCategories.remove);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (category) {
      setName(category.name);
      setConfirmDelete(false);
    }
  }, [category]);

  if (!category) return null;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await rename({ categoryId: category.id, name });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    await remove({ categoryId: category.id });
    onOpenChange(false);
  };

  return (
    <Dialog open={!!category} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit category</DialogTitle>
          <DialogDescription>
            Deleting a category doesn't delete its channels — they become uncategorized.
          </DialogDescription>
        </DialogHeader>

        {confirmDelete ? (
          <>
            <p className="text-sm text-muted-foreground">
              Delete <span className="font-medium text-foreground">{category.name}</span>?
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void handleDelete()}>
                Delete category
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="edit-category-name">Name</Label>
              <Input id="edit-category-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
            </div>
            <DialogFooter className="sm:justify-between">
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                Delete category
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

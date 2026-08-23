"use client";

import { useMutation } from "convex/react";
import { Plus } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface CreateCommunityDialogProps {
  onCreated: (communityId: Id<"communities">) => void;
  /** When provided, the dialog is controlled externally (no built-in trigger button). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function CreateCommunityDialog({ onCreated, open: controlledOpen, onOpenChange }: CreateCommunityDialogProps) {
  const create = useMutation(api.communities.create);
  const [internalOpen, setInternalOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen;

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const communityId = await create({ name });
      setOpen(false);
      setName("");
      onCreated(communityId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTrigger asChild>
                <Button variant="secondary" size="icon" className="size-12 rounded-none">
                  <Plus />
                </Button>
              </DialogTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">Create a community</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a community</DialogTitle>
          <DialogDescription>
            You'll get a default "general" text channel and a voice channel to start with.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="community-name">Name</Label>
          <Input
            id="community-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Silver Skies"
            maxLength={64}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button disabled={!name.trim() || creating} onClick={() => void handleCreate()}>
            {creating ? "Creating…" : "Create community"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

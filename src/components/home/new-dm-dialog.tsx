"use client";

import { useMutation, useQuery } from "convex/react";
import { MessageSquarePlus } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface NewDmDialogProps {
  onCreated: (conversationId: Id<"conversations">) => void;
}

export function NewDmDialog({ onCreated }: NewDmDialogProps) {
  const friends = useQuery(api.friends.listFriends) ?? [];
  const getOrCreateDirect = useMutation(api.conversations.getOrCreateDirect);
  const createGroup = useMutation(api.conversations.createGroup);

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<Id<"users">>>(new Set());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: Id<"users">) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const reset = () => {
    setSelected(new Set());
    setError(null);
  };

  const handleCreate = async () => {
    if (selected.size === 0) return;
    setCreating(true);
    setError(null);
    try {
      const ids = Array.from(selected);
      const conversationId =
        ids.length === 1
          ? await getOrCreateDirect({ friendId: ids[0] })
          : await createGroup({ memberIds: ids });
      setOpen(false);
      reset();
      onCreated(conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7">
          <MessageSquarePlus className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>
            Pick a friend for a direct message, or a few for a group DM.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-72">
          <div className="flex flex-col gap-1 pr-3">
            {friends.length === 0 && (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                Add some friends first.
              </p>
            )}
            {friends.map((friend) => (
              <label
                key={friend.id}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/60"
              >
                <Checkbox checked={selected.has(friend.id)} onCheckedChange={() => toggle(friend.id)} />
                <Avatar size="sm">
                  <AvatarImage src={friend.imageUrl} alt={friend.name} />
                  <AvatarFallback>{friend.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{friend.name}</p>
                  <p className="truncate text-xs text-muted-foreground">@{friend.username}</p>
                </div>
              </label>
            ))}
          </div>
        </ScrollArea>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button disabled={selected.size === 0 || creating} onClick={() => void handleCreate()}>
            {creating
              ? "Starting…"
              : selected.size > 1
                ? `Start group DM (${selected.size})`
                : "Start DM"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useMutation, useQuery } from "convex/react";
import { X } from "lucide-react";
import { useMemo, useState } from "react";

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
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MAX_GROUP_MEMBERS } from "@/lib/group-limits";
import { MessageSquarePlusIcon } from "@animateicons/react/lucide";

interface NewDmDialogProps {
  onCreated: (conversationId: Id<"conversations">) => void;
}

export function NewDmDialog({ onCreated }: NewDmDialogProps) {
  const friends = useQuery(api.friends.listFriends) ?? [];
  const getOrCreateDirect = useMutation(api.conversations.getOrCreateDirect);
  const createGroup = useMutation(api.conversations.createGroup);

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<Id<"users">>>(new Set());
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredFriends = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter(
      (friend) =>
        friend.name.toLowerCase().includes(q) ||
        friend.username.toLowerCase().includes(q),
    );
  }, [friends, query]);

  const selectedFriends = useMemo(
    () => friends.filter((friend) => selected.has(friend.id)),
    [friends, selected],
  );

  // A group holds MAX_GROUP_MEMBERS including you, so the picker stops one
  // short of it. Enforced again in the mutation — see createGroup.
  const atLimit = selected.size + 1 >= MAX_GROUP_MEMBERS;

  const toggle = (id: Id<"users">) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (!atLimit) next.add(id);
      return next;
    });
  };

  const reset = () => {
    setSelected(new Set());
    setQuery("");
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
          <MessageSquarePlusIcon duration={0.8} className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>
            Pick a friend for a direct message, or a few for a group DM — up to{" "}
            {MAX_GROUP_MEMBERS} people including you.
          </DialogDescription>
        </DialogHeader>

        <Input
          placeholder="Search friends…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        <ScrollArea className="h-72">
          <div className="flex flex-col gap-1 pr-3">
            {friends.length === 0 && (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                Add some friends first.
              </p>
            )}
            {friends.length > 0 && filteredFriends.length === 0 && (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                No friends match “{query.trim()}”.
              </p>
            )}
            {filteredFriends.map((friend) => (
              <label
                key={friend.id}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/60"
              >
                <Checkbox
                  checked={selected.has(friend.id)}
                  disabled={atLimit && !selected.has(friend.id)}
                  onCheckedChange={() => toggle(friend.id)}
                />
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

        <DialogFooter className="sm:items-center sm:justify-between">
          {selectedFriends.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedFriends.map((friend) => (
                <span
                  key={friend.id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent py-0.5 pr-1 pl-1 text-xs font-medium"
                >
                  <Avatar className="size-5">
                    <AvatarImage src={friend.imageUrl} alt={friend.name} />
                    <AvatarFallback className="text-[9px]">
                      {friend.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  {friend.name}
                  <button
                    type="button"
                    aria-label={`Remove ${friend.name}`}
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                    onClick={() => toggle(friend.id)}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <Button
            className="sm:ml-auto"
            disabled={selected.size === 0 || creating}
            onClick={() => void handleCreate()}
          >
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

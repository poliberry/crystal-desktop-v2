"use client";

import { useMutation } from "convex/react";
import { UserPlus } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
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

export function AddFriendDialog() {
  const sendFriendRequest = useMutation(api.friends.sendFriendRequest);
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const reset = () => {
    setUsername("");
    setError(null);
    setSuccess(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await sendFriendRequest({ username });
      setSuccess(result.status === "accepted" ? "You're now friends!" : "Friend request sent.");
      setUsername("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
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
        <Button size="sm" className="gap-1.5">
          <UserPlus className="size-4" />
          Add Friend
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add friend</DialogTitle>
            <DialogDescription>
              You can send a friend request using their exact username.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5 py-4">
            <Label htmlFor="add-friend-username">Username</Label>
            <Input
              id="add-friend-username"
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && <p className="text-sm text-emerald-500">{success}</p>}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={sending || !username.trim()}>
              {sending ? "Sending…" : "Send friend request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

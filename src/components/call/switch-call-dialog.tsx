"use client";

import { useQuery } from "convex/react";
import { Headphones, PhoneOff } from "lucide-react";
import { useEffect, useRef } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * "Are you sure you want to join Lounge?" — asked when you try to join a voice channel while you are already in a call,
 * because joining ends the call you are in. Yes plays the leave sound, leaves, and joins; anything else (No, Escape, a click
 * outside) leaves everything as it was.
 *
 * Names the channel being joined, and says what will happen to the call you are in, so the question is answerable without
 * having to remember what you clicked.
 */
export function SwitchCallDialog({
  target,
  current,
  onAnswer,
}: {
  /** The channel being joined, or null when there is nothing to ask. */
  target: { channelId: Id<"channels"> } | null;
  /** The call you are in now, for saying what you'd be leaving. */
  current: { kind: "dm" } | { kind: "channel"; channelId: Id<"channels"> } | null;
  onAnswer: (join: boolean) => void;
}) {
  const next = useQuery(api.channels.get, target ? { channelId: target.channelId } : "skip");
  const now = useQuery(api.channels.get, current?.kind === "channel" ? { channelId: current.channelId } : "skip");
  const yes = useRef<HTMLButtonElement>(null);
  const open = target !== null;
  // Enter answers yes: the focus starts on it.
  useEffect(() => {
    if (open) yes.current?.focus();
  }, [open]);

  const name = next?.name ? `${next.name}` : "this channel";
  const where = next?.communityName ? ` in ${next.communityName}` : "";
  const leaving = current?.kind === "dm" ? "your current call" : now?.name ? `${now.name}` : "your current call";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onAnswer(false)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Are you sure you want to join {name}?</DialogTitle>
          <DialogDescription>
            You&apos;re in a call right now. Joining{next?.name ? ` ${name}${where}` : ""} will disconnect you from {leaving}.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onAnswer(false)}>
            <PhoneOff className="size-4" /> Stay in the call
          </Button>
          <Button ref={yes} onClick={() => onAnswer(true)}>
            <Headphones className="size-4" /> Yes, join {next?.name ? name : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

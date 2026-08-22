"use client";

import { useMutation, useQuery } from "convex/react";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../convex/_generated/api";
import { PresenceDot } from "@/components/presence-dot";
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
import { useMyPresence, useSetPresenceStatus } from "@/hooks/use-presence";
import { STATUS_LABEL, type ManualStatus } from "@/lib/presence";
import { cn } from "@/lib/utils";

const MANUAL_STATUSES: ManualStatus[] = ["online", "idle", "dnd", "invisible"];

const STATUS_HINT: Record<ManualStatus, string> = {
  online: "Visible to everyone.",
  idle: "Shown as away.",
  dnd: "Notifications are suppressed.",
  invisible: "You'll appear offline, and your activity stays private.",
};

/** Custom status has to fit a member-list row without swallowing it. */
const MAX_CUSTOM_STATUS = 128;

/**
 * Setting your custom status and presence.
 *
 * This used to be a dropdown hanging off the custom-status pill on your own
 * profile card, which meant it was only reachable if you *already had* a
 * custom status set — there was no way in to write the first one. As a dialog
 * it can be opened from anywhere, and the user card's name is the obvious
 * second entry point.
 */
export function StatusDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { manualStatus } = useMyPresence();
  const setStatus = useSetPresenceStatus();
  const updateProfileExtended = useMutation(api.users.updateProfileExtended);

  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // Seed from the server each time it opens rather than once at mount — the
  // dialog stays mounted between openings, so a status changed elsewhere (or
  // in the other window) would otherwise show stale.
  const me = useQuery(api.users.getCurrentUser);
  const currentCustomStatus = me?.customStatus;
  useEffect(() => {
    if (open) setDraft(currentCustomStatus ?? "");
  }, [open, currentCustomStatus]);

  /**
   * Always sends a string, never `undefined`: Convex drops undefined fields
   * from the arguments entirely, so the mutation couldn't tell "clear this"
   * apart from "leave it alone" and clearing silently did nothing. An empty
   * string is the clear signal — the mutation maps it back to undefined and
   * deletes the field.
   */
  const save = async (value: string) => {
    setSaving(true);
    try {
      await updateProfileExtended({ customStatus: value });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set your status</DialogTitle>
          <DialogDescription>
            Your status and custom message are visible to everyone who can see your profile.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="custom-status">Custom status</Label>
          <Input
            id="custom-status"
            value={draft}
            maxLength={MAX_CUSTOM_STATUS}
            placeholder="What's on your mind?"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save(draft.trim());
              }
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Presence</Label>
          <div className="flex flex-col gap-0.5">
            {MANUAL_STATUSES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent",
                  manualStatus === value && "bg-accent"
                )}
              >
                <PresenceDot status={value} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{STATUS_LABEL[value]}</span>
                  <span className="block text-xs text-muted-foreground">{STATUS_HINT[value]}</span>
                </span>
                {manualStatus === value && <Check className="size-4 shrink-0 text-primary" />}
              </button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            disabled={saving || !draft}
            onClick={() => void save("")}
          >
            Clear status
          </Button>
          <Button disabled={saving} onClick={() => void save(draft.trim())}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


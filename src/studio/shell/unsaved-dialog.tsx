"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * "Save changes to X before closing?" — asked wherever Studio would otherwise throw unsaved work
 * away: closing a project tab, closing a file with edits, closing the window. Save can fail (a file
 * changed on disk, a full disk); then the dialog stays up with the reason instead of closing over it.
 */
export function UnsavedDialog({
  name,
  what = "changes",
  onAnswer,
}: {
  /** What has the changes: a project or file name. `null` hides the dialog. */
  name: string | null;
  what?: string;
  onAnswer: (answer: "save" | "discard" | "cancel") => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answer = async (a: "save" | "discard" | "cancel") => {
    setError(null);
    if (a === "cancel") return void onAnswer(a);
    setBusy(true);
    try {
      await onAnswer(a);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "") : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={name !== null} onOpenChange={(open) => !open && !busy && void answer("cancel")}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Save {what} to “{name}”?</DialogTitle>
          <DialogDescription>If you don&apos;t save, your changes are lost.</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => void answer("cancel")}>
            Cancel
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void answer("discard")}>
            Don&apos;t save
          </Button>
          <Button disabled={busy} onClick={() => void answer("save")}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

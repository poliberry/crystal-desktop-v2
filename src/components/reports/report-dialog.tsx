"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { CheckCircle2, Flag, Loader2 } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

export type ReportTarget = {
  type: "user" | "message" | "channelMessage" | "community";
  id: string;
  /** What to call it in the dialog: a name, "this message". */
  label: string;
};

const CATEGORIES = [
  { id: "spam", label: "Spam", hint: "Unwanted ads, links or repeated messages" },
  { id: "harassment", label: "Harassment or bullying", hint: "Targeting, threatening or demeaning someone" },
  { id: "hate", label: "Hate", hint: "Attacking people for who they are" },
  { id: "sexual", label: "Sexual content", hint: "Explicit or unwanted sexual material" },
  { id: "violence", label: "Violence or threats", hint: "Graphic violence, or threats to hurt someone" },
  { id: "self_harm", label: "Self-harm", hint: "Someone who may be at risk" },
  { id: "impersonation", label: "Impersonation", hint: "Pretending to be someone else" },
  { id: "scam", label: "Scam or fraud", hint: "Trying to trick people out of money or accounts" },
  { id: "other", label: "Something else", hint: "Anything that doesn't fit above" },
] as const;

type Category = (typeof CATEGORIES)[number]["id"];

/**
 * Reporting a person, a message or a community to Crystal's staff.
 *
 * What gets sent is only *which* thing and why: the evidence (the message's text,
 * who wrote it, where) is captured on the server from the thing itself, so a
 * report can't carry words somebody made up. Staff see it in the console's
 * Reports queue.
 */
export function ReportDialog({
  target,
  onClose,
}: {
  target: ReportTarget | null;
  onClose: () => void;
}) {
  const create = useMutation(api.reports.create);
  const [category, setCategory] = useState<Category | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const close = () => {
    onClose();
    // After the close animation, so the form doesn't flash empty.
    window.setTimeout(() => {
      setCategory(null);
      setDetails("");
      setError(null);
      setSent(false);
    }, 200);
  };

  const submit = async () => {
    if (!target || !category) return;
    setBusy(true);
    setError(null);
    try {
      await create({ targetType: target.type, targetId: target.id, category, details: details.trim() || undefined });
      setSent(true);
    } catch (e) {
      setError(errorMessage(e, "Couldn't send that report."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="size-10 text-emerald-500" />
            <DialogTitle>Thanks for letting us know</DialogTitle>
            <DialogDescription>
              A moderator will look at your report. We won&apos;t tell {target?.label} it was you.
            </DialogDescription>
            <Button className="mt-2 w-full" onClick={close}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Flag className="size-4" /> Report {target?.label}
              </DialogTitle>
              <DialogDescription>What&apos;s wrong? Pick the closest one.</DialogDescription>
            </DialogHeader>
            <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className={cn(
                    "flex w-full flex-col rounded-lg border px-3 py-2 text-left transition-colors",
                    category === c.id ? "border-primary/60 bg-primary/10" : "border-foreground/10 hover:bg-foreground/5",
                  )}
                >
                  <span className="text-sm font-medium">{c.label}</span>
                  <span className="text-xs text-muted-foreground">{c.hint}</span>
                </button>
              ))}
            </div>
            <Textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Anything else a moderator should know? (optional)"
              maxLength={1000}
              className="min-h-16"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button disabled={!category || busy} onClick={() => void submit()}>
                {busy && <Loader2 className="animate-spin" />} Send report
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

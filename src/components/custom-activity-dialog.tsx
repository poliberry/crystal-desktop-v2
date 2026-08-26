"use client";

import { useMutation, useQuery } from "convex/react";
import { Loader2, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../convex/_generated/api";
import { RichPresenceCard } from "@/components/rich-presence-card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DURATION_OPTIONS } from "@/lib/presence-duration";
import type { RichPresenceActivityType } from "@/types/desktop-api";

const ACTIVITY_TYPES: { value: RichPresenceActivityType; label: string }[] = [
  { value: "playing", label: "Playing" },
  { value: "listening", label: "Listening to" },
  { value: "watching", label: "Watching" },
  { value: "streaming", label: "Streaming" },
];

/** Matches the server's cap, so over-long text is stopped by the field rather
 * than silently truncated on save. */
const MAX_TEXT = 128;
const MAX_BUTTON_LABEL = 32;
const MAX_BUTTONS = 2;

interface ButtonDraft {
  label: string;
  url: string;
}

/**
 * Write your own Rich Presence.
 *
 * The same card everyone else's detected games render into, except the user
 * fills it in: a verb, up to three lines of text, an image and up to two link
 * buttons. It lives on the profile rather than on the session, so it survives
 * closing the app and shows on a phone — and it can be given a deadline, which
 * is what keeps "streaming in 10 minutes" from being true a week later.
 */
export function CustomActivityDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const me = useQuery(api.users.getCurrentUser);
  const setCustomActivity = useMutation(api.presence.setCustomActivity);
  const clearCustomActivity = useMutation(api.presence.clearCustomActivity);

  const existing = me?.customActivity;

  const [type, setType] = useState<RichPresenceActivityType>("playing");
  const [name, setName] = useState("");
  const [details, setDetails] = useState("");
  const [state, setState] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [buttons, setButtons] = useState<ButtonDraft[]>([]);
  const [durationKey, setDurationKey] = useState<string>("never");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seeded when the dialog opens, not on every change to the stored activity:
  // it stays mounted between openings, and re-seeding live would fight with
  // whatever is being typed.
  useEffect(() => {
    if (!open) return;
    setType(existing?.type ?? "playing");
    setName(existing?.name ?? "");
    setDetails(existing?.details ?? "");
    setState(existing?.state ?? "");
    setImageUrl(existing?.imageUrl ?? "");
    setButtons(existing?.buttons?.map((b) => ({ label: b.label, url: b.url })) ?? []);
    setDurationKey("never");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** What the card will look like — the same component that renders it on a
   * profile, so there's nothing to keep in sync. */
  const preview = {
    type,
    name: name.trim() || "Your activity",
    details: details.trim() || undefined,
    state: state.trim() || undefined,
    imageUrl: imageUrl.trim() || undefined,
    buttons: buttons.filter((b) => b.label.trim() && b.url.trim()),
    startedAt: existing?.startedAt ?? Date.now(),
    source: "custom" as const,
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await setCustomActivity({
        type,
        name: name.trim(),
        details: details.trim() || undefined,
        state: state.trim() || undefined,
        imageUrl: imageUrl.trim() || undefined,
        buttons: buttons
          .filter((b) => b.label.trim() && b.url.trim())
          .map((b) => ({ label: b.label.trim(), url: b.url.trim() })),
        durationMs: DURATION_OPTIONS.find((o) => o.key === durationKey)?.ms,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that activity.");
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    setSaving(true);
    try {
      await clearCustomActivity();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Custom activity</DialogTitle>
          <DialogDescription>
            Shown on your profile ahead of anything Crystal detects, and it stays there
            whether or not the desktop app is running.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="w-36 shrink-0 space-y-1.5">
              <Label htmlFor="activity-type">Verb</Label>
              <Select
                value={type}
                onValueChange={(value) => setType(value as RichPresenceActivityType)}
              >
                <SelectTrigger id="activity-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVITY_TYPES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="activity-name">Name</Label>
              <Input
                id="activity-name"
                value={name}
                maxLength={MAX_TEXT}
                placeholder="Deep work"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="activity-details">First line</Label>
              <Input
                id="activity-details"
                value={details}
                maxLength={MAX_TEXT}
                placeholder="Optional"
                onChange={(e) => setDetails(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="activity-state">Second line</Label>
              <Input
                id="activity-state"
                value={state}
                maxLength={MAX_TEXT}
                placeholder="Optional"
                onChange={(e) => setState(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="activity-image">Image URL</Label>
            <Input
              id="activity-image"
              value={imageUrl}
              placeholder="https://…"
              onChange={(e) => setImageUrl(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Buttons</Label>
              {buttons.length < MAX_BUTTONS && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => setButtons((current) => [...current, { label: "", url: "" }])}
                >
                  <Plus className="size-3.5" />
                  Add button
                </Button>
              )}
            </div>
            {buttons.map((button, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={button.label}
                  maxLength={MAX_BUTTON_LABEL}
                  placeholder="Label"
                  className="w-36 shrink-0"
                  onChange={(e) =>
                    setButtons((current) =>
                      current.map((b, i) => (i === index ? { ...b, label: e.target.value } : b))
                    )
                  }
                />
                <Input
                  value={button.url}
                  placeholder="https://…"
                  onChange={(e) =>
                    setButtons((current) =>
                      current.map((b, i) => (i === index ? { ...b, url: e.target.value } : b))
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove button"
                  onClick={() =>
                    setButtons((current) => current.filter((_, i) => i !== index))
                  }
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="activity-duration">Clear after</Label>
            <Select value={durationKey} onValueChange={setDurationKey}>
              <SelectTrigger id="activity-duration" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Preview</Label>
            <RichPresenceCard activity={preview} />
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          {existing && (
            <Button variant="ghost" disabled={saving} onClick={() => void clear()}>
              Clear activity
            </Button>
          )}
          <Button disabled={saving || !name.trim()} onClick={() => void save()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

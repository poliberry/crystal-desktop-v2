"use client";

import { useMutation, useQuery } from "convex/react";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../convex/_generated/api";
import { MemberProfileCard } from "@/components/community/member-profile-card";
import { CustomActivityForm } from "@/components/custom-activity-dialog";
import { PresenceDot } from "@/components/presence-dot";
import { ACTIVITY_VERB } from "@/components/rich-presence-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DIALOG_MORPH_FRAME, DialogMorph } from "@/components/ui/dialog-morph";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WheelPicker } from "@/components/ui/wheel-picker";
import { ownDecorationState } from "@/lib/avatar-decorations";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMyPresence, useSetPresenceStatus } from "@/hooks/use-presence";
import { DURATION_OPTIONS, formatRemaining } from "@/lib/presence-duration";
import {
  MANUAL_STATUSES,
  STATUS_HINT,
  STATUS_LABEL,
  type FriendStatus,
  type ManualStatus,
} from "@/lib/presence";
import { cn } from "@/lib/utils";

/** The presence choices as wheel rows, each with its own dot. */
const PRESENCE_ITEMS = MANUAL_STATUSES.map((value) => ({
  value,
  label: STATUS_LABEL[value],
  leading: <PresenceDot status={value} inline />,
}));

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
  const { manualStatus, status } = useMyPresence();
  const setStatus = useSetPresenceStatus();
  const setCustomStatus = useMutation(api.users.setCustomStatus);

  const [draft, setDraft] = useState("");
  const [durationKey, setDurationKey] = useState("never");
  const [saving, setSaving] = useState(false);
  // Which view the dialog is showing. Custom activity is a view of this dialog,
  // not a second one: closing this to open that unpinned the dock, whose card —
  // and the second dialog with it — went away with it.
  const [view, setView] = useState<"status" | "activity">("status");

  // Seed from the server each time it opens rather than once at mount — the
  // dialog stays mounted between openings, so a status changed elsewhere (or
  // in the other window) would otherwise show stale.
  const me = useQuery(api.users.getCurrentUser);
  const currentCustomStatus = me?.customStatus;
  useEffect(() => {
    if (!open) return;
    setView("status");
    setDraft(currentCustomStatus ?? "");
    // Reset to "until I clear it" rather than guessing which preset a stored
    // deadline came from — the remaining time is shown as a hint instead.
    setDurationKey("never");
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
      await setCustomStatus({
        text: value,
        durationMs: DURATION_OPTIONS.find((o) => o.key === durationKey)?.ms,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  // The same frame-and-birthday resolution the user card applies to the raw
  // user document — see ownDecorationState.
  const { decoration, isBirthday } = ownDecorationState(me);

  const expiresAt = me?.customStatusExpiresAt;
  const remaining = expiresAt ? formatRemaining(expiresAt) : null;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(DIALOG_MORPH_FRAME, view === "status" ? "sm:max-w-3xl" : "sm:max-w-lg")}
      >
        <DialogMorph view={view} direction={view === "activity" ? 1 : -1} className="grid gap-4">
        {view === "activity" ? (
          <CustomActivityForm
            onBack={() => setView("status")}
            onClose={() => setView("status")}
          />
        ) : (
        <>
        <DialogHeader>
          <DialogTitle>Set your status</DialogTitle>
          <DialogDescription>
            Your status and custom message are visible to everyone who can see your profile.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
          <div className="min-w-0 space-y-5">
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
              <Select value={durationKey} onValueChange={setDurationKey}>
                <SelectTrigger className="w-full" aria-label="Clear status after">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.key === "never" ? option.label : `Clear after ${option.label}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {remaining && (
                <p className="text-xs text-muted-foreground">
                  Your current status clears in {remaining}. Saving replaces that with the choice
                  above.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Hidden while you&apos;re offline or invisible, and back when you return.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Custom activity</Label>
              <Button
                variant="secondary"
                className="w-full justify-start font-normal"
                onClick={() => setView("activity")}
              >
                <Sparkles className="size-4" />
                {me?.customActivity
                  ? `${ACTIVITY_VERB[me.customActivity.type]} ${me.customActivity.name}`
                  : "Set a custom activity…"}
              </Button>
            </div>

            {/* Chosen by scrolling rather than by clicking down a list; the
                choice applies as the wheel settles, as the list's click did. */}
            <div className="space-y-1">
              <Label>Presence</Label>
              <WheelPicker
                label="Presence"
                rowHeight={36}
                items={PRESENCE_ITEMS}
                value={manualStatus}
                onChange={(value) => setStatus(value as ManualStatus)}
              />
              <p className="text-center text-xs text-muted-foreground">
                {STATUS_HINT[manualStatus as ManualStatus]}
              </p>
            </div>
          </div>

          {/* What the card looks like with what is typed here, live. Cut off
              and faded at the bottom — it is a glimpse, not the whole card —
              and inert, because it is a picture of the card, not the card. */}
          <div className="relative hidden min-h-[26rem] overflow-hidden md:block">
            <div
              inert
              className="pointer-events-none absolute inset-x-0 top-0 [mask-image:linear-gradient(to_bottom,black_55%,transparent_100%)]"
            >
              {me && (
                <MemberProfileCard
                  reserveFrameRoom={false}
                  expandable={false}
                  hideMessageAction
                  showActivity={false}
                  customStatusOverride={draft.trim()}
                  member={{
                    userId: me._id,
                    name: me.name,
                    username: me.username,
                    imageUrl: me.imageUrl,
                    bio: me.bio,
                    bannerUrl: me.bannerUrl,
                    avatarDecoration: decoration,
                    isBirthday,
                    borderGradientStart: me.borderGradientStart,
                    borderGradientEnd: me.borderGradientEnd,
                    // "invisible" appears as offline to others; show the same here.
                    status: (status === "invisible" ? "offline" : status) as FriendStatus,
                  }}
                />
              )}
            </div>
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
        </>
        )}
        </DialogMorph>
      </DialogContent>
    </Dialog>
    </>
  );
}


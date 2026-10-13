"use client";

import { useMutation, useQuery } from "convex/react";
import { Ban, BellOff, Bell, Loader2, ShieldCheck } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { errorMessage } from "@/lib/errors";

/**
 * Ignoring and blocking people, from wherever a person appears.
 *
 * Ignore hides someone for a while; Block is permanent and also unfriends them,
 * hides your profile from them and stops them messaging or calling you. The
 * rules are enforced by the backend (convex/lib/blocking.ts) — everything here
 * is the way in, and the way back out.
 */

export type IgnoreDuration = "1h" | "8h" | "24h" | "7d" | "forever";

/** What the picker offers, in the order it shows them. Mirrors
 * `IGNORE_DURATIONS` in convex/lib/blocking.ts, which is what the server
 * accepts. */
export const IGNORE_OPTIONS: { value: IgnoreDuration; label: string }[] = [
  { value: "1h", label: "For 1 hour" },
  { value: "8h", label: "For 8 hours" },
  { value: "24h", label: "For 24 hours" },
  { value: "7d", label: "For 7 days" },
  { value: "forever", label: "Until I turn it off" },
];

/** "until 4:30 PM", "until Fri 4:30 PM", or "until you turn it off". */
export function describeIgnoreEnd(until: number | null): string {
  if (until === null) return "until you turn it off";
  const end = new Date(until);
  const sameDay = end.toDateString() === new Date().toDateString();
  const time = end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay
    ? `until ${time}`
    : `until ${end.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

/** What the caller currently does to one person, and how to change it. */
export function useBlockIgnore(userId: Id<"users">, name: string) {
  const status = useQuery(api.blocks.statusWith, { userId });
  const ignoreUser = useMutation(api.blocks.ignoreUser);
  const unignoreUser = useMutation(api.blocks.unignoreUser);
  const unblockUser = useMutation(api.blocks.unblockUser);

  const attempt = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      toast.success(done);
    } catch (err) {
      toast.error(errorMessage(err, "That didn't work."));
    }
  };

  return {
    status,
    ignore: (duration: IgnoreDuration) =>
      attempt(
        () => ignoreUser({ userId, duration }),
        `Ignoring ${name}. They won't be told.`,
      ),
    unignore: () => attempt(() => unignoreUser({ userId }), `You're no longer ignoring ${name}.`),
    unblock: () => attempt(() => unblockUser({ userId }), `Unblocked ${name}.`),
  };
}

/** The pieces of a menu that differ between a right-click menu and a dropdown. */
type MenuKit = {
  Item: ComponentType<{
    children?: ReactNode;
    variant?: "default" | "destructive";
    onSelect?: () => void;
  }>;
  Separator: ComponentType<Record<string, never>>;
  Sub: ComponentType<{ children?: ReactNode }>;
  SubTrigger: ComponentType<{ children?: ReactNode }>;
  SubContent: ComponentType<{ children?: ReactNode }>;
};

const CONTEXT_KIT = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
} as unknown as MenuKit;

const DROPDOWN_KIT = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
} as unknown as MenuKit;

function Items({
  kit,
  userId,
  name,
  onBlock,
  separated = true,
}: {
  kit: MenuKit;
  userId: Id<"users">;
  name: string;
  /** Opens the confirmation. Block is the one action that asks first. */
  onBlock: () => void;
  /** A rule above, for appending to a menu that already has items. */
  separated?: boolean;
}) {
  const { Item, Separator, Sub, SubTrigger, SubContent } = kit;
  const { status, ignore, unignore, unblock } = useBlockIgnore(userId, name);

  // Nothing until it is known: "Ignore" flipping to "Stop ignoring" a beat
  // later would be a button that changes under the cursor.
  if (!status) return null;

  return (
    <>
      {separated && <Separator />}
      {status.blocked ? (
        <Item onSelect={() => void unblock()}>
          <ShieldCheck className="size-4" />
          Unblock {name}
        </Item>
      ) : (
        <>
          {status.ignored ? (
            <Item onSelect={() => void unignore()}>
              <Bell className="size-4" />
              Stop ignoring
              <span className="ml-auto pl-2 text-[11px] text-muted-foreground">
                {describeIgnoreEnd(status.ignoredUntil)}
              </span>
            </Item>
          ) : (
            <Sub>
              <SubTrigger>
                <BellOff className="size-4" />
                Ignore
              </SubTrigger>
              <SubContent>
                {IGNORE_OPTIONS.map((option) => (
                  <Item key={option.value} onSelect={() => void ignore(option.value)}>
                    {option.label}
                  </Item>
                ))}
              </SubContent>
            </Sub>
          )}
          <Item variant="destructive" onSelect={onBlock}>
            <Ban className="size-4" />
            Block {name}
          </Item>
        </>
      )}
    </>
  );
}

/** Ignore / Block items for a right-click menu. */
export function BlockIgnoreContextItems(props: {
  userId: Id<"users">;
  name: string;
  onBlock: () => void;
}) {
  return <Items kit={CONTEXT_KIT} {...props} />;
}

/** The same items for a dropdown menu. It's the whole menu, so no rule above. */
export function BlockIgnoreDropdownItems(props: {
  userId: Id<"users">;
  name: string;
  onBlock: () => void;
}) {
  return <Items kit={DROPDOWN_KIT} separated={false} {...props} />;
}

/**
 * Asks before blocking. Mounted next to whatever menu opens it, because a menu
 * closes — and takes its own state with it — the moment an item is chosen.
 */
export function BlockDialog({
  target,
  onClose,
}: {
  target: { id: Id<"users">; name: string } | null;
  onClose: () => void;
}) {
  const blockUser = useMutation(api.blocks.blockUser);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await blockUser({ userId: target.id });
      toast.success(`Blocked ${target.name}.`);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't block them."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="size-4" /> Block {target?.name}?
          </DialogTitle>
          <DialogDescription>
            This is permanent until you undo it from Settings or their profile.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>You&apos;ll stop being friends, and any friend requests between you are cancelled.</li>
          <li>They can&apos;t message or call you, and you can&apos;t message or call them.</li>
          <li>They won&apos;t be able to see your profile.</li>
          <li>
            In servers and groups you share, their messages are hidden from you and they
            won&apos;t notify you. They stay in the group, and what they send while blocked stays
            hidden even if you unblock them later.
          </li>
          <li>They won&apos;t be told.</li>
        </ul>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Block
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

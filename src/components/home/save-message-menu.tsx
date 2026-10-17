"use client";

import { useMutation, useQuery } from "convex/react";
import { AlarmClock, AlarmClockOff, Bookmark, BookmarkCheck, BookmarkMinus, List } from "lucide-react";
import { useMemo } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { openSavedMessages } from "@/lib/command-events";
import { describeReminder, reminderPresets } from "@/lib/reminder-presets";

export type SaveTarget =
  | { scope: "conversation"; messageId: Id<"messages"> }
  | { scope: "channel"; messageId: Id<"channelMessages"> };

/**
 * "Save for me" and "Remind me" in a message's right-click menu. Private to the person saving: this is
 * not pinning, which the whole room sees.
 *
 * Only mounted while the menu is open (Radix renders menu content on demand), so the status query runs
 * for the one message being looked at rather than for every row in the list.
 */
export function SaveMessageMenuItems({ target }: { target: SaveTarget }) {
  const status = useQuery(api.savedMessages.status, { messageKey: target.messageId });
  const save = useMutation(api.savedMessages.save);
  const unsave = useMutation(api.savedMessages.unsave);
  const setReminder = useMutation(api.savedMessages.setReminder);
  const presets = useMemo(() => reminderPresets(), []);

  const ids = target.scope === "conversation" ? { conversationMessageId: target.messageId } : { channelMessageId: target.messageId };
  const saved = status?.saved === true;
  const remindAt = status?.saved ? status.remindAt : null;
  const pendingReminder = status?.saved && status.remindAt !== null && status.remindedAt === null;

  // Failures (lost access, the 500 cap) are rare and the menu is gone by then; the saved list shows the truth.
  const remind = (at: number) => void (saved ? setReminder({ messageKey: target.messageId, remindAt: at }) : save({ ...ids, remindAt: at })).catch(() => undefined);

  return (
    <>
      <ContextMenuSeparator />
      {saved ? (
        <ContextMenuItem onClick={() => void unsave({ messageKey: target.messageId }).catch(() => undefined)}>
          <BookmarkMinus className="size-4" />
          Remove from saved
        </ContextMenuItem>
      ) : (
        <ContextMenuItem disabled={status === undefined} onClick={() => void save(ids).catch(() => undefined)}>
          <Bookmark className="size-4" />
          Save for me
        </ContextMenuItem>
      )}
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={status === undefined}>
          <AlarmClock className="size-4" />
          Remind me
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-56">
          {pendingReminder && remindAt !== null && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{describeReminder(remindAt)}</p>
          )}
          {presets.map((preset) => (
            <ContextMenuItem key={preset.label} onClick={() => remind(preset.at)}>
              {preset.label}
            </ContextMenuItem>
          ))}
          {pendingReminder && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => void setReminder({ messageKey: target.messageId, remindAt: null }).catch(() => undefined)}>
                <AlarmClockOff className="size-4" />
                Clear reminder
              </ContextMenuItem>
            </>
          )}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {saved && (
        <ContextMenuItem onClick={() => openSavedMessages(status?.saved ? target.messageId : undefined)}>
          {pendingReminder ? <BookmarkCheck className="size-4" /> : <List className="size-4" />}
          View saved messages
        </ContextMenuItem>
      )}
    </>
  );
}

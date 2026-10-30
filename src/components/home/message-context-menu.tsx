"use client";

import { Flag, Forward, Pencil, Reply, Smile, Trash2 } from "lucide-react";

import { ReactionPickerContent } from "@/components/home/reaction-picker-content";
import { SaveMessageMenuItems, type SaveTarget } from "@/components/home/save-message-menu";
import { formatCustomEmoji } from "@/lib/custom-emoji";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { Id } from "../../../convex/_generated/dataModel";

interface MessageContextMenuProps {
  children: React.ReactNode;
  canEdit: boolean;
  canDelete: boolean;
  /** Channel messages only — omitted for DMs, which have no custom emoji. */
  communityId?: Id<"communities">;
  onReact: (emoji: string) => void;
  /** Whether new reactions can be added (Add Reactions). Defaults to true. */
  canReact?: boolean;
  onReply?: () => void;
  onForward?: () => void;
  onEdit: () => void;
  /** `shiftKey` — true skips the confirmation dialog entirely. */
  onDelete: (shiftKey: boolean) => void;
  /** Offered only for other people's messages. */
  onReport?: () => void;
  /** Offers "Save for me" and reminders: private to the viewer, unlike pins. */
  saveTarget?: SaveTarget;
}

/** Right-click equivalent of MessageHoverActions — same actions. */
export function MessageContextMenu({
  children,
  canEdit,
  canDelete,
  communityId,
  onReact,
  canReact = true,
  onReply,
  onForward,
  onEdit,
  onDelete,
  onReport,
  saveTarget,
}: MessageContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {canReact && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Smile className="size-4" />
              React
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="p-0">
              <ReactionPickerContent
                onSelect={(text, custom) => onReact(custom ? formatCustomEmoji(custom) : text)}
              />
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}

        {onReply && (
          <ContextMenuItem onClick={onReply}>
            <Reply className="size-4" />
            Reply
          </ContextMenuItem>
        )}

        {onForward && (
          <ContextMenuItem onClick={onForward}>
            <Forward className="size-4" />
            Forward message
          </ContextMenuItem>
        )}

        {saveTarget && <SaveMessageMenuItems target={saveTarget} />}

        {(canEdit || canDelete) && <ContextMenuSeparator />}

        {canEdit && (
          <ContextMenuItem onClick={onEdit}>
            <Pencil className="size-4" />
            Edit message
          </ContextMenuItem>
        )}
        {canDelete && (
          <ContextMenuItem variant="destructive" onClick={(e) => onDelete(e.shiftKey)}>
            <Trash2 className="size-4" />
            Delete message
          </ContextMenuItem>
        )}
        {onReport && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={onReport}>
              <Flag className="size-4" />
              Report message
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

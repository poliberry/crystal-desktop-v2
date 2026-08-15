"use client";

import { Pencil, Smile, Trash2 } from "lucide-react";

import { ReactionPickerContent } from "@/components/home/reaction-picker-content";
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

interface MessageContextMenuProps {
  children: React.ReactNode;
  canEdit: boolean;
  canDelete: boolean;
  onReact: (emoji: string) => void;
  onEdit: () => void;
  /** `shiftKey` — true skips the confirmation dialog entirely. */
  onDelete: (shiftKey: boolean) => void;
}

/** Right-click equivalent of MessageHoverActions — same three actions. */
export function MessageContextMenu({
  children,
  canEdit,
  canDelete,
  onReact,
  onEdit,
  onDelete,
}: MessageContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Smile className="size-4" />
            React
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="p-0">
            <ReactionPickerContent onSelect={onReact} />
          </ContextMenuSubContent>
        </ContextMenuSub>

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
      </ContextMenuContent>
    </ContextMenu>
  );
}

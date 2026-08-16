"use client";

import { Pencil, Smile, Trash2 } from "lucide-react";

import { ReactionPickerContent } from "@/components/home/reaction-picker-content";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface MessageHoverActionsProps {
  canEdit: boolean;
  canDelete: boolean;
  onReact: (emoji: string) => void;
  onEdit: () => void;
  /** `shiftKey` — true skips the confirmation dialog entirely. */
  onDelete: (shiftKey: boolean) => void;
}

/** Small button group that fades in over the top-right of a message row on
 * hover — react, edit (own messages only), delete. */
export function MessageHoverActions({
  canEdit,
  canDelete,
  onReact,
  onEdit,
  onDelete,
}: MessageHoverActionsProps) {
  return (
    <div className="absolute top-0 right-2 flex -translate-y-1/2 items-center gap-0.5 rounded-md border bg-popover opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7">
            <Smile className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-auto p-0">
          <ReactionPickerContent onSelect={onReact} />
        </PopoverContent>
      </Popover>

      {canEdit && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={onEdit}
              >
                <Pencil className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {canDelete && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-destructive hover:text-destructive"
                onClick={(e) => onDelete(e.shiftKey)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

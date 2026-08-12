"use client";

import { Compass, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function RailButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="secondary" size="icon" className="size-12 rounded-full" onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function CommunityRail() {
  return (
    <div className="flex w-18 shrink-0 flex-col items-center gap-2 border-r bg-background/60 py-3">
      <ScrollArea className="min-h-0 flex-1 w-full">
        <div className="flex flex-col items-center gap-2 px-2">
          <p className="mt-4 px-1 text-center text-[11px] text-muted-foreground">
            No communities yet
          </p>
        </div>
      </ScrollArea>

      <div className="flex flex-col items-center gap-2 px-2">
        <RailButton label="Discover communities">
          <Compass />
        </RailButton>
        <RailButton label="Create a community">
          <Plus />
        </RailButton>
      </div>
    </div>
  );
}

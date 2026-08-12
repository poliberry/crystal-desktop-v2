"use client";

import { UserButton } from "@clerk/clerk-react";
import { ChevronDown, Radio } from "lucide-react";

import { PresenceDot } from "@/components/presence-dot";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMyPresence, useSetPresenceStatus } from "@/hooks/use-presence";
import { STATUS_LABEL, type ManualStatus } from "@/lib/presence";

const MANUAL_STATUSES: ManualStatus[] = ["online", "dnd", "invisible"];

function StatusMenu() {
  const { status } = useMyPresence();
  const setStatus = useSetPresenceStatus();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-2">
          <PresenceDot status={status} />
          <span className="text-sm">{STATUS_LABEL[status]}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Set status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={status === "idle" ? "online" : status}
          onValueChange={(value) => setStatus(value as ManualStatus)}
        >
          {MANUAL_STATUSES.map((value) => (
            <DropdownMenuRadioItem key={value} value={value} className="gap-2">
              <PresenceDot status={value} />
              {STATUS_LABEL[value]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopNav() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4">
      <div className="flex items-center gap-2">
        <Radio className="size-5 text-primary" />
        <span className="font-semibold">Crystal</span>
      </div>
      <div className="flex items-center gap-2">
        <StatusMenu />
        <UserButton />
      </div>
    </header>
  );
}

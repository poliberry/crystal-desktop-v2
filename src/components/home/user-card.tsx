"use client";

import { useQuery } from "convex/react";
import { Settings } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { useCall } from "@/components/call/call-provider";
import { PresenceDot } from "@/components/presence-dot";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMyPresence, useSetPresenceStatus } from "@/hooks/use-presence";
import { getDesktopAPI } from "@/lib/desktop";
import { STATUS_LABEL, type ManualStatus } from "@/lib/presence";

const MANUAL_STATUSES: ManualStatus[] = ["online", "dnd", "invisible"];

/**
 * Bottom-left "who am I" card: avatar, display name (hover reveals the
 * username), and current status. Clicking the name opens the presence
 * switcher — this is the app's only way to change status now that the
 * topbar's status menu and Clerk `UserButton` are gone.
 */
export function UserCard() {
  const me = useQuery(api.users.getCurrentUser);
  const { status } = useMyPresence();
  const setStatus = useSetPresenceStatus();
  const { activeCall } = useCall();

  if (!me) return null;

  return (
    <div className="flex shrink-0 items-center gap-2 border-t bg-background/60 px-2 py-2">
      <Avatar size="sm">
        <AvatarImage src={me.imageUrl} alt={me.name} />
        <AvatarFallback>{me.name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>

      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="min-w-0 flex-1 rounded-md px-1 py-0.5 text-left hover:bg-accent/60"
              >
                <p className="truncate text-sm font-medium">{me.name}</p>
                <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  <PresenceDot status={status} />
                  {activeCall ? "In voice" : STATUS_LABEL[status]}
                </p>
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">@{me.username}</TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="start" side="top" className="w-48">
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

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void getDesktopAPI()?.settings.open()}
          >
            <Settings className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Settings</TooltipContent>
      </Tooltip>
    </div>
  );
}

"use client";

import { Users } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface GroupAvatarMember {
  name: string;
  imageUrl?: string;
}

interface GroupAvatarProps {
  imageUrl?: string;
  members: GroupAvatarMember[];
  size?: "sm" | "default" | "lg";
  className?: string;
}

const SIZES = {
  sm: { box: "size-6", first: "size-4", second: "size-3.5" },
  default: { box: "size-8", first: "size-5", second: "size-4" },
  lg: { box: "size-10", first: "size-7", second: "size-5" },
} as const;

/**
 * Group DM icon: a custom uploaded icon if the group has set one, otherwise
 * the first two members' avatars overlapping (Discord-style), falling back
 * to a generic icon if member data hasn't loaded yet.
 */
export function GroupAvatar({ imageUrl, members, size = "default", className }: GroupAvatarProps) {
  const dims = SIZES[size];

  if (imageUrl) {
    return (
      <Avatar className={cn(dims.box, className)}>
        <AvatarImage src={imageUrl} alt="Group icon" />
        <AvatarFallback>
          <Users className="size-4" />
        </AvatarFallback>
      </Avatar>
    );
  }

  const [first, second] = members;

  if (!first) {
    return (
      <div
        className={cn("flex shrink-0 items-center justify-center rounded-full bg-muted", dims.box, className)}
      >
        <Users className="size-4 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className={cn("relative shrink-0", dims.box, className)}>
      <Avatar className={cn("absolute top-0 left-0", dims.first)}>
        <AvatarImage src={first.imageUrl} alt={first.name} />
        <AvatarFallback className="text-[9px]">{first.name.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      {second && (
        <Avatar className={cn("absolute right-0 bottom-0 ring-2 ring-background", dims.second)}>
          <AvatarImage src={second.imageUrl} alt={second.name} />
          <AvatarFallback className="text-[9px]">{second.name.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}

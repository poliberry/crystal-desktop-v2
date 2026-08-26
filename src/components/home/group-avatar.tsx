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
  size?: "sm" | "default" | "lg" | "xl";
  className?: string;
}

/** Every part scales together: the two member avatars are sized as a fraction
 * of the box, and the glyph and initials with them. Overriding the box alone
 * through `className` leaves a big empty square with two small avatars
 * scattered in its corners, which is why `xl` is a size here rather than a
 * caller's `size-16`. */
const SIZES = {
  sm: { box: "size-6", first: "size-4", second: "size-3.5", icon: "size-3", text: "text-[9px]" },
  default: { box: "size-8", first: "size-5", second: "size-4", icon: "size-4", text: "text-[9px]" },
  lg: { box: "size-10", first: "size-7", second: "size-5", icon: "size-5", text: "text-[11px]" },
  xl: { box: "size-16", first: "size-11", second: "size-8", icon: "size-7", text: "text-base" },
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
          <Users className={dims.icon} />
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
        <Users className={cn(dims.icon, "text-muted-foreground")} />
      </div>
    );
  }

  return (
    <div className={cn("relative shrink-0", dims.box, className)}>
      <Avatar className={cn("absolute top-0 left-0", dims.first)}>
        <AvatarImage src={first.imageUrl} alt={first.name} />
        <AvatarFallback className={dims.text}>{first.name.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      {second && (
        <Avatar className={cn("absolute right-0 bottom-0 ring-2 ring-background", dims.second)}>
          <AvatarImage src={second.imageUrl} alt={second.name} />
          <AvatarFallback className={dims.text}>{second.name.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}

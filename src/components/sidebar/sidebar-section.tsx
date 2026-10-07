"use client";

import { cn } from "@/lib/utils";

/**
 * The small uppercase title above a sidebar section, with room on the right
 * for that section's one action (new DM, new community).
 */
export function SidebarSectionHeader({
  title,
  action,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between px-1", className)}>
      <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </span>
      {action}
    </div>
  );
}

/** Past this a badge outgrows the row and the exact number stops mattering. */
const BADGE_CAP = 99;

export function CountBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-bold text-white",
        className,
      )}
    >
      {count > BADGE_CAP ? `${BADGE_CAP}+` : count}
    </span>
  );
}

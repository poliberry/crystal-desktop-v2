import { STATUS_DOT_CLASS, type DisplayStatus, type FriendStatus } from "@/lib/presence";
import { cn } from "@/lib/utils";

interface PresenceDotProps {
  status: DisplayStatus | FriendStatus;
  className?: string;
}

export function PresenceDot({ status, className }: PresenceDotProps) {
  return (
    <span
      className={cn(
        "block size-2.5 rounded-full border-2 border-background",
        STATUS_DOT_CLASS[status],
        status === "invisible" && "ring-1 ring-foreground/40",
        className
      )}
    />
  );
}

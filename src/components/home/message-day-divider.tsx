import { formatDaySeparator } from "@/lib/message-time";

/**
 * The dated rule between two calendar days of messages — a centred label with
 * a hairline running out to each edge. Shared by the channel and DM lists.
 */
export function MessageDayDivider({ ts }: { ts: number }) {
  return (
    <div
      data-slot="message-day-divider"
      className="flex items-center gap-3 px-1 select-none"
    >
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs font-semibold text-muted-foreground">
        {formatDaySeparator(ts)}
      </span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

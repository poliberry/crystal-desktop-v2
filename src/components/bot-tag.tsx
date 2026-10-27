import { cn } from "@/lib/utils";

/** The compact identity marker used wherever a bot's name is shown. */
export function BotTag({ className }: { className?: string }) {
  return (
    <span
      aria-label="Bot"
      className={cn(
        "shrink-0 rounded-sm border border-sky-400/40 bg-sky-400/10 px-1 py-px text-[9px] font-bold leading-none tracking-wider text-sky-400",
        className,
      )}
    >
      BOT
    </span>
  );
}

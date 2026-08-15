"use client";

import { cn } from "@/lib/utils";

interface Reaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

export function MessageReactions({
  reactions,
  onToggle,
}: {
  reactions: Reaction[];
  onToggle: (emoji: string) => void;
}) {
  if (reactions.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onToggle(r.emoji)}
          className={cn(
            "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs hover:border-foreground/40",
            r.reactedByMe && "border-primary bg-primary/10"
          )}
        >
          <span>{r.emoji}</span>
          <span className="text-muted-foreground">{r.count}</span>
        </button>
      ))}
    </div>
  );
}

"use client";

import { parseCustomEmoji, type ServerEmoji } from "@/lib/custom-emoji";
import { cn } from "@/lib/utils";

interface Reaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

function ReactionEmoji({ emoji, serverEmojiById }: { emoji: string; serverEmojiById: Map<string, ServerEmoji> }) {
  const custom = parseCustomEmoji(emoji);
  if (!custom) return <span>{emoji}</span>;
  const serverEmoji = serverEmojiById.get(custom.id);
  if (serverEmoji) {
    return <img src={serverEmoji.imageUrl} alt={serverEmoji.name} className="size-4 object-contain" />;
  }
  // Tag parsed but the id isn't in the map — deleted emoji, or a DM with no
  // map at all. Fall back to a placeholder instead of the raw `<:name:id>`.
  return <span>🏷️</span>;
}

export function MessageReactions({
  reactions,
  onToggle,
  serverEmojiById,
}: {
  reactions: Reaction[];
  onToggle: (emoji: string) => void;
  serverEmojiById: Map<string, ServerEmoji>;
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
          <ReactionEmoji emoji={r.emoji} serverEmojiById={serverEmojiById} />
          <span className="text-muted-foreground">{r.count}</span>
        </button>
      ))}
    </div>
  );
}

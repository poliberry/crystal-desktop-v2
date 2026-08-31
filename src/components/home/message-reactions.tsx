"use client";

import { CustomEmojiImage } from "@/components/custom-emoji-image";
import { useAccessibleEmojis } from "@/hooks/use-accessible-emojis";
import { parseCustomEmoji } from "@/lib/custom-emoji";
import { cn } from "@/lib/utils";

interface Reaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

function ReactionEmoji({ emoji }: { emoji: string }) {
  const { byId } = useAccessibleEmojis();
  const custom = parseCustomEmoji(emoji);
  if (!custom) return <span className="text-sm leading-none">{emoji}</span>;
  const serverEmoji = byId.get(custom.id);
  if (serverEmoji) {
    return (
      <CustomEmojiImage
        src={serverEmoji.imageUrl}
        name={serverEmoji.name}
        className="size-4 object-contain"
      />
    );
  }
  // Tag parsed but the id isn't resolvable — deleted, or from a server this
  // reader isn't in. A placeholder beats the raw `<:name:id>`.
  return <span title={`:${custom.name}:`}>🏷️</span>;
}

export function MessageReactions({
  reactions,
  onToggle,
}: {
  reactions: Reaction[];
  /** `desired` is the end state this click is asking for — computed here from
   * `reactedByMe` so a retried reaction converges instead of double-toggling. */
  onToggle: (emoji: string, desired: "add" | "remove") => void;
}) {
  if (reactions.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onToggle(r.emoji, r.reactedByMe ? "remove" : "add")}
          className={cn(
            "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs hover:border-foreground/40",
            r.reactedByMe && "border-primary bg-primary/10"
          )}
        >
          <ReactionEmoji emoji={r.emoji} />
          <span className="text-muted-foreground">{r.count}</span>
        </button>
      ))}
    </div>
  );
}

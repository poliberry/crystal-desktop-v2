import { AvatarBadge } from "@/components/ui/avatar";
import { STATUS_DOT_CLASS, type DisplayStatus, type FriendStatus } from "@/lib/presence";
import { cn } from "@/lib/utils";

interface PresenceDotProps {
  status: DisplayStatus | FriendStatus;
  /** Their birthday is today: the dot becomes a cake. Reachability loses to it
   * for the day — you can find that out by looking at them, and the whole
   * point of the cake is that it's noticed. */
  isBirthday?: boolean;
  className?: string;
}

/** Tooltip and screen-reader text for the cake, so it reads as a fact about the
 * person rather than as decoration that happened to replace their status. */
const BIRTHDAY_LABEL = "It's their birthday";

/**
 * The cake, drawn to fill whatever box it's put in.
 *
 * An SVG `<text>` rather than a plain glyph because the dot is sized half a
 * dozen different ways across the app — `size-3` here, an avatar-size class
 * there — and a font size can't follow a box. Scaling the viewBox can, so the
 * cake is exactly as big as the dot it replaces wherever that happens to be.
 */
function CakeGlyph() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden className="size-full overflow-visible">
      <text x="5" y="5" fontSize="9" textAnchor="middle" dominantBaseline="central">
        🎂
      </text>
    </svg>
  );
}

export function PresenceDot({ status, isBirthday, className }: PresenceDotProps) {
  if (isBirthday) {
    return (
      <span
        role="img"
        title={BIRTHDAY_LABEL}
        aria-label={BIRTHDAY_LABEL}
        className={cn(
          // The dot's own box, borrowed whole: same size, same ring against
          // the background, with a plate behind the cake instead of a status
          // colour. Anything the caller sizes it with therefore lands the same
          // way it would on the dot.
          "flex size-4 items-center justify-center rounded-full border-3 border-background bg-muted select-none",
          className
        )}
      >
        <CakeGlyph />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "block size-4 rounded-full border-3 border-background",
        STATUS_DOT_CLASS[status],
        status === "invisible" && "ring-1 ring-foreground/40",
        className
      )}
    />
  );
}

/**
 * The same thing for avatars that carry their status in an `AvatarBadge` —
 * member lists, the user card — so those don't each grow their own copy of the
 * "unless it's their birthday" branch.
 *
 * Must be a child of `Avatar`: both branches position themselves against it.
 */
export function PresenceBadge({ status, isBirthday, className }: PresenceDotProps) {
  if (isBirthday) {
    return (
      <AvatarBadge
        role="img"
        title={BIRTHDAY_LABEL}
        aria-label={BIRTHDAY_LABEL}
        className={cn("bg-muted", className)}
      >
        {/* Wrapped, because AvatarBadge sizes (and at `sm`, hides) a direct
            `svg` child — those rules are for the icons it was built to hold,
            and this one is the badge's whole content. */}
        <span className="flex size-full items-center justify-center">
          <CakeGlyph />
        </span>
      </AvatarBadge>
    );
  }

  return <AvatarBadge className={cn(STATUS_DOT_CLASS[status], className)} />;
}

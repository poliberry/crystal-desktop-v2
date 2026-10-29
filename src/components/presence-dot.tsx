import { PresenceGlyph, type PresenceGlyphKind } from "@/components/presence-glyph";
import { topActivity } from "@/components/rich-presence-card";
import { AvatarBadge } from "@/components/ui/avatar";
import { type DisplayStatus, type FriendStatus } from "@/lib/presence";
import type { RichPresenceActivity } from "@/types/desktop-api";
import { cn } from "@/lib/utils";

interface PresenceDotProps {
  status: DisplayStatus | FriendStatus;
  /**
   * What they are doing, if anything.
   *
   * A game, a song or a screen replaces the status glyph. The dot is the one
   * place every list that shows a person already has room for, and it used to
   * be a coloured circle saying "reachable" next to a separate little icon
   * saying what they were up to — two marks for one person. Now it is one.
   *
   * Only while they are *active*: idle, away, busy and do-not-disturb are all
   * answers to "should I talk to you", which outranks what happens to be
   * playing. See `glyphFor`.
   */
  activities?: RichPresenceActivity[] | null;
  /** Their birthday is today: the dot becomes a cake. Reachability loses to it
   * for the day — you can find that out by looking at them, and the whole
   * point of the cake is that it's noticed. */
  isBirthday?: boolean;
  /**
   * Unused, kept so existing callers still typecheck.
   *
   * The plate behind the glyph is always the theme's sidebar accent — a profile
   * gradient must never recolour it, or one person's decoration would change
   * shared chrome for everyone looking at them.
   */
  accent?: string;
  /** Sit where it is put, instead of being nudged toward the corner of an avatar
   * — for a dot that stands on its own in a row of text, where the nudge reads
   * as being out of line with the words. */
  inline?: boolean;
  className?: string;
}

/** Tooltip and screen-reader text for the cake, so it reads as a fact about the
 * person rather than as decoration that happened to replace their status. */
const BIRTHDAY_LABEL = "It's their birthday";

/**
 * Which glyph this person gets: what they're doing, or what they are.
 *
 * The activity only wins for someone active. Not because a busy person isn't
 * playing something, but because the dot answers one question — can I talk to
 * you — and "yes, and here's what they're up to" is the only case where the
 * answer has room for anything else.
 */
function glyphFor(
  status: DisplayStatus | FriendStatus,
  activities: RichPresenceActivity[] | null | undefined,
): PresenceGlyphKind {
  if (status === "online") {
    const activity = topActivity(activities);
    if (activity) return activity.type;
  }
  return status;
}

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

/**
 * Where the dot sits, always.
 *
 * It used to move out along the diagonal only when the avatar wore a
 * decoration, to get off the artwork — and the position it moved *to* is
 * simply the better one: on the corner rather than half over the picture. So
 * it is where the dot lives now, decoration or not, and a badge no longer
 * shifts under somebody who has just put a frame on.
 */
const DOT_OFFSET = "translate-x-[35%] translate-y-[35%]";

/**
 * The plate the glyph sits on.
 *
 * A glyph is not a solid disc — a moon, a controller and a half-filled circle
 * all have holes in them — so it sits on a plate. `backdrop-blur-sm` is for the
 * tinted case below: at forty percent the avatar shows through the holes, and
 * blurring what shows through keeps the glyph readable over a busy picture.
 * Over the opaque default it costs nothing and does nothing.
 */
const PLATE =
  "flex items-center justify-center rounded-full bg-sidebar-accent backdrop-blur-sm";

export function PresenceDot({
  status,
  activities,
  isBirthday,
  inline = false,
  className,
}: PresenceDotProps) {
  return (
    <span
      role={isBirthday ? "img" : undefined}
      title={isBirthday ? BIRTHDAY_LABEL : undefined}
      aria-label={isBirthday ? BIRTHDAY_LABEL : undefined}
      className={cn(
        // The dot's own box, unchanged from when it was a coloured circle:
        // whatever a caller sizes it with lands the same way it always did.
        "size-4 border-2 border-sidebar-accent select-none",
        PLATE,
        className,
        // After `className`, which is where a caller puts the dot: the offset
        // moves it from wherever that was rather than to a fixed corner.
        !inline && DOT_OFFSET,
      )}
    >
      {isBirthday ? <CakeGlyph /> : <PresenceGlyph kind={glyphFor(status, activities)} />}
    </span>
  );
}

/**
 * The same thing for avatars that carry their status in an `AvatarBadge` —
 * member lists, the user card — so those don't each grow their own copy of the
 * "unless it's their birthday" branch.
 *
 * Must be a child of `Avatar`: both branches position themselves against it.
 */
export function PresenceBadge({
  status,
  activities,
  isBirthday,
  className,
}: PresenceDotProps) {
  return (
    <AvatarBadge
      role={isBirthday ? "img" : undefined}
      title={isBirthday ? BIRTHDAY_LABEL : undefined}
      aria-label={isBirthday ? BIRTHDAY_LABEL : undefined}
      className={cn(
        PLATE,
        // Bigger than the badge's own sizes, which were drawn for a plain disc
        // — a controller or a moon at eight pixels is a smudge.
        "ring-sidebar-accent group-data-[size=sm]/avatar:size-3 group-data-[size=default]/avatar:size-3.5 group-data-[size=lg]/avatar:size-4",
        className,
        DOT_OFFSET,
      )}
    >
      {/* Wrapped, because AvatarBadge sizes (and at `sm`, hides) a direct `svg`
          child — those rules are for the icons it was built to hold, and this
          one is the badge's whole content. */}
      <span className="flex size-full items-center justify-center">
        {isBirthday ? <CakeGlyph /> : <PresenceGlyph className="size-6" kind={glyphFor(status, activities)} />}
      </span>
    </AvatarBadge>
  );
}

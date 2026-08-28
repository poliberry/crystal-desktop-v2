"use client";

import { cn } from "@/lib/utils";

/**
 * Which shape someone's custom status is drawn in on their profile card.
 *
 * Stored on the user (`users.statusBubble`), so it is the choice of the person
 * whose status it is rather than of whoever is looking — the two shapes read
 * differently ("I'm at work until 5" said, "should really be working" thought),
 * and which of those a status is only its author knows.
 */
export type StatusBubbleKind = "speech" | "thought";

export const STATUS_BUBBLE_KINDS: {
  kind: StatusBubbleKind;
  label: string;
  hint: string;
}[] = [
  { kind: "speech", label: "Speech", hint: "Said out loud." },
  { kind: "thought", label: "Thought", hint: "Just thinking it." },
];

/** The bubble and its tail are the same surface, so they read as one shape
 * rather than as a pill with something stuck to it. */
const SURFACE = "bg-accent/60 shadow-lg backdrop-blur-sm";

/**
 * A custom status, beside the avatar rather than over it.
 *
 * It used to be pinned across the avatar's top corner, which was fine until
 * avatars grew decorations: a pill sitting on top of one cuts a chunk out of
 * the frame. Out here it has the whole width of the card's avatar row, which
 * nothing else occupies, so neither has to give way to the other.
 *
 * The tail is what makes the two shapes different, and it points back at the
 * avatar in both — a bubble whose tail points nowhere is just a pill. It lives
 * on the *outer* element rather than beside the text, because the text is
 * truncated and `truncate` is `overflow: hidden`: a tail inside it is clipped
 * off at the bubble's edge, which is exactly where a tail needs to be.
 */
export function StatusBubble({
  text,
  kind = "speech",
  onClick,
  className,
}: {
  text: string;
  kind?: StatusBubbleKind;
  /** Present only on your own card, where the bubble is the shortcut to
   * changing what it says. */
  onClick?: () => void;
  className?: string;
}) {
  const thought = kind === "thought";
  const Element = onClick ? "button" : "span";

  return (
    <Element
      {...(onClick ? { type: "button" as const, title: "Change your status", onClick } : {})}
      className={cn(
        "relative inline-flex max-w-full items-center",
        onClick && "cursor-pointer",
        className
      )}
    >
      {thought ? (
        // Two circles trailing up and back towards the avatar, smaller as they
        // go — the bubble sits below the head it came out of, so the thought
        // rises towards it rather than dropping away from it.
        <>
          <span
            aria-hidden
            className={cn("absolute top-2.5 -left-1 size-4 rounded-full", SURFACE)}
          />
          <span
            aria-hidden
            className={cn("absolute -top-0.5 -left-4 size-3 rounded-full", SURFACE)}
          />
        </>
      ) : (
        // A left-pointing triangle, clipped out of a box rather than built from
        // borders: a border triangle can't take the bubble's own background, so
        // it would sit a shade off it.
        <span
          aria-hidden
          className={cn(
            // Up near the top edge, pointing back at the avatar beside it.
            // Butted against the bubble with a pixel to spare rather than over
            // it: the surface is translucent, so any overlap would show as a
            // darker patch where the two stack.
            "absolute top-2 -left-[16px] rotate-55 size-4",
            "[clip-path:polygon(100%_0,100%_100%,0_50%)]",
            SURFACE
          )}
        />
      )}
      <span
        className={cn(
          "min-w-0 truncate px-3 py-1 mt-4 -ml-3 text-sm font-medium text-white",
          // A thought is rounder than a speech bubble; the difference is small
          // but it's the same difference the tails make, and the two agree.
          thought ? "rounded-full" : "rounded-2xl",
          SURFACE
        )}
      >
        {text}
      </span>
    </Element>
  );
}
